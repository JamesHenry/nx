import {
  CreateDependencies,
  CreateNodes,
  CreateNodesContext,
  detectPackageManager,
  readJsonFile,
  TargetConfiguration,
  writeJsonFile,
} from '@nx/devkit';
import { calculateHashForCreateNodes } from '@nx/devkit/src/utils/calculate-hash-for-create-nodes';
import { getLockFileName } from '@nx/js';
import { existsSync, readdirSync } from 'fs';
import { projectGraphCacheDirectory } from 'nx/src/utils/cache-directory';
import { dirname, join } from 'path';

export interface TscPluginOptions {
  targetName?: string;
}

const cachePath = join(projectGraphCacheDirectory, 'tsc.hash');
const targetsCache = existsSync(cachePath) ? readTargetsCache() : {};

const calculatedTargets: Record<
  string,
  Record<string, TargetConfiguration>
> = {};

function readTargetsCache(): Record<
  string,
  Record<string, TargetConfiguration<unknown>>
> {
  return readJsonFile(cachePath);
}

function writeTargetsToCache(
  targets: Record<string, Record<string, TargetConfiguration<unknown>>>
) {
  writeJsonFile(cachePath, targets);
}

export const createDependencies: CreateDependencies = () => {
  writeTargetsToCache(calculatedTargets);
  return [];
};

export const createNodes: CreateNodes<TscPluginOptions> = [
  '**/tsconfig*.json',
  (configFilePath, options, context) => {
    options = normalizeOptions(options);
    const projectRoot = dirname(configFilePath);

    // Do not create a project for the root package.json
    if (projectRoot === '.') {
      return {};
    }

    // Do not create a project if package.json and project.json isn't there.
    const siblingFiles = readdirSync(join(context.workspaceRoot, projectRoot));
    if (
      !siblingFiles.includes('package.json') &&
      !siblingFiles.includes('project.json')
    ) {
      return {};
    }

    const hash = calculateHashForCreateNodes(projectRoot, options, context, [
      getLockFileName(detectPackageManager(context.workspaceRoot)),
    ]);

    const targets = targetsCache[hash]
      ? targetsCache[hash]
      : buildTscTargets(configFilePath, projectRoot, options, context);

    calculatedTargets[hash] = targets;

    return {
      projects: {
        [projectRoot]: {
          projectType: 'library',
          targets,
        },
      },
    };
  },
];

function buildTscTargets(
  configFilePath: string,
  projectRoot: string,
  options: TscPluginOptions,
  context: CreateNodesContext
) {
  console.log({ configFilePath, projectRoot, options, context });

  const targets: Record<string, TargetConfiguration> = {};

  const targetName = options.targetName;
  if (!targets[targetName]) {
    targets[targetName] = {
      command: `tsc --build --pretty --verbose`,
      options: { cwd: projectRoot },
      cache: true,
      //   inputs: getInputs(namedInputs),
      //   outputs: getOutputs(projectRoot, cypressConfig, 'e2e'),
    };
  }

  return targets;
}

function normalizeOptions(options: TscPluginOptions): TscPluginOptions {
  options ??= {};
  options.targetName ??= 'build';
  return options;
}

/**
 * Load the module after ensuring that the require cache is cleared.
 */
// const packageInstallationDirectories = ['node_modules', '.yarn'];

// function load(path: string): any {
//   // Clear cache if the path is in the cache
//   if (require.cache[path]) {
//     for (const k of Object.keys(require.cache)) {
//       // We don't want to clear the require cache of installed packages.
//       // Clearing them can cause some issues when running Nx without the daemon
//       // and may cause issues for other packages that use the module state
//       // in some to store cached information.
//       if (!packageInstallationDirectories.some((dir) => k.includes(dir))) {
//         delete require.cache[k];
//       }
//     }
//   }

//   // Then require
//   return require(path);
// }
