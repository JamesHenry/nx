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
import { PLUGIN_NAME, TscPluginOptions } from '../../plugins/typescript/plugin';
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
  // Ensure that the plugin has been wired up in nx.json
  const nxJson = readNxJson(tree);
  let tscPluginConfig: { plugin: string; options?: TscPluginOptions } | string =
    nxJson.plugins.find((p) => {
      if (typeof p === 'string') {
        return p === PLUGIN_NAME;
      }
      return p.plugin === PLUGIN_NAME;
    });
  if (!tscPluginConfig) {
    throw new Error(
      `The ${PLUGIN_NAME} must be added to the "plugins" array in nx.json before syncing tsconfigs`
    );
  }

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
    const sourceTsconfig = readJson<Tsconfig>(tree, sourceProjectTsconfigPath);

    for (const dep of data) {
      // Get the target project node
      const targetProjectNode = projectGraph.nodes[dep.target];

      if (!targetProjectNode) {
        // It's an external dependency
        continue;
      }

      // Set defaults only in the case where we have at least one dependency so that we don't patch files when not necessary
      sourceTsconfig.references = sourceTsconfig.references || [];

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
    }

    // Update the source tsconfig files
    writeJson(tree, sourceProjectTsconfigPath, sourceTsconfig);
  }

  await formatFiles(tree);
}
