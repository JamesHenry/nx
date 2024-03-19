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

  describe('root tsconfig project references', () => {
    it('should sync project references to the root tsconfig.json', async () => {
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
});
