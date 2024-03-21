import { type CreateNodesContext } from '@nx/devkit';
import { minimatch } from 'minimatch';
import { TempFs } from 'nx/src/internal-testing-utils/temp-fs';
import { TscPluginOptions, createNodes } from './plugin';

describe('@nx/tsc', () => {
  let context: CreateNodesContext;
  let cwd = process.cwd();
  let tempFs: TempFs;

  beforeEach(() => {
    tempFs = new TempFs('test');
    context = {
      nxJsonConfiguration: {
        namedInputs: {
          default: ['{projectRoot}/**/*'],
          production: ['!{projectRoot}/**/*.spec.ts'],
        },
      },
      workspaceRoot: tempFs.tempDir,
      configFiles: [],
    };
    process.chdir(tempFs.tempDir);
  });

  afterEach(() => {
    jest.resetModules();
    tempFs.cleanup();
    process.chdir(cwd);
  });

  it('should not create nodes for root tsconfig.json files', async () => {
    applyFilesToTempFsAndContext(tempFs, context, {
      'package.json': `{}`,
      'project.json': `{}`,
      'tsconfig.json': `{}`,
      'src/index.ts': `console.log('Hello World!');`,
    });
    expect(await invokeCreateNodesOnMatchingFiles(context, {}))
      .toMatchInlineSnapshot(`
      {
        "projects": {},
      }
    `);

    applyFilesToTempFsAndContext(tempFs, context, {
      'package.json': `{}`,
      'project.json': `{}`,
      'tsconfig.base.json': `{}`,
      'src/index.ts': `console.log('Hello World!');`,
    });
    expect(await invokeCreateNodesOnMatchingFiles(context, {}))
      .toMatchInlineSnapshot(`
      {
        "projects": {},
      }
    `);
  });

  describe('typecheck target', () => {
    it('should create a node with a typecheck target for a project level tsconfig.json file by default (when there is a sibling package.json or project.json)', async () => {
      // Sibling package.json
      applyFilesToTempFsAndContext(tempFs, context, {
        'libs/my-lib/tsconfig.json': `{}`,
        'libs/my-lib/package.json': `{}`,
      });
      expect(await invokeCreateNodesOnMatchingFiles(context, {}))
        .toMatchInlineSnapshot(`
        {
          "projects": {
            "libs/my-lib": {
              "projectType": "library",
              "targets": {
                "typecheck": {
                  "cache": true,
                  "command": "tsc --build --pretty --verbose",
                  "dependsOn": [
                    "^typecheck",
                  ],
                  "options": {
                    "cwd": "libs/my-lib",
                  },
                },
              },
            },
          },
        }
      `);

      // Sibling project.json
      applyFilesToTempFsAndContext(tempFs, context, {
        'libs/my-lib/tsconfig.json': `{}`,
        'libs/my-lib/project.json': `{}`,
      });
      expect(await invokeCreateNodesOnMatchingFiles(context, {}))
        .toMatchInlineSnapshot(`
          {
            "projects": {
              "libs/my-lib": {
                "projectType": "library",
                "targets": {
                  "typecheck": {
                    "cache": true,
                    "command": "tsc --build --pretty --verbose",
                    "dependsOn": [
                      "^typecheck",
                    ],
                    "options": {
                      "cwd": "libs/my-lib",
                    },
                  },
                },
              },
            },
          }
      `);

      // Other tsconfigs present
      applyFilesToTempFsAndContext(tempFs, context, {
        'libs/my-lib/tsconfig.json': `{}`,
        'libs/my-lib/tsconfig.lib.json': `{}`,
        'libs/my-lib/tsconfig.build.json': `{}`,
        'libs/my-lib/tsconfig.spec.json': `{}`,
        'libs/my-lib/project.json': `{}`,
      });
      expect(await invokeCreateNodesOnMatchingFiles(context, {}))
        .toMatchInlineSnapshot(`
          {
            "projects": {
              "libs/my-lib": {
                "projectType": "library",
                "targets": {
                  "typecheck": {
                    "cache": true,
                    "command": "tsc --build --pretty --verbose",
                    "dependsOn": [
                      "^typecheck",
                    ],
                    "options": {
                      "cwd": "libs/my-lib",
                    },
                  },
                },
              },
            },
          }
      `);
    });

    it('should not create typecheck target for a project level tsconfig.json file if set to false in plugin options', async () => {
      // Sibling package.json
      applyFilesToTempFsAndContext(tempFs, context, {
        'libs/my-lib/tsconfig.json': `{}`,
        'libs/my-lib/package.json': `{}`,
      });
      expect(
        await invokeCreateNodesOnMatchingFiles(context, {
          typecheck: false,
        })
      ).toMatchInlineSnapshot(`
        {
          "projects": {
            "libs/my-lib": {
              "projectType": "library",
              "targets": {},
            },
          },
        }
      `);

      // Sibling project.json
      applyFilesToTempFsAndContext(tempFs, context, {
        'libs/my-lib/tsconfig.json': `{}`,
        'libs/my-lib/project.json': `{}`,
      });
      expect(
        await invokeCreateNodesOnMatchingFiles(context, {
          typecheck: false,
        })
      ).toMatchInlineSnapshot(`
        {
          "projects": {
            "libs/my-lib": {
              "projectType": "library",
              "targets": {},
            },
          },
        }
      `);
    });
  });

  describe('build target', () => {
    it('should not create a node with a build target for a project level tsconfig files by default', async () => {
      // Sibling package.json
      applyFilesToTempFsAndContext(tempFs, context, {
        'libs/my-lib/tsconfig.json': `{}`,
        'libs/my-lib/tsconfig.lib.json': `{}`,
        'libs/my-lib/tsconfig.build.json': `{}`,
        'libs/my-lib/package.json': `{}`,
      });
      expect(
        await invokeCreateNodesOnMatchingFiles(context, {
          // Reduce noise in build snapshots by disabling default typecheck target
          typecheck: false,
        })
      ).toMatchInlineSnapshot(`
        {
          "projects": {
            "libs/my-lib": {
              "projectType": "library",
              "targets": {},
            },
          },
        }
      `);

      // Sibling project.json
      applyFilesToTempFsAndContext(tempFs, context, {
        'libs/my-lib/tsconfig.json': `{}`,
        'libs/my-lib/tsconfig.lib.json': `{}`,
        'libs/my-lib/tsconfig.build.json': `{}`,
        'libs/my-lib/project.json': `{}`,
      });
      expect(
        await invokeCreateNodesOnMatchingFiles(context, {
          // Reduce noise in build snapshots by disabling default typecheck target
          typecheck: false,
        })
      ).toMatchInlineSnapshot(`
        {
          "projects": {
            "libs/my-lib": {
              "projectType": "library",
              "targets": {},
            },
          },
        }
      `);
    });

    it('should not create build target for a project level tsconfig.json file if set to false in plugin options', async () => {
      // Sibling package.json
      applyFilesToTempFsAndContext(tempFs, context, {
        'libs/my-lib/tsconfig.json': `{}`,
        'libs/my-lib/tsconfig.lib.json': `{}`,
        'libs/my-lib/tsconfig.build.json': `{}`,
        'libs/my-lib/package.json': `{}`,
      });
      expect(
        await invokeCreateNodesOnMatchingFiles(context, {
          // Reduce noise in build snapshots by disabling default typecheck target
          typecheck: false,
          build: false,
        })
      ).toMatchInlineSnapshot(`
        {
          "projects": {
            "libs/my-lib": {
              "projectType": "library",
              "targets": {},
            },
          },
        }
      `);

      // Sibling project.json
      applyFilesToTempFsAndContext(tempFs, context, {
        'libs/my-lib/tsconfig.json': `{}`,
        'libs/my-lib/tsconfig.lib.json': `{}`,
        'libs/my-lib/tsconfig.build.json': `{}`,
        'libs/my-lib/project.json': `{}`,
      });
      expect(
        await invokeCreateNodesOnMatchingFiles(context, {
          // Reduce noise in build snapshots by disabling default typecheck target
          typecheck: false,
          build: false,
        })
      ).toMatchInlineSnapshot(`
        {
          "projects": {
            "libs/my-lib": {
              "projectType": "library",
              "targets": {},
            },
          },
        }
      `);
    });

    it('should create a node with a build target when enabled, for a project level tsconfig.lib.json build file by default', async () => {
      // Sibling package.json
      applyFilesToTempFsAndContext(tempFs, context, {
        'libs/my-lib/tsconfig.json': `{}`,
        'libs/my-lib/tsconfig.lib.json': `{}`,
        'libs/my-lib/tsconfig.build.json': `{}`,
        'libs/my-lib/package.json': `{}`,
      });
      expect(
        await invokeCreateNodesOnMatchingFiles(context, {
          // Reduce noise in build snapshots by disabling default typecheck target
          typecheck: false,
          build: true, // shorthand for apply with default options
        })
      ).toMatchInlineSnapshot(`
        {
          "projects": {
            "libs/my-lib": {
              "projectType": "library",
              "targets": {
                "build": {
                  "cache": true,
                  "command": "tsc -b tsconfig.lib.json --pretty --verbose",
                  "dependsOn": [
                    "^build",
                  ],
                  "options": {
                    "cwd": "libs/my-lib",
                  },
                },
              },
            },
          },
        }
      `);

      // Sibling project.json
      applyFilesToTempFsAndContext(tempFs, context, {
        'libs/my-lib/tsconfig.json': `{}`,
        'libs/my-lib/tsconfig.lib.json': `{}`,
        'libs/my-lib/tsconfig.build.json': `{}`,
        'libs/my-lib/project.json': `{}`,
      });
      expect(
        await invokeCreateNodesOnMatchingFiles(context, {
          // Reduce noise in build snapshots by disabling default typecheck target
          typecheck: false,
          build: {}, // apply with default options
        })
      ).toMatchInlineSnapshot(`
        {
          "projects": {
            "libs/my-lib": {
              "projectType": "library",
              "targets": {
                "build": {
                  "cache": true,
                  "command": "tsc -b tsconfig.lib.json --pretty --verbose",
                  "dependsOn": [
                    "^build",
                  ],
                  "options": {
                    "cwd": "libs/my-lib",
                  },
                },
              },
            },
          },
        }
      `);
    });

    it('should create a node with a build target when enabled, using a custom configured target name', async () => {
      // Sibling package.json
      applyFilesToTempFsAndContext(tempFs, context, {
        'libs/my-lib/tsconfig.json': `{}`,
        'libs/my-lib/tsconfig.lib.json': `{}`,
        'libs/my-lib/tsconfig.build.json': `{}`,
        'libs/my-lib/package.json': `{}`,
      });
      expect(
        await invokeCreateNodesOnMatchingFiles(context, {
          // Reduce noise in build snapshots by disabling default typecheck target
          typecheck: false,
          build: {
            targetName: 'my-build',
          },
        })
      ).toMatchInlineSnapshot(`
        {
          "projects": {
            "libs/my-lib": {
              "projectType": "library",
              "targets": {
                "my-build": {
                  "cache": true,
                  "command": "tsc -b tsconfig.lib.json --pretty --verbose",
                  "dependsOn": [
                    "^my-build",
                  ],
                  "options": {
                    "cwd": "libs/my-lib",
                  },
                },
              },
            },
          },
        }
      `);
    });

    it('should create a node with a build target when enabled, using a custom configured tsconfig file', async () => {
      // Sibling project.json
      applyFilesToTempFsAndContext(tempFs, context, {
        'libs/my-lib/tsconfig.json': `{}`,
        'libs/my-lib/tsconfig.lib.json': `{}`,
        'libs/my-lib/tsconfig.build.json': `{}`,
        'libs/my-lib/project.json': `{}`,
      });
      expect(
        await invokeCreateNodesOnMatchingFiles(context, {
          // Reduce noise in build snapshots by disabling default typecheck target
          typecheck: false,
          build: {
            configName: 'tsconfig.build.json',
          },
        })
      ).toMatchInlineSnapshot(`
        {
          "projects": {
            "libs/my-lib": {
              "projectType": "library",
              "targets": {
                "build": {
                  "cache": true,
                  "command": "tsc -b tsconfig.build.json --pretty --verbose",
                  "dependsOn": [
                    "^build",
                  ],
                  "options": {
                    "cwd": "libs/my-lib",
                  },
                },
              },
            },
          },
        }
      `);
    });
  });
});

function applyFilesToTempFsAndContext(
  tempFs: TempFs,
  context: CreateNodesContext,
  fileSys: Record<string, string>
) {
  tempFs.createFilesSync(fileSys);
  // @ts-expect-error update otherwise readonly property for testing
  context.configFiles = Object.keys(fileSys).filter((file) =>
    minimatch(file, createNodes[0], { dot: true })
  );
}

async function invokeCreateNodesOnMatchingFiles(
  context: CreateNodesContext,
  pluginOptions: TscPluginOptions
) {
  const aggregateProjects: Record<string, any> = {};
  for (const file of context.configFiles) {
    const nodes = await createNodes[1](file, pluginOptions, context);
    Object.assign(aggregateProjects, nodes.projects);
  }
  return {
    projects: aggregateProjects,
  };
}
