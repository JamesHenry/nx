import {
  Tree,
  createProjectGraphAsync,
  formatFiles,
  joinPathFragments,
  readJson,
  readNxJson,
  writeJson,
} from '@nx/devkit';
import { relative } from 'node:path';
import { SyncSchema } from './schema';
import { TscPluginOptions, normalizePluginOptions } from '../../plugin/plugin';

interface Tsconfig {
  references?: Array<{ path: string }>;
  compilerOptions?: {
    paths?: Record<string, string[]>;
    rootDir?: string;
    outDir?: string;
  };
}

export async function syncGenerator(tree: Tree, options: SyncSchema) {
  // Ensure that the @nx/tsc plugin has been wired up in nx.json
  const nxJson = readNxJson(tree);
  let tscPluginConfig: { plugin: string; options?: TscPluginOptions } | string =
    nxJson.plugins.find((p) => {
      if (typeof p === 'string') {
        return p === '@nx/tsc';
      }
      return p.plugin === '@nx/tsc';
    });
  if (!tscPluginConfig) {
    throw new Error(
      'The @nx/tsc plugin must be added to the "plugins" array in nx.json before syncing tsconfigs'
    );
  }

  if (typeof tscPluginConfig === 'string') {
    tscPluginConfig = {
      plugin: '@nx/tsc',
      options: {},
    };
  }
  const pluginOptions = normalizePluginOptions(tscPluginConfig.options || {});
  const projectGraph = await createProjectGraphAsync();
  const firstPartyDeps = Object.entries(projectGraph.dependencies).filter(
    ([name, data]) => !name.startsWith('npm:') && data.length > 0
  );

  console.log({ pluginOptions });

  // Root tsconfig containing project references for the whole workspace
  const rootTsconfigPath = 'tsconfig.json';
  const rootTsconfig = readJson<Tsconfig>(tree, rootTsconfigPath);

  const tsconfigProjectNodeValues = Object.values(projectGraph.nodes).filter(
    (node) => {
      const projectTsconfigPath = joinPathFragments(
        node.data.root,
        'tsconfig.json'
      );
      return tree.exists(projectTsconfigPath);
    }
  );

  if (tsconfigProjectNodeValues.length > 0) {
    // Sync the root tsconfig references from the project graph (do not destroy existing references)
    rootTsconfig.references = rootTsconfig.references || [];
    const referencesSet = new Set(
      rootTsconfig.references.map((ref) => ref.path)
    );
    for (const node of tsconfigProjectNodeValues) {
      if (!referencesSet.has(node.data.root)) {
        rootTsconfig.references.push({ path: node.data.root });
      }
    }
    writeJson(tree, rootTsconfigPath, rootTsconfig);
  }

  for (const [name, data] of firstPartyDeps) {
    // Get the source project nodes for the source and target
    const sourceProjectNode = projectGraph.nodes[name];

    // Find the relevant tsconfig files for the source project
    const sourceProjectTsconfigPath = joinPathFragments(
      sourceProjectNode.data.root,
      'tsconfig.json'
    );
    const sourceTsconfig = readJson<Tsconfig>(tree, sourceProjectTsconfigPath);

    for (const dep of data) {
      // Set defaults in the case where we have at least one dependency so that we don't patch files when not necessary
      sourceTsconfig.references = sourceTsconfig.references || [];
      sourceTsconfig.compilerOptions = sourceTsconfig.compilerOptions || {};
      sourceTsconfig.compilerOptions.paths =
        sourceTsconfig.compilerOptions.paths || {};

      // Get the target project node
      const targetProjectNode = projectGraph.nodes[dep.target];

      // Ensure the project reference for the target is set
      const relativePathToTargetRoot = relative(
        sourceProjectNode.data.root,
        targetProjectNode.data.root
      );
      if (
        !sourceTsconfig.references.some(
          (ref) => ref.path === relativePathToTargetRoot
        )
      ) {
        // Make sure we unshift rather than push so that dependencies are built in the right order by TypeScript when it is run directly from the root of the workspace
        sourceTsconfig.references.unshift({ path: relativePathToTargetRoot });
      }

      // Find the relevant tsconfig files for the target project
      const targetProjectTsconfigPath = joinPathFragments(
        targetProjectNode.data.root,
        'tsconfig.json'
      );
      const targetTsconfigLibPath = joinPathFragments(
        targetProjectNode.data.root,
        'tsconfig.lib.json'
      );
      const targetTsconfig = readJson<Tsconfig>(
        tree,
        targetProjectTsconfigPath
      );
      const targetTsconfigLib = readJson<Tsconfig>(tree, targetTsconfigLibPath);

      // Add/update path mappings to the source files of the target within the source tsconfig
      const targetHasSrcDir = tree.exists(
        joinPathFragments(targetProjectNode.data.root, 'src')
      );
      const targetSourceRoot =
        targetProjectNode.data.sourceRoot ||
        targetTsconfig.compilerOptions?.rootDir ||
        targetHasSrcDir
          ? joinPathFragments(targetProjectNode.data.root, 'src')
          : targetProjectNode.data.root;
      const relativePathToTargetSourceRoot = relative(
        sourceProjectNode.data.root,
        targetSourceRoot
      );
      sourceTsconfig.compilerOptions.paths[`${dep.target}`] = [
        `${relativePathToTargetSourceRoot}/index.ts`,
      ];
      sourceTsconfig.compilerOptions.paths[`${dep.target}/*`] = [
        `${relativePathToTargetSourceRoot}/*`,
      ];

      // Add/update path mappings to the dist files of the target within the source build tsconfig (only applicable if a build target is configured via the plugin)
      if (pluginOptions.build) {
        const sourceProjectBuildTsconfigPath = joinPathFragments(
          sourceProjectNode.data.root,
          pluginOptions.build.configName
        );

        // There is nothing to be done if the project does not have the configured build tsconfig
        if (!tree.exists(sourceProjectBuildTsconfigPath)) {
          continue;
        }

        const sourceProjectBuildTsconfig = readJson<Tsconfig>(
          tree,
          sourceProjectBuildTsconfigPath
        );

        const targetOutDir = targetTsconfigLib.compilerOptions?.outDir;
        // TODO: make this more flexible somehow?
        if (!targetOutDir) {
          throw new Error(
            `The target project ${dep.target} does not have an outDir set in ${targetTsconfigLibPath}`
          );
        }
        const absolutePathToTargetOutDir = joinPathFragments(
          tree.root,
          targetTsconfigLibPath,
          targetOutDir
        );
        const absolutePathToSourceTsconfigLib = joinPathFragments(
          tree.root,
          sourceProjectBuildTsconfigPath
        );
        const relativePathToTargetOutDir = relative(
          absolutePathToSourceTsconfigLib,
          absolutePathToTargetOutDir
        );
        sourceProjectBuildTsconfig.compilerOptions =
          sourceProjectBuildTsconfig.compilerOptions || {};
        sourceProjectBuildTsconfig.compilerOptions.paths =
          sourceProjectBuildTsconfig.compilerOptions.paths || {};
        sourceProjectBuildTsconfig.compilerOptions.paths[`${dep.target}`] = [
          relativePathToTargetOutDir,
        ];
        writeJson(
          tree,
          sourceProjectBuildTsconfigPath,
          sourceProjectBuildTsconfig
        );
      }
    }

    // Update the source tsconfig files
    writeJson(tree, sourceProjectTsconfigPath, sourceTsconfig);
  }

  await formatFiles(tree);
}
