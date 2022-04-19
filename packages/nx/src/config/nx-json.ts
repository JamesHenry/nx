import { PackageManager } from '../utils/package-manager';
import { TargetDependencyConfig } from './workspace-json-project-json';

export type ImplicitDependencyEntry<T = '*' | string[]> = {
  [key: string]: T | ImplicitJsonSubsetDependency<T>;
};

export interface ImplicitJsonSubsetDependency<T = '*' | string[]> {
  [key: string]: T | ImplicitJsonSubsetDependency<T>;
}

export interface NxAffectedConfig {
  /**
   * Default based branch used by affected commands.
   */
  defaultBase?: string;
}

class BaseNxJsonConfigProperty<Value = any> {
  value: Value;
}

class RequiredNxJsonConfigProperty<
  Value = any
> extends BaseNxJsonConfigProperty<Value> {
  required: true;
}

class OptionalNxJsonConfigProperty<
  Value = any
> extends BaseNxJsonConfigProperty<Value> {
  optional: true;
}

/**
 * NPM Scope that the workspace uses
 */
type NpmScope = string;

export const NxJsonConfig = {
  /**
   * Optional (additional) Nx.json configuration file which becomes a base for this one
   */
  extends: new OptionalNxJsonConfigProperty<string>(),
  /**
   * Map of files to projects that implicitly depend on them
   */
  implicitDependencies: new OptionalNxJsonConfigProperty<
    ImplicitDependencyEntry<'*' | string[]>
  >(),
  /**
   * Dependencies between different target names across all projects
   */
  targetDependencies: new OptionalNxJsonConfigProperty<
    Record<string, TargetDependencyConfig[]>
  >(),

  npmScope: new RequiredNxJsonConfigProperty<NpmScope>(),
  /**
   * Default options for `nx affected`
   */
  affected: new OptionalNxJsonConfigProperty<NxAffectedConfig>(),
  /**
   * Where new apps + libs should be placed
   */
  workspaceLayout: new OptionalNxJsonConfigProperty<{
    libsDir: string;
    appsDir: string;
  }>(),
  /**
   * Available Task Runners
   */
  tasksRunnerOptions: new OptionalNxJsonConfigProperty<{
    [tasksRunnerName: string]: {
      /**
       * Path to resolve the runner
       */
      runner: string;
      /**
       * Default options for the runner
       */
      options?: any;
    };
  }>(),
  /**
   * List of default values used by generators.
   *
   * These defaults are global. They are used when no other defaults are configured.
   *
   * Example:
   *
   * ```
   * {
   *   "@nrwl/react": {
   *     "library": {
   *       "style": "scss"
   *     }
   *   }
   * }
   * ```
   */
  generators: new OptionalNxJsonConfigProperty<{
    [collectionName: string]: { [generatorName: string]: any };
  }>(),

  /**
   * Default generator collection. It is used when no collection is provided.
   */
  cli: new OptionalNxJsonConfigProperty<{
    packageManager?: PackageManager;
    defaultCollection?: string;
    defaultProjectName?: string;
  }>(),

  /**
   * Plugins for extending the project graph
   */
  plugins: new OptionalNxJsonConfigProperty<
    /**
     * Plugins for extending the project graph
     */
    string[]
  >(),

  /**
   * Configuration for Nx Plugins
   */
  pluginsConfig: new OptionalNxJsonConfigProperty<Record<string, unknown>>(),

  /**
   * Default project. When project isn't provided, the default project
   * will be used. Convenient for small workspaces with one main application.
   */
  defaultProject: new OptionalNxJsonConfigProperty<string>(),
} as const;

// type NxJson = {
//   [key in keyof typeof NxJsonConfig]: OptionalNxJsonConfigProperty<
//     typeof NxJsonConfig[key]['value']
//   >['value'];
// };

export type NxJson = {
  [key in keyof typeof NxJsonConfig as typeof NxJsonConfig[key] extends OptionalNxJsonConfigProperty
    ? key
    : never]?: OptionalNxJsonConfigProperty<
    typeof NxJsonConfig[key]['value']
  >['value'];
} & {
  [key in keyof typeof NxJsonConfig as typeof NxJsonConfig[key] extends RequiredNxJsonConfigProperty
    ? key
    : never]: RequiredNxJsonConfigProperty<
    typeof NxJsonConfig[key]['value']
  >['value'];
};

const nxJson: NxJson = {
  npmScope: '',
  plugins: [],
  tasksRunnerOptions: {
    '@nrwl/workspace': {
      runner: '@nrwl/workspace:run-tasks',
      options: {},
    },
  },
};

/**
 * Nx.json configuration
 */
export interface NxJsonConfiguration<T = '*' | string[]> {
  /**
   * Optional (additional) Nx.json configuration file which becomes a base for this one
   */
  extends?: string;
  /**
   * Map of files to projects that implicitly depend on them
   */
  implicitDependencies?: ImplicitDependencyEntry<T>;
  /**
   * Dependencies between different target names across all projects
   */
  targetDependencies?: Record<string, TargetDependencyConfig[]>;
  /**
   * NPM Scope that the workspace uses
   */
  npmScope: string;
  /**
   * Default options for `nx affected`
   */
  affected?: NxAffectedConfig;
  /**
   * Where new apps + libs should be placed
   */
  workspaceLayout?: {
    libsDir: string;
    appsDir: string;
  };
  /**
   * Available Task Runners
   */
  tasksRunnerOptions?: {
    [tasksRunnerName: string]: {
      /**
       * Path to resolve the runner
       */
      runner: string;
      /**
       * Default options for the runner
       */
      options?: any;
    };
  };
  /**
   * List of default values used by generators.
   *
   * These defaults are global. They are used when no other defaults are configured.
   *
   * Example:
   *
   * ```
   * {
   *   "@nrwl/react": {
   *     "library": {
   *       "style": "scss"
   *     }
   *   }
   * }
   * ```
   */
  generators?: { [collectionName: string]: { [generatorName: string]: any } };

  /**
   * Default generator collection. It is used when no collection is provided.
   */
  cli?: {
    packageManager?: PackageManager;
    defaultCollection?: string;
    defaultProjectName?: string;
  };
  /**
   * Plugins for extending the project graph
   */
  plugins?: string[];

  /**
   * Configuration for Nx Plugins
   */
  pluginsConfig?: Record<string, unknown>;

  /**
   * Default project. When project isn't provided, the default project
   * will be used. Convenient for small workspaces with one main application.
   */
  defaultProject?: string;
}

/**
 * @deprecated(v14): nx.json no longer contains projects
 */
export interface NxJsonProjectConfiguration {
  implicitDependencies?: string[];
  tags?: string[];
}
