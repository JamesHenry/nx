import Editor, { Monaco, useMonaco } from '@monaco-editor/react';
import { findNodeAtOffset, Node, parseTree } from 'jsonc-parser';
import type { IPosition } from 'monaco-editor';
import { useEffect, useRef } from 'react';
import { debounce } from 'lodash';

// These types aren't exported so have to grab it from the relevant function signatures
type IContentWidget = Parameters<
  ReturnType<Monaco['editor']['create']>['addContentWidget']
>[0];

const JSON_INDENTATION = 2;

type ViewZoneId = string;

export function Explain() {
  const monaco = useMonaco();
  const nxJson = getNxJsonContents();
  const stringifiedNxJson = JSON.stringify(nxJson, null, JSON_INDENTATION);
  const ast = parseTree(stringifiedNxJson);
  const activeContentWidget = useRef<IContentWidget | null>(null);
  const activeViewZone = useRef<ViewZoneId | null>(null);

  useEffect(() => {
    monaco?.languages.json.jsonDefaults.setDiagnosticsOptions({
      validate: true,
      allowComments: true,
      schemas: [
        {
          uri: 'https://json-schema.app/example.json', // id of the first schema
          fileMatch: ['a://b/example.json'],
          schema: {},
        },
      ],
    });
  }, [monaco]);

  if (!ast) {
    return null;
  }

  return (
    <Editor
      height="90vh"
      // width={'50%'}
      defaultLanguage="json"
      value={stringifiedNxJson}
      path="a://b/example.json"
      theme="vs-light"
      options={{
        scrollBeyondLastLine: false,
        readOnly: true,
        minimap: {
          enabled: false,
        },
      }}
      saveViewState={false}
      onMount={(editor, monaco) => {
        function cleanUpWidgetAndZone(): void {
          if (activeContentWidget.current) {
            editor.removeContentWidget(activeContentWidget.current);
            activeContentWidget.current = null;
          }
          if (activeViewZone.current) {
            editor.changeViewZones((editor) => {
              if (activeViewZone.current) {
                editor.removeZone(activeViewZone.current);
              }
            });
            activeViewZone.current = null;
          }
        }

        editor.onDidScrollChange(
          debounce(() => {
            editor.changeViewZones((changeAccessor) => {
              if (activeViewZone.current) {
                changeAccessor.layoutZone(activeViewZone.current);
              }
            });
          }),
          1000
        );

        editor.onDidChangeCursorSelection((e) => {
          const modelVal = editor.getValue();
          const model = monaco.editor.createModel(modelVal, 'json');
          const offset = model.getOffsetAt({
            lineNumber: e.selection.startLineNumber,
            column: e.selection.startColumn,
          });

          let node = findNodeAtOffset(ast, offset);
          if (!node) {
            return cleanUpWidgetAndZone();
          }

          /**
           * If the root node is our initial result, a couple of different things could be happening:
           *
           * 1. The user could have clicked on or just before or just after the `,` on a particular
           * line of one of the primary children of the root node:
           *
           * E.g. (where {C} is the cursor):
           * ```
           * {
           *   "npmScope": "nrwl",{C}
           * }
           * OR
           * {
           *   "npmScope": "nrwl"{C},
           * }
           * ```
           *
           * 2. The user could have within the indentation before the key of one of the primary children
           * of the root node:
           *
           * E.g. (where {C} is the cursor):
           * ```
           * {
           *  {C} "npmScope": "nrwl",
           * }
           */
          if (isRootNode(node)) {
            const selectedLineLength = model.getLineLength(
              e.selection.startLineNumber
            );
            // The position after the comma is one greater than the line length
            if (e.selection.startColumn >= selectedLineLength) {
              // Update to our selection to be the last character of the current line
              const updatedOffset = model.getOffsetAt({
                column: selectedLineLength - 1,
                lineNumber: e.selection.startLineNumber,
              });

              // Update the selected node
              node = findNodeAtOffset(ast, updatedOffset);
              if (!node || isRootNode(node)) {
                return cleanUpWidgetAndZone();
              }
            } else {
              /**
               * In this situation we have to update the cursor position itself and retrigger the event
               * handler so that the selection on the event will correctly taken into account the JSON
               * block location data for the node resolution logic to work.
               */
              if (e.selection.startColumn <= JSON_INDENTATION) {
                editor.setPosition({
                  lineNumber: e.selection.startLineNumber,
                  column: JSON_INDENTATION + 3,
                });
                return;
              }

              // We can only match the root node, and we do not want to select it because it's just visually noisy
              return cleanUpWidgetAndZone();
            }
          }

          // Traverse up until one level before the root node
          let nodeToSelect = node?.parent;
          while (nodeToSelect?.parent?.parent) {
            nodeToSelect = nodeToSelect.parent;
          }
          if (!nodeToSelect) {
            return cleanUpWidgetAndZone();
          }

          const selectionStartPos = model.getPositionAt(nodeToSelect.offset);
          const selectionEndPos = model.getPositionAt(
            nodeToSelect.offset + nodeToSelect.length
          );
          editor.setSelection({
            startLineNumber: selectionStartPos.lineNumber,
            startColumn: selectionStartPos.column,
            endLineNumber: selectionEndPos.lineNumber,
            endColumn: selectionEndPos.column,
          });

          // Clean up any previous content widget and view zones that may have been set
          cleanUpWidgetAndZone();

          // TODO: Cache the widgets based on the currently selected primary node key

          activeContentWidget.current = createExplanationWidget(
            monaco,
            editor.getScrollWidth(),
            {
              lineNumber: selectionEndPos.lineNumber,
              column: 0,
            }
          );

          editor.addContentWidget(activeContentWidget.current);
          // const widgetDomNode = activeContentWidget.current.getDomNode();

          editor.changeViewZones((changeAccessor) => {
            activeViewZone.current = changeAccessor.addZone({
              afterLineNumber: selectionEndPos.lineNumber,
              /**
               * By having heightInPx we can figure out the height based on one key factor: is the start of the widget fully visible based on line number?
               * If the answer is yes, then we simply return the height of the widget's own DOM node, if the answer is no, the we want to return 0, because
               * in this case the editor is already automatically hiding the widget itself. Therefore if didn't return 0 we would end up with a large blank
               * area until the scroll returned to a position in which the start of the widget is fully visible.
               *
               * (This is combined with the call to layoutZone() in the onDidScrollChange() handler to ensure it is appropriately recalled).
               */
              get heightInPx() {
                const firstVisibleLineNumber =
                  editor.getVisibleRanges()[0].startLineNumber;

                if (firstVisibleLineNumber > selectionEndPos.lineNumber) {
                  return 0;
                }

                return activeContentWidget.current
                  ?.getDomNode()
                  .getBoundingClientRect().height;
              },
              domNode: document.createElement('div'),
            });
          });

          /**
           * Ensure both the start of the relevant primary node AND the full view zone are visible in the editor whenever possible.
           * NOTE: If the config block being explained is very tall it is possible that the editor is not tall enough to show the
           * full thing at once, in which case we need to prefer showing the full view zone with the explanation in, so we call
           * revealLine on the view zone end location second here.
           */
          editor.revealLine(selectionStartPos.lineNumber);
          editor.revealLine(selectionEndPos.lineNumber + 1);
        });
      }}
    />
  );
}

