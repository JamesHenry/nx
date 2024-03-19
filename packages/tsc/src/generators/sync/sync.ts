import {
  Tree,
  createProjectGraphAsync,
  formatFiles,
  joinPathFragments,
  readJson,
  writeJson,
} from '@nx/devkit';
import { relative } from 'node:path';
import { SyncSchema } from './schema';

interface Tsconfig {
  references?: Array<{ path: string }>;
  compilerOptions?: {
    paths?: Record<string, string[]>;
    rootDir?: string;
    outDir?: string;
  };
}

export async function syncGenerator(tree: Tree, options: SyncSchema) {
  const projectGraph = await createProjectGraphAsync();
  const firstPartyDeps = Object.entries(projectGraph.dependencies).filter(
    ([name, data]) => !name.startsWith('npm:') && data.length > 0
  );

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
    const sourceProjectTsconfigLibPath = joinPathFragments(
      sourceProjectNode.data.root,
      'tsconfig.lib.json'
    );
    const sourceTsconfig = readJson<Tsconfig>(tree, sourceProjectTsconfigPath);
    const sourceTsconfigLib = readJson<Tsconfig>(
      tree,
      sourceProjectTsconfigLibPath
    );

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

      // Add/update path mappings to the dist files of the target within the source lib tsconfig
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
        sourceProjectTsconfigLibPath
      );
      const relativePathToTargetOutDir = relative(
        absolutePathToSourceTsconfigLib,
        absolutePathToTargetOutDir
      );
      sourceTsconfigLib.compilerOptions =
        sourceTsconfigLib.compilerOptions || {};
      sourceTsconfigLib.compilerOptions.paths =
        sourceTsconfigLib.compilerOptions.paths || {};
      sourceTsconfigLib.compilerOptions.paths[`${dep.target}`] = [
        relativePathToTargetOutDir,
      ];
    }

    // Update the source tsconfig files
    writeJson(tree, sourceProjectTsconfigPath, sourceTsconfig);
    writeJson(tree, sourceProjectTsconfigLibPath, sourceTsconfigLib);
  }
  await formatFiles(tree);
}
