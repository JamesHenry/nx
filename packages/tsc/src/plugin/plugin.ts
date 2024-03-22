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
  typecheck?:
    | boolean
    | {
        targetName?: string;
      };
  build?:
    | boolean
    | {
        targetName?: string;
        configName?: string;
      };
}

export interface NormalizedPluginOptions {
  typecheck:
    | false
    | {
        targetName: string;
      };
  build:
    | false
    | {
        targetName: string;
        configName: string;
      };
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
    const pluginOptions = normalizePluginOptions(options);
    const projectRoot = dirname(configFilePath);

    // TODO: play with standalone projects

    // Do not create a project for the root tsconfig.json files
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

    const hash = calculateHashForCreateNodes(
      projectRoot,
      pluginOptions,
      context,
      [getLockFileName(detectPackageManager(context.workspaceRoot))]
    );

    const targets = targetsCache[hash]
      ? targetsCache[hash]
      : buildTscTargets(
          configFilePath,
          projectRoot,
          siblingFiles,
          pluginOptions,
          context
        );

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
  siblingFiles: string[],
  options: NormalizedPluginOptions,
  context: CreateNodesContext
) {
  const targets: Record<string, TargetConfiguration> = {};

  // TODO: Only attribute this target to the tsconfig.json (not currently the case)

  // Typecheck target for the tsconfig.json file
  if (
    siblingFiles.some((f) => f.endsWith('tsconfig.json')) &&
    options.typecheck
  ) {
    const targetName = options.typecheck.targetName;
    if (!targets[targetName]) {
      targets[targetName] = {
        dependsOn: [`^${targetName}`],
        command: `tsc --build --pretty --verbose`,
        options: { cwd: projectRoot },
        cache: true,
        //   inputs: getInputs(namedInputs),
        //   outputs: getOutputs(projectRoot, cypressConfig, 'e2e'),
      };
    }
  }

  // Build target
  if (options.build) {
    const targetName = options.build.targetName;
    if (!targets[targetName]) {
      const tsconfigBuildFilePath = join(
        context.workspaceRoot,
        projectRoot,
        options.build.configName
      );
      // Only add the build target if the configured config file is available in the current project
      if (existsSync(tsconfigBuildFilePath)) {
        targets[targetName] = {
          dependsOn: [`^${targetName}`],
          command: `tsc -b ${options.build.configName} --pretty --verbose`,
          options: { cwd: projectRoot },
          cache: true,
          //   inputs: getInputs(namedInputs),
          //   outputs: getOutputs(projectRoot, cypressConfig, 'e2e'),
        };
      }
    }
  }

  return targets;
}

export function normalizePluginOptions(
  pluginOptions: TscPluginOptions
): NormalizedPluginOptions {
  const defaultTypecheckTargetName = 'typecheck';
  let typecheck: NormalizedPluginOptions['typecheck'] = {
    targetName: defaultTypecheckTargetName,
  };
  if (pluginOptions.typecheck === false) {
    typecheck = false;
  } else if (
    pluginOptions.typecheck &&
    typeof pluginOptions.typecheck !== 'boolean'
  ) {
    typecheck = {
      targetName:
        pluginOptions.typecheck.targetName ?? defaultTypecheckTargetName,
    };
  }

  const defaultBuildTargetName = 'build';
  const defaultBuildConfigName = 'tsconfig.lib.json';
  let build: NormalizedPluginOptions['build'] = {
    targetName: defaultBuildTargetName,
    configName: defaultBuildConfigName,
  };
  // Build target is not enabled by default
  if (!pluginOptions.build) {
    build = false;
  } else if (pluginOptions.build && typeof pluginOptions.build !== 'boolean') {
    build = {
      targetName: pluginOptions.build.targetName ?? defaultBuildTargetName,
      configName: pluginOptions.build.configName ?? defaultBuildConfigName,
    };
  }

  return {
    typecheck,
    build,
  };
}
