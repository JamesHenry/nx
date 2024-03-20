import { ProjectGraph, Tree, readJson, writeJson } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { syncGenerator } from './sync';

let projectGraph: ProjectGraph;

jest.mock('@nx/devkit', () => ({
  ...jest.requireActual('@nx/devkit'),
  createProjectGraphAsync: jest.fn(() => Promise.resolve(projectGraph)),
}));

describe('syncGenerator()', () => {
  let tree: Tree;

  beforeEach(async () => {
    tree = createTreeWithEmptyWorkspace();
    projectGraph = {
      nodes: {
        a: {
          name: 'a',
          type: 'lib',
          data: {
            root: 'packages/a',
          },
        },
        b: {
          name: 'b',
          type: 'lib',
          data: {
            root: 'packages/b',
          },
        },
      },
      dependencies: {
        a: [],
        b: [
          {
            type: 'static',
            source: 'b',
            target: 'a',
          },
        ],
      },
    };

    writeJson(tree, 'nx.json', {
      // Wire up the @nx/tsc plugin with default options
      plugins: ['@nx/tsc'],
    });

    // Root tsconfigs
    writeJson(tree, 'tsconfig.json', {});
    writeJson(tree, 'tsconfig.options.json', { compilerOptions: {} });

    // Package A
    writeJson(tree, 'packages/a/tsconfig.json', {});
    writeJson(tree, 'packages/a/tsconfig.lib.json', {
      compilerOptions: {
        outDir: '../../dist/packages/a/dist',
      },
    });
    writeJson(tree, 'packages/a/package.json', {
      name: 'a',
      version: '0.0.0',
    });

    // Package B (depends on A)
    writeJson(tree, 'packages/b/tsconfig.json', {});
    writeJson(tree, 'packages/b/tsconfig.lib.json', {});
    writeJson(tree, 'packages/b/package.json', {
      name: 'b',
      version: '0.0.0',
      dependencies: {
        a: '0.0.0',
      },
    });
  });

  it('should error if the @nx/tsc plugin is not configured in nx.json', async () => {
    const nxJson = readJson(tree, 'nx.json');
    nxJson.plugins = nxJson.plugins.filter((p) => p !== '@nx/tsc');
    writeJson(tree, 'nx.json', nxJson);

    await expect(syncGenerator(tree, {})).rejects.toMatchInlineSnapshot(
      `[Error: The @nx/tsc plugin must be added to the "plugins" array in nx.json before syncing tsconfigs]`
    );
  });

  describe('root tsconfig.json', () => {
    it('should sync project references to the root tsconfig.json', async () => {
      expect(readJson(tree, 'tsconfig.json').references).toMatchInlineSnapshot(
        `undefined`
      );

      await syncGenerator(tree, {});

      const rootTsconfig = readJson(tree, 'tsconfig.json');
      expect(rootTsconfig.references).toMatchInlineSnapshot(`
        [
          {
            "path": "packages/a",
          },
          {
            "path": "packages/b",
          },
        ]
      `);
    });

    it('should respect existing project references in the root tsconfig.json', async () => {
      writeJson(tree, 'tsconfig.json', {
        // Swapped order and additional manual reference
        references: [
          { path: 'packages/b' },
          { path: 'packages/a' },
          { path: 'packages/c' },
        ],
      });
      expect(readJson(tree, 'tsconfig.json').references).toMatchInlineSnapshot(`
        [
          {
            "path": "packages/b",
          },
          {
            "path": "packages/a",
          },
          {
            "path": "packages/c",
          },
        ]
      `);

      await syncGenerator(tree, {});

      const rootTsconfig = readJson(tree, 'tsconfig.json');
      expect(rootTsconfig.references).toMatchInlineSnapshot(`
        [
          {
            "path": "packages/b",
          },
          {
            "path": "packages/a",
          },
          {
            "path": "packages/c",
          },
        ]
      `);
    });
  });

  describe('project level tsconfig.json', () => {
    it('should sync project references to project level tsconfig.json files where needed', async () => {
      expect(
        readJson(tree, 'packages/b/tsconfig.json').references
      ).toMatchInlineSnapshot(`undefined`);

      await syncGenerator(tree, {});

      expect(readJson(tree, 'packages/b/tsconfig.json').references)
        .toMatchInlineSnapshot(`
        [
          {
            "path": "../a",
          },
        ]
      `);
    });

    it('should respect existing project references in the project level tsconfig.json', async () => {
      writeJson(tree, 'packages/b/tsconfig.json', {
        // Swapped order and additional manual reference
        references: [{ path: '../some/thing' }, { path: '../../another/one' }],
      });
      expect(readJson(tree, 'packages/b/tsconfig.json').references)
        .toMatchInlineSnapshot(`
        [
          {
            "path": "../some/thing",
          },
          {
            "path": "../../another/one",
          },
        ]
      `);

      await syncGenerator(tree, {});

      const rootTsconfig = readJson(tree, 'packages/b/tsconfig.json');
      // The dependency reference on "a" is added to the start of the array
      expect(rootTsconfig.references).toMatchInlineSnapshot(`
        [
          {
            "path": "../a",
          },
          {
            "path": "../some/thing",
          },
          {
            "path": "../../another/one",
          },
        ]
      `);
    });

    it('should sync compilerOptions.paths to project level tsconfig.json files where needed', async () => {
      expect(
        readJson(tree, 'packages/b/tsconfig.json').compilerOptions?.paths
      ).toMatchInlineSnapshot(`undefined`);

      await syncGenerator(tree, {});

      expect(readJson(tree, 'packages/b/tsconfig.json').compilerOptions?.paths)
        .toMatchInlineSnapshot(`
        {
          "a": [
            "../a/index.ts",
          ],
          "a/*": [
            "../a/*",
          ],
        }
      `);
    });

    it('should respect existing compilerOptions.paths in project level tsconfig.json files', async () => {
      writeJson(tree, 'packages/b/tsconfig.json', {
        compilerOptions: {
          paths: {
            '@my-scope/thing': ['../some/thing'],
          },
        },
      });
      expect(readJson(tree, 'packages/b/tsconfig.json').compilerOptions?.paths)
        .toMatchInlineSnapshot(`
        {
          "@my-scope/thing": [
            "../some/thing",
          ],
        }
      `);

      await syncGenerator(tree, {});

      expect(readJson(tree, 'packages/b/tsconfig.json').compilerOptions?.paths)
        .toMatchInlineSnapshot(`
        {
          "@my-scope/thing": [
            "../some/thing",
          ],
          "a": [
            "../a/index.ts",
          ],
          "a/*": [
            "../a/*",
          ],
        }
      `);
    });
  });

  describe('project level build tsconfig (e.g. tsconfig.lib.json, tsconfig.build.json etc)', () => {
    it('should sync compilerOptions.paths dist/outDir locations in project level build tsconfig files where needed', async () => {
      // Configure the @nx/tsc plugin to have a build target which matches tsconfig.lib.json
      writeJson(tree, 'nx.json', {
        plugins: [
          {
            plugin: '@nx/tsc',
            options: {
              build: {
                targetName: 'build',
                configName: 'tsconfig.lib.json',
              },
            },
          },
        ],
      });

      // Add a tsconfig.lib.json to package A which has an outDir set
      writeJson(tree, 'packages/a/tsconfig.lib.json', {
        compilerOptions: {
          outDir: '../../dist/packages/a/lib',
        },
      });

      expect(
        readJson(tree, 'packages/b/tsconfig.lib.json').compilerOptions?.paths
      ).toMatchInlineSnapshot(`undefined`);

      await syncGenerator(tree, {});

      expect(
        readJson(tree, 'packages/b/tsconfig.lib.json').compilerOptions?.paths
      ).toMatchInlineSnapshot(`
        {
          "a": [
            "../../dist/packages/a/lib",
          ],
        }
      `);
    });

    it('should not sync compilerOptions.paths dist/outDir locations in project level build tsconfig files when a build target is not configured', async () => {
      // Do not configure the @nx/tsc plugin to have a build target (build target explicitly disabled)
      writeJson(tree, 'nx.json', {
        plugins: [
          {
            plugin: '@nx/tsc',
            options: {
              build: false,
            },
          },
        ],
      });

      // Add a tsconfig.lib.json to package A which has an outDir set
      writeJson(tree, 'packages/a/tsconfig.lib.json', {
        compilerOptions: {
          outDir: '../../dist/packages/a/lib',
        },
      });

      expect(
        readJson(tree, 'packages/b/tsconfig.lib.json').compilerOptions?.paths
      ).toMatchInlineSnapshot(`undefined`);

      await syncGenerator(tree, {});

      expect(
        readJson(tree, 'packages/b/tsconfig.lib.json').compilerOptions?.paths
      ).toMatchInlineSnapshot(`undefined`);

      // Do not configure the @nx/tsc plugin to have a build target (string form of plugin config)
      writeJson(tree, 'nx.json', {
        plugins: ['@nx/tsc'],
      });

      await syncGenerator(tree, {});

      expect(
        readJson(tree, 'packages/b/tsconfig.lib.json').compilerOptions?.paths
      ).toMatchInlineSnapshot(`undefined`);

      // Do not configure the @nx/tsc plugin to have a build target (no options explicitly set, no build target by default)
      writeJson(tree, 'nx.json', {
        plugins: [
          {
            plugin: '@nx/tsc',
          },
        ],
      });

      await syncGenerator(tree, {});

      expect(
        readJson(tree, 'packages/b/tsconfig.lib.json').compilerOptions?.paths
      ).toMatchInlineSnapshot(`undefined`);
    });

    it('should not sync compilerOptions.paths dist/outDir locations in project level build tsconfig files which do not match the given configName', async () => {
      // Configure the @nx/tsc plugin to have a build target which does not match tsconfig.lib.json
      writeJson(tree, 'nx.json', {
        plugins: [
          {
            plugin: '@nx/tsc',
            options: {
              build: {
                targetName: 'build',
                configName: 'tsconfig.something-else.json',
              },
            },
          },
        ],
      });

      // Add a tsconfig.lib.json to package A which has an outDir set
      writeJson(tree, 'packages/a/tsconfig.lib.json', {
        compilerOptions: {
          outDir: '../../dist/packages/a/lib',
        },
      });

      expect(
        readJson(tree, 'packages/b/tsconfig.lib.json').compilerOptions?.paths
      ).toMatchInlineSnapshot(`undefined`);

      await syncGenerator(tree, {});

      expect(
        readJson(tree, 'packages/b/tsconfig.lib.json').compilerOptions?.paths
      ).toMatchInlineSnapshot(`undefined`);
    });
  });
});