function isRootNode(node: Node): boolean {
  return !node.parent;
}

function createExplanationWidget(
  monaco: Monaco,
  width: number,
  position: IPosition
): IContentWidget & { domNode: HTMLDivElement | null } {
  return {
    // Cached domNode
    domNode: null,
    getId: () => 'content.widget',
    getDomNode: function () {
      if (!this.domNode) {
        this.domNode = document.createElement('div');
        this.domNode.innerHTML = `
<div class="space-y-2 text-xs leading-8">
  <h2 class="font-bold text-xl text-blue-800 font-mono">affected</h2>

  <p>Default options for <code class="bg-blue-100 text-blue-800 px-2 py-1 rounded">nx affected</code></p>

  <!-- <h3 class="font-semibold text-lg">Your Config</h3> -->
  <hr class="!my-4 border-blue-200" />
  
  <p>You have configured a <code class="bg-blue-100 text-blue-800 px-2 py-1 rounded">defaultBase</code> value of <code class="bg-blue-100 text-blue-800 px-2 py-1 rounded">master</code>, which means that whenever you run an affected command such as <code class="bg-blue-100 text-blue-800 px-2 py-1 rounded">nx affected:build</code>, it is the same as if you had run <code class="bg-blue-100 text-blue-800 px-2 py-1 rounded">nx affected:build --base=master</code></p>
</div>
`;
        // this.domNode.style.background = 'grey';
        this.domNode.classList.add(
          ...['bg-blue-50', `w-[${width}px]`, 'px-6', 'py-6']
        );
      }
      return this.domNode;
    },
    getPosition: function () {
      return {
        position,
        preference: [
          // monaco.editor.ContentWidgetPositionPreference.ABOVE,
          monaco.editor.ContentWidgetPositionPreference.BELOW,
        ],
      };
    },
  };
}

// Taken from nx's own nx.json
function getNxJsonContents() {
  return {
    implicitDependencies: {
      'package.json': '*',
      '.eslintrc.json': '*',
      'scripts/vercel/*': ['nx-dev'],
      '.circleci/config.yml': '*',
      'tools/eslint-rules/**/*': '*',
    },
    affected: {
      defaultBase: 'master',
    },
    npmScope: 'nrwl',
    tasksRunnerOptions: {
      default: {
        runner: '@nrwl/nx-cloud',
        options: {
          accessToken:
            'YzVhYjFiNzAtYTYxZS00OWM3LTlkOGYtZjRmOGRlNDY4MTJhfHJlYWQtd3JpdGU=',
          cacheableOperations: [
            'build',
            'build-base',
            'test',
            'lint',
            'e2e',
            'sitemap',
          ],
          useDaemonProcess: true,
          runtimeCacheInputs: [
            'echo $SELECTED_CLI',
            'echo $NX_E2E_CI_CACHE_KEY',
          ],
          cacheDirectory: '/tmp/nx-cache',
          parallel: 1,
        },
      },
    },
    targetDependencies: {
      build: [
        {
          target: 'build-base',
          projects: 'self',
        },
      ],
      'build-base': [
        {
          target: 'build-base',
          projects: 'dependencies',
        },
      ],
    },
    workspaceLayout: {
      libsDir: '',
      appsDir: '',
    },
    cli: {
      defaultCollection: '@nrwl/react',
    },
    generators: {
      '@nrwl/react': {
        application: {
          style: 'css',
          linter: 'eslint',
          babel: true,
        },
        component: {
          style: 'css',
        },
        library: {
          style: 'css',
          linter: 'eslint',
        },
      },
    },
    pluginsConfig: {
      '@nrwl/jest': {
        hashingExcludesTestsOfDeps: true,
      },
      '@nrwl/cypress': {
        hashingExcludesTestsOfDeps: true,
      },
    },
    defaultProject: 'dep-graph-client',
  };
}
