import type * as _ts from 'typescript';
import type {
  AmdDependency,
  CheckJsDirective,
  FileReference,
  PreProcessedFileInfo,
  ScriptTarget,
  SyntaxKind,
} from 'typescript';
import {
  binarySearch,
  compareValues,
  forEach,
  identity,
  lastOrUndefined,
  length,
  map,
  noop,
  toArray,
} from './utils';

type PragmaMap = any;
type PragmaPseudoMapEntry = any;
type PragmaPseudoMap = any;
type PragmaDefinition = any;
type PragmaKindFlags = any;

interface PragmaContext {
  languageVersion: ScriptTarget;
  pragmas?: PragmaMap;
  checkJsDirective?: CheckJsDirective;
  referencedFiles: FileReference[];
  typeReferenceDirectives: FileReference[];
  libReferenceDirectives: FileReference[];
  amdDependencies: AmdDependency[];
  hasNoDefaultLib?: boolean;
  moduleName?: string;
}

export function createPreProcessFile(ts: typeof _ts) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true);
  const SyntaxKind = ts.SyntaxKind;
  const ScriptTarget = ts.ScriptTarget;
  const CharacterCodes = (ts as any).CharacterCodes;

  function isKeyword(token: SyntaxKind) {
    return (
      ts.SyntaxKind.FirstKeyword <= token && token <= ts.SyntaxKind.LastKeyword
    );
  }

  function isLineBreak(ch: number): boolean {
    // ES5 7.3:
    // The ECMAScript line terminator characters are listed in Table 3.
    //     Table 3: Line Terminator Characters
    //     Code Unit Value     Name                    Formal Name
    //     \u000A              Line Feed               <LF>
    //     \u000D              Carriage Return         <CR>
    //     \u2028              Line separator          <LS>
    //     \u2029              Paragraph separator     <PS>
    // Only the characters in Table 3 are treated as line terminators. Other new line or line
    // breaking characters are treated as white space but not as line terminators.

    return (
      ch === CharacterCodes.lineFeed ||
      ch === CharacterCodes.carriageReturn ||
      ch === CharacterCodes.lineSeparator ||
      ch === CharacterCodes.paragraphSeparator
    );
  }

  function computeLineStarts(text: string): number[] {
    const result: number[] = new Array();
    let pos = 0;
    let lineStart = 0;
    while (pos < text.length) {
      const ch = text.charCodeAt(pos);
      pos++;
      switch (ch) {
        case CharacterCodes.carriageReturn:
          if (text.charCodeAt(pos) === CharacterCodes.lineFeed) {
            pos++;
          }
        // falls through
        case CharacterCodes.lineFeed:
          result.push(lineStart);
          lineStart = pos;
          break;
        default:
          if (ch > CharacterCodes.maxAsciiCharacter && isLineBreak(ch)) {
            result.push(lineStart);
            lineStart = pos;
          }
          break;
      }
    }
    result.push(lineStart);
    return result;
  }

  /**
   * @internal
   * We assume the first line starts at position 0 and 'position' is non-negative.
   */
  function computeLineOfPosition(
    lineStarts: readonly number[],
    position: number,
    lowerBound?: number
  ) {
    let lineNumber = binarySearch(
      lineStarts,
      position,
      identity,
      compareValues,
      lowerBound
    );
    if (lineNumber < 0) {
      // If the actual position was not found,
      // the binary search returns the 2's-complement of the next line start
      // e.g. if the line starts at [5, 10, 23, 80] and the position requested was 20
      // then the search will return -2.
      //
      // We want the index of the previous line start, so we subtract 1.
      // Review 2's-complement if this is confusing.
      lineNumber = ~lineNumber - 1;
      if (lineNumber === -1) {
        throw new Error('position cannot precede the beginning of the file');
      }
    }
    return lineNumber;
  }

  function fileNameToScriptKind(fileName: string): _ts.ScriptKind {
    if (fileName.endsWith('.ts')) return ts.ScriptKind.TS;
    if (fileName.endsWith('.js')) return ts.ScriptKind.JS;
    if (fileName.endsWith('.tsx')) return ts.ScriptKind.TSX;
    if (fileName.endsWith('.jsx')) return ts.ScriptKind.JSX;
    return ts.ScriptKind.Unknown;
  }

  function getSourceFile(fileName: string, contents: string) {
    return ts.createSourceFile(
      fileName,
      contents,
      ts.ScriptTarget.ESNext,
      true,
      fileNameToScriptKind(fileName)
    );
  }

  function getCommentText(
    sourceText: string,
    comment: _ts.CommentRange
  ): string {
    return sourceText.substring(
      comment.pos + 2,
      comment.kind === ts.SyntaxKind.SingleLineCommentTrivia
        ? comment.end
        : comment.end - 2
    );
  }

  /**
   * Iterate over all tokens of `node`
   *
   * @param node The node whose tokens should be visited
   * @param cb Is called for every token contained in `node`
   */
  function forEachToken(
    node: _ts.Node,
    cb: (node: _ts.Node) => void,
    sourceFile: _ts.SourceFile = node.getSourceFile()
  ) {
    const queue = [];
    while (true) {
      if (ts.isTokenKind(node.kind)) {
        cb(node);
      } else if (node.kind !== ts.SyntaxKind.JSDocComment) {
        const children = node.getChildren(sourceFile);
        if (children.length === 1) {
          node = children[0];
          continue;
        }
        for (let i = children.length - 1; i >= 0; --i) queue.push(children[i]); // add children in reverse order, when we pop the next element from the queue, it's the first child
      }
      if (queue.length === 0) break;
      node = queue.pop()!;
    }
  }

  type ForEachTokenCallback = (
    fullText: string,
    kind: _ts.SyntaxKind,
    range: _ts.TextRange,
    parent: _ts.Node
  ) => void;

  type ForEachCommentCallback = (
    fullText: string,
    comment: _ts.CommentRange
  ) => void;

  /** Iterate over all comments owned by `node` or its children */
  function forEachComment(
    node: _ts.Node,
    cb: ForEachCommentCallback,
    sourceFile: _ts.SourceFile = node.getSourceFile()
  ) {
    /* Visit all tokens and skip trivia.
       Comment ranges between tokens are parsed without the need of a scanner.
       forEachTokenWithWhitespace does intentionally not pay attention to the correct comment ownership of nodes as it always
       scans all trivia before each token, which could include trailing comments of the previous token.
       Comment onwership is done right in this function*/
    const fullText = sourceFile.text;
    const notJsx = sourceFile.languageVariant !== ts.LanguageVariant.JSX;
    return forEachToken(
      node,
      (token) => {
        if (token.pos === token.end) return;
        if (token.kind !== ts.SyntaxKind.JsxText)
          ts.forEachLeadingCommentRange(
            fullText,
            // skip shebang at position 0
            token.pos === 0
              ? (ts.getShebang(fullText) || '').length
              : token.pos,
            commentCallback
          );
        if (notJsx || canHaveTrailingTrivia(token))
          return ts.forEachTrailingCommentRange(
            fullText,
            token.end,
            commentCallback
          );
      },
      sourceFile
    );
    function commentCallback(pos: number, end: number, kind: _ts.CommentKind) {
      cb(fullText, { pos, end, kind });
    }
  }

  /** Exclude trailing positions that would lead to scanning for trivia inside JsxText */
  function canHaveTrailingTrivia(token: _ts.Node): boolean {
    switch (token.kind) {
      case ts.SyntaxKind.CloseBraceToken:
        // after a JsxExpression inside a JsxElement's body can only be other JsxChild, but no trivia
        return (
          token.parent!.kind !== ts.SyntaxKind.JsxExpression ||
          !isJsxElementOrFragment(token.parent!.parent!)
        );
      case ts.SyntaxKind.GreaterThanToken:
        switch (token.parent!.kind) {
          case ts.SyntaxKind.JsxOpeningElement:
            // if end is not equal, this is part of the type arguments list. in all other cases it would be inside the element body
            return token.end !== token.parent!.end;
          case ts.SyntaxKind.JsxOpeningFragment:
            return false; // would be inside the fragment
          case ts.SyntaxKind.JsxSelfClosingElement:
            return (
              token.end !== token.parent!.end || // if end is not equal, this is part of the type arguments list
              !isJsxElementOrFragment(token.parent!.parent!)
            ); // there's only trailing trivia if it's the end of the top element
          case ts.SyntaxKind.JsxClosingElement:
          case ts.SyntaxKind.JsxClosingFragment:
            // there's only trailing trivia if it's the end of the top element
            return !isJsxElementOrFragment(token.parent!.parent!.parent!);
        }
    }
    return true;
  }

  function isJsxElementOrFragment(
    node: _ts.Node
  ): node is _ts.JsxElement | _ts.JsxFragment {
    return (
      node.kind === ts.SyntaxKind.JsxElement ||
      node.kind === ts.SyntaxKind.JsxFragment
    );
  }

  // ---------------------------------------------------------------------------------------------

  const commentPragmas = {
    reference: {
      args: [
        { name: 'types', optional: true, captureSpan: true },
        { name: 'lib', optional: true, captureSpan: true },
        { name: 'path', optional: true, captureSpan: true },
        { name: 'no-default-lib', optional: true },
      ],
      kind: 1 /* TripleSlashXML */,
    },
    'amd-dependency': {
      args: [{ name: 'path' }, { name: 'name', optional: true }],
      kind: 1 /* TripleSlashXML */,
    },
    'amd-module': {
      args: [{ name: 'name' }],
      kind: 1 /* TripleSlashXML */,
    },
    'ts-check': {
      kind: 2 /* SingleLine */,
    },
    'ts-nocheck': {
      kind: 2 /* SingleLine */,
    },
    jsx: {
      args: [{ name: 'factory' }],
      kind: 4 /* MultiLine */,
    },
    jsxfrag: {
      args: [{ name: 'factory' }],
      kind: 4 /* MultiLine */,
    },
    jsximportsource: {
      args: [{ name: 'factory' }],
      kind: 4 /* MultiLine */,
    },
    jsxruntime: {
      args: [{ name: 'factory' }],
      kind: 4 /* MultiLine */,
    },
  };

  const namedArgRegExCache = new Map<string, RegExp>();
  function getNamedArgRegEx(name: string): RegExp {
    if (namedArgRegExCache.has(name)) {
      return namedArgRegExCache.get(name)!;
    }
    const result = new RegExp(
      `(\\s${name}\\s*=\\s*)(?:(?:'([^']*)')|(?:"([^"]*)"))`,
      'im'
    );
    namedArgRegExCache.set(name, result);
    return result;
  }

  const tripleSlashXMLCommentStartRegEx = /^\/\/\/\s*<(\S+)\s.*?\/>/im;
  const singleLinePragmaRegEx = /^\/\/\/?\s*@(\S+)\s*(.*)\s*$/im;

  function extractPragmas(
    pragmas: PragmaPseudoMapEntry[],
    range: _ts.CommentRange,
    text: string
  ) {
    const tripleSlash =
      range.kind === SyntaxKind.SingleLineCommentTrivia &&
      tripleSlashXMLCommentStartRegEx.exec(text);
    if (tripleSlash) {
      const name = tripleSlash[1].toLowerCase() as keyof PragmaPseudoMap; // Technically unsafe cast, but we do it so the below check to make it safe typechecks
      const pragma = commentPragmas[name] as PragmaDefinition;
      if (
        !pragma ||
        !(pragma.kind! & (ts as any).PragmaKindFlags.TripleSlashXML)
      ) {
        return;
      }
      if (pragma.args) {
        const argument: {
          [index: string]: string | { value: string; pos: number; end: number };
        } = {};
        for (const arg of pragma.args) {
          const matcher = getNamedArgRegEx(arg.name);
          const matchResult = matcher.exec(text);
          if (!matchResult && !arg.optional) {
            return; // Missing required argument, don't parse
          } else if (matchResult) {
            const value = matchResult[2] || matchResult[3];
            if (arg.captureSpan) {
              const startPos =
                range.pos + matchResult.index + matchResult[1].length + 1;
              argument[arg.name] = {
                value,
                pos: startPos,
                end: startPos + value.length,
              };
            } else {
              argument[arg.name] = value;
            }
          }
        }
        pragmas.push({
          name,
          args: { arguments: argument, range },
        } as PragmaPseudoMapEntry);
      } else {
        pragmas.push({
          name,
          args: { arguments: {}, range },
        } as PragmaPseudoMapEntry);
      }
      return;
    }

    const singleLine =
      range.kind === SyntaxKind.SingleLineCommentTrivia &&
      singleLinePragmaRegEx.exec(text);
    if (singleLine) {
      return addPragmaForMatch(
        pragmas,
        range,
        (ts as any).PragmaKindFlags.SingleLine,
        singleLine
      );
    }

    if (range.kind === SyntaxKind.MultiLineCommentTrivia) {
      const multiLinePragmaRegEx = /@(\S+)(\s+.*)?$/gim; // Defined inline since it uses the "g" flag, which keeps a persistent index (for iterating)
      let multiLineMatch: RegExpExecArray | null;
      while ((multiLineMatch = multiLinePragmaRegEx.exec(text))) {
        addPragmaForMatch(
          pragmas,
          range,
          (ts as any).PragmaKindFlags.MultiLine,
          multiLineMatch
        );
      }
    }
  }

  function addPragmaForMatch(
    pragmas: PragmaPseudoMapEntry[],
    range: _ts.CommentRange,
    kind: PragmaKindFlags,
    match: RegExpExecArray
  ) {
    if (!match) return;
    const name = match[1].toLowerCase() as keyof PragmaPseudoMap; // Technically unsafe cast, but we do it so they below check to make it safe typechecks
    const pragma = commentPragmas[name] as PragmaDefinition;
    if (!pragma || !(pragma.kind! & kind)) {
      return;
    }
    const args = match[2]; // Split on spaces and match up positionally with definition
    const argument = getNamedPragmaArguments(pragma, args);
    if (argument === 'fail') return; // Missing required argument, fail to parse it
    pragmas.push({
      name,
      args: { arguments: argument, range },
    } as PragmaPseudoMapEntry);
    return;
  }

  function getNamedPragmaArguments(
    pragma: PragmaDefinition,
    text: string | undefined
  ): { [index: string]: string } | 'fail' {
    if (!text) return {};
    if (!pragma.args) return {};
    const args = text.trim().split(/\s+/);
    const argMap: { [index: string]: string } = {};
    for (let i = 0; i < pragma.args.length; i++) {
      const argument = pragma.args[i];
      if (!args[i] && !argument.optional) {
        return 'fail';
      }
      if (argument.captureSpan) {
        throw new Error(
          'Capture spans not yet implemented for non-xml pragmas'
        );
      }
      argMap[argument.name] = args[i];
    }
    return argMap;
  }

  function processCommentPragmas(
    context: PragmaContext,
    sourceText: string
  ): void {
    const pragmas: any[] = [];

    for (const range of ts.getLeadingCommentRanges(sourceText, 0) || []) {
      const comment = sourceText.substring(range.pos, range.end);
      extractPragmas(pragmas, range, comment);
    }

    context.pragmas = new Map() as PragmaMap;
    for (const pragma of pragmas) {
      if (context.pragmas.has(pragma.name)) {
        const currentValue = context.pragmas.get(pragma.name);
        if (currentValue instanceof Array) {
          currentValue.push(pragma.args);
        } else {
          context.pragmas.set(pragma.name, [currentValue, pragma.args]);
        }
        continue;
      }
      context.pragmas.set(pragma.name, pragma.args);
    }
  }

  function processPragmasIntoFields(context, reportDiagnostic) {
    context.checkJsDirective = undefined;
    context.referencedFiles = [];
    context.typeReferenceDirectives = [];
    context.libReferenceDirectives = [];
    context.amdDependencies = [];
    context.hasNoDefaultLib = false;

    context.pragmas.forEach(function (entryOrList, key) {
      // TODO: The below should be strongly type-guarded and not need casts/explicit annotations, since entryOrList is related to
      // key and key is constrained to a union; but it's not (see GH#21483 for at least partial fix) :(
      switch (key) {
        case 'reference': {
          var referencedFiles_1 = context.referencedFiles;
          var typeReferenceDirectives_1 = context.typeReferenceDirectives;
          var libReferenceDirectives_1 = context.libReferenceDirectives;
          forEach(toArray(entryOrList), function (arg) {
            var _a = arg.arguments,
              types = _a.types,
              lib = _a.lib,
              path = _a.path;
            if (arg.arguments['no-default-lib']) {
              context.hasNoDefaultLib = true;
            } else if (types) {
              typeReferenceDirectives_1.push({
                pos: types.pos,
                end: types.end,
                fileName: types.value,
              });
            } else if (lib) {
              libReferenceDirectives_1.push({
                pos: lib.pos,
                end: lib.end,
                fileName: lib.value,
              });
            } else if (path) {
              referencedFiles_1.push({
                pos: path.pos,
                end: path.end,
                fileName: path.value,
              });
            } else {
              reportDiagnostic(
                arg.range.pos,
                arg.range.end - arg.range.pos,
                (ts as any).Diagnostics.Invalid_reference_directive_syntax
              );
            }
          });
          break;
        }
        case 'amd-dependency': {
          context.amdDependencies = map(toArray(entryOrList), function (x) {
            return { name: x.arguments.name, path: x.arguments.path };
          });
          break;
        }
        case 'amd-module': {
          if (entryOrList instanceof Array) {
            for (
              var _i = 0, entryOrList_1 = entryOrList;
              _i < entryOrList_1.length;
              _i++
            ) {
              var entry = entryOrList_1[_i];
              if (context.moduleName) {
                // TODO: It's probably fine to issue this diagnostic on all instances of the pragma
                reportDiagnostic(
                  entry.range.pos,
                  entry.range.end - entry.range.pos,
                  (ts as any).Diagnostics
                    .An_AMD_module_cannot_have_multiple_name_assignments
                );
              }
              context.moduleName = entry.arguments.name;
            }
          } else {
            context.moduleName = entryOrList.arguments.name;
          }
          break;
        }
        case 'ts-nocheck':
        case 'ts-check': {
          // _last_ of either nocheck or check in a file is the "winner"
          forEach(toArray(entryOrList), function (entry) {
            if (
              !context.checkJsDirective ||
              entry.range.pos > context.checkJsDirective.pos
            ) {
              context.checkJsDirective = {
                enabled: key === 'ts-check',
                end: entry.range.end,
                pos: entry.range.pos,
              };
            }
          });
          break;
        }
        case 'jsx':
        case 'jsxfrag':
        case 'jsximportsource':
        case 'jsxruntime':
          return; // Accessed directly

        default:
          throw new Error('Unhandled pragma kind'); // Can this be made into an assertNever in the future?
      }
    });
  }

  return function preProcessFile(
    sourceText: string,
    readImportFiles = true,
    detectJavaScriptImports = false,
    // JH: modified added arg
    filePath: string
  ): PreProcessedFileInfo {
    const pragmaContext: PragmaContext = {
      languageVersion: ScriptTarget.ES5, // controls whether the token scanner considers unicode identifiers or not - shouldn't matter, since we're only using it for trivia
      pragmas: undefined,
      checkJsDirective: undefined,
      referencedFiles: [],
      typeReferenceDirectives: [],
      libReferenceDirectives: [],
      amdDependencies: [],
      hasNoDefaultLib: undefined,
      moduleName: undefined,
    };
    // JH: modified, made let
    let importedFiles: FileReference[] = [];
    let ambientExternalModules:
      | { ref: FileReference; depth: number }[]
      | undefined;
    let lastToken: SyntaxKind;
    let currentToken: SyntaxKind;
    let braceNesting = 0;
    // assume that text represent an external module if it contains at least one top level import/export
    // ambient modules that are found inside external modules are interpreted as module augmentations
    let externalModule = false;

    function nextToken() {
      lastToken = currentToken;
      currentToken = scanner.scan();
      if (currentToken === SyntaxKind.OpenBraceToken) {
        braceNesting++;
      } else if (currentToken === SyntaxKind.CloseBraceToken) {
        braceNesting--;
      }
      return currentToken;
    }

    function getFileReference() {
      const fileName = scanner.getTokenValue();
      const pos = scanner.getTokenPos();
      return { fileName, pos, end: pos + fileName.length };
    }

    function recordAmbientExternalModule(): void {
      if (!ambientExternalModules) {
        ambientExternalModules = [];
      }
      ambientExternalModules.push({
        ref: getFileReference(),
        depth: braceNesting,
      });
    }

    function recordModuleName() {
      importedFiles.push(getFileReference());

      markAsExternalModuleIfTopLevel();
    }

    function markAsExternalModuleIfTopLevel() {
      if (braceNesting === 0) {
        externalModule = true;
      }
    }

    /**
     * Returns true if at least one token was consumed from the stream
     */
    function tryConsumeDeclare(): boolean {
      let token = scanner.getToken();
      if (token === SyntaxKind.DeclareKeyword) {
        // declare module "mod"
        token = nextToken();
        if (token === SyntaxKind.ModuleKeyword) {
          token = nextToken();
          if (token === SyntaxKind.StringLiteral) {
            recordAmbientExternalModule();
          }
        }
        return true;
      }

      return false;
    }

    /**
     * Returns true if at least one token was consumed from the stream
     */
    function tryConsumeImport(): boolean {
      if (lastToken === SyntaxKind.DotToken) {
        return false;
      }
      let token = scanner.getToken();
      if (token === SyntaxKind.ImportKeyword) {
        token = nextToken();
        if (token === SyntaxKind.OpenParenToken) {
          token = nextToken();
          if (
            token === SyntaxKind.StringLiteral ||
            token === SyntaxKind.NoSubstitutionTemplateLiteral
          ) {
            // import("mod");
            recordModuleName();
            return true;
          }
        } else if (token === SyntaxKind.StringLiteral) {
          // import "mod";
          recordModuleName();
          return true;
        } else {
          if (token === SyntaxKind.TypeKeyword) {
            const skipTypeKeyword = scanner.lookAhead(() => {
              const token = scanner.scan();
              return (
                token !== SyntaxKind.FromKeyword &&
                (token === SyntaxKind.AsteriskToken ||
                  token === SyntaxKind.OpenBraceToken ||
                  token === SyntaxKind.Identifier ||
                  isKeyword(token))
              );
            });
            if (skipTypeKeyword) {
              token = nextToken();
            }
          }

          if (token === SyntaxKind.Identifier || isKeyword(token)) {
            token = nextToken();
            if (token === SyntaxKind.FromKeyword) {
              token = nextToken();
              if (token === SyntaxKind.StringLiteral) {
                // import d from "mod";
                recordModuleName();
                return true;
              }
            } else if (token === SyntaxKind.EqualsToken) {
              if (tryConsumeRequireCall(/*skipCurrentToken*/ true)) {
                return true;
              }
            } else if (token === SyntaxKind.CommaToken) {
              // consume comma and keep going
              token = nextToken();
            } else {
              // unknown syntax
              return true;
            }
          }

          if (token === SyntaxKind.OpenBraceToken) {
            token = nextToken();
            // consume "{ a as B, c, d as D}" clauses
            // make sure that it stops on EOF
            while (
              token !== SyntaxKind.CloseBraceToken &&
              token !== SyntaxKind.EndOfFileToken
            ) {
              token = nextToken();
            }

            if (token === SyntaxKind.CloseBraceToken) {
              token = nextToken();
              if (token === SyntaxKind.FromKeyword) {
                token = nextToken();
                if (token === SyntaxKind.StringLiteral) {
                  // import {a as A} from "mod";
                  // import d, {a, b as B} from "mod"
                  recordModuleName();
                }
              }
            }
          } else if (token === SyntaxKind.AsteriskToken) {
            token = nextToken();
            if (token === SyntaxKind.AsKeyword) {
              token = nextToken();
              if (token === SyntaxKind.Identifier || isKeyword(token)) {
                token = nextToken();
                if (token === SyntaxKind.FromKeyword) {
                  token = nextToken();
                  if (token === SyntaxKind.StringLiteral) {
                    // import * as NS from "mod"
                    // import d, * as NS from "mod"
                    recordModuleName();
                  }
                }
              }
            }
          }
        }

        return true;
      }

      return false;
    }

    function tryConsumeExport(): boolean {
      let token = scanner.getToken();
      if (token === SyntaxKind.ExportKeyword) {
        markAsExternalModuleIfTopLevel();
        token = nextToken();
        if (token === SyntaxKind.TypeKeyword) {
          const skipTypeKeyword = scanner.lookAhead(() => {
            const token = scanner.scan();
            return (
              token === SyntaxKind.AsteriskToken ||
              token === SyntaxKind.OpenBraceToken
            );
          });
          if (skipTypeKeyword) {
            token = nextToken();
          }
        }
        if (token === SyntaxKind.OpenBraceToken) {
          token = nextToken();
          // consume "{ a as B, c, d as D}" clauses
          // make sure it stops on EOF
          while (
            token !== SyntaxKind.CloseBraceToken &&
            token !== SyntaxKind.EndOfFileToken
          ) {
            token = nextToken();
          }

          if (token === SyntaxKind.CloseBraceToken) {
            token = nextToken();
            if (token === SyntaxKind.FromKeyword) {
              token = nextToken();
              if (token === SyntaxKind.StringLiteral) {
                // export {a as A} from "mod";
                // export {a, b as B} from "mod"
                recordModuleName();
              }
            }
          }
        } else if (token === SyntaxKind.AsteriskToken) {
          token = nextToken();
          if (token === SyntaxKind.FromKeyword) {
            token = nextToken();
            if (token === SyntaxKind.StringLiteral) {
              // export * from "mod"
              recordModuleName();
            }
          // JH: added support form export * as NS from "mod"
          } else if (token === SyntaxKind.AsKeyword) {
            token = nextToken();
            if (token === SyntaxKind.Identifier || isKeyword(token)) {
              token = nextToken();
              if (token === SyntaxKind.FromKeyword) {
                token = nextToken();
                if (token === SyntaxKind.StringLiteral) {
                  // export * as NS from "mod"
                  recordModuleName();
                }
              }
            }
          }
        } else if (token === SyntaxKind.ImportKeyword) {
          token = nextToken();
          if (token === SyntaxKind.TypeKeyword) {
            const skipTypeKeyword = scanner.lookAhead(() => {
              const token = scanner.scan();
              return token === SyntaxKind.Identifier || isKeyword(token);
            });
            if (skipTypeKeyword) {
              token = nextToken();
            }
          }
          if (token === SyntaxKind.Identifier || isKeyword(token)) {
            token = nextToken();
            if (token === SyntaxKind.EqualsToken) {
              if (tryConsumeRequireCall(/*skipCurrentToken*/ true)) {
                return true;
              }
            }
          }
        }

        return true;
      }

      return false;
    }

    function tryConsumeRequireCall(
      skipCurrentToken: boolean,
      allowTemplateLiterals = false
    ): boolean {
      let token = skipCurrentToken ? nextToken() : scanner.getToken();
      if (token === SyntaxKind.RequireKeyword) {
        token = nextToken();
        if (token === SyntaxKind.OpenParenToken) {
          token = nextToken();
          if (
            token === SyntaxKind.StringLiteral ||
            (allowTemplateLiterals &&
              token === SyntaxKind.NoSubstitutionTemplateLiteral)
          ) {
            //  require("mod");
            recordModuleName();
          }
        }
        return true;
      }
      return false;
    }

    function tryConsumeDefine(): boolean {
      let token = scanner.getToken();
      if (
        token === SyntaxKind.Identifier &&
        scanner.getTokenValue() === 'define'
      ) {
        token = nextToken();
        if (token !== SyntaxKind.OpenParenToken) {
          return true;
        }

        token = nextToken();
        if (
          token === SyntaxKind.StringLiteral ||
          token === SyntaxKind.NoSubstitutionTemplateLiteral
        ) {
          // looks like define ("modname", ... - skip string literal and comma
          token = nextToken();
          if (token === SyntaxKind.CommaToken) {
            token = nextToken();
          } else {
            // unexpected token
            return true;
          }
        }

        // should be start of dependency list
        if (token !== SyntaxKind.OpenBracketToken) {
          return true;
        }

        // skip open bracket
        token = nextToken();
        // scan until ']' or EOF
        while (
          token !== SyntaxKind.CloseBracketToken &&
          token !== SyntaxKind.EndOfFileToken
        ) {
          // record string literals as module names
          if (
            token === SyntaxKind.StringLiteral ||
            token === SyntaxKind.NoSubstitutionTemplateLiteral
          ) {
            recordModuleName();
          }

          token = nextToken();
        }
        return true;
      }
      return false;
    }

    function processImports(): void {
      scanner.setText(sourceText);
      nextToken();
      // Look for:
      //    import "mod";
      //    import d from "mod"
      //    import {a as A } from "mod";
      //    import * as NS from "mod"
      //    import d, {a, b as B} from "mod"
      //    import i = require("mod");
      //    import("mod");

      //    export * from "mod"
      //    export {a as b} from "mod"
      //    export import i = require("mod")
      //    (for JavaScript files) require("mod")

      // Do not look for:
      //    AnySymbol.import("mod")
      //    AnySymbol.nested.import("mod")

      while (true) {
        if (scanner.getToken() === SyntaxKind.EndOfFileToken) {
          break;
        }

        if (scanner.getToken() === SyntaxKind.TemplateHead) {
          const stack = [scanner.getToken()];
          let token = scanner.scan();
          loop: while (length(stack)) {
            switch (token) {
              case SyntaxKind.EndOfFileToken:
                break loop;
              case SyntaxKind.ImportKeyword:
                tryConsumeImport();
                break;
              case SyntaxKind.TemplateHead:
                stack.push(token);
                break;
              case SyntaxKind.OpenBraceToken:
                if (length(stack)) {
                  stack.push(token);
                }
                break;
              case SyntaxKind.CloseBraceToken:
                if (length(stack)) {
                  if (lastOrUndefined(stack) === SyntaxKind.TemplateHead) {
                    if (
                      scanner.reScanTemplateToken(
                        /* isTaggedTemplate */ false
                      ) === SyntaxKind.TemplateTail
                    ) {
                      stack.pop();
                    }
                  } else {
                    stack.pop();
                  }
                }
                break;
            }
            token = scanner.scan();
          }
          nextToken();
        }

        // check if at least one of alternative have moved scanner forward
        if (
          tryConsumeDeclare() ||
          tryConsumeImport() ||
          tryConsumeExport() ||
          (detectJavaScriptImports &&
            (tryConsumeRequireCall(
              /*skipCurrentToken*/ false,
              /*allowTemplateLiterals*/ true
            ) ||
              tryConsumeDefine()))
        ) {
          continue;
        } else {
          nextToken();
        }
      }

      scanner.setText(undefined);
    }

    if (readImportFiles) {
      processImports();
    }
    processCommentPragmas(pragmaContext, sourceText);
    processPragmasIntoFields(pragmaContext, noop);

    // START JH MODIFIED ========================================================================

    /**
     * We only need to build a full sourceFile in one or more of the following cases:
     * 1. The source contains one or more nx-ignore-next-line comments
     * 2. The source contains legacy Angular loadChildren string syntax
     */
    let sourceFile: _ts.SourceFile | undefined;
    let lineStarts: number[] | undefined;

    const ignoredLines = new Set();

    const totalNxIgnoreNextLineOccurrences =
      sourceText.split('nx-ignore-next-line').length - 1;
    if (totalNxIgnoreNextLineOccurrences > 0) {
      if (!sourceFile) {
        sourceFile = getSourceFile(filePath, sourceText);
      }
      if (!lineStarts) {
        lineStarts = computeLineStarts(sourceText);
      }

      forEachComment(sourceFile, (_, comment) => {
        const commentTextContents = getCommentText(sourceText, comment)
          .trim()
          .toLowerCase();
        if (commentTextContents !== 'nx-ignore-next-line') {
          return;
        }

        const endLineNumberOfNxIgnoreComment = computeLineOfPosition(
          lineStarts,
          comment.end
        );

        const ignoredLine = endLineNumberOfNxIgnoreComment + 1;
        ignoredLines.add(ignoredLine);

        importedFiles = importedFiles.filter((file) => {
          const importLineNumber = computeLineOfPosition(lineStarts, file.pos);
          return importLineNumber !== ignoredLine;
        });
      });
    }

    const angularLoadChildrenLegacySyntaxUsage =
      /loadChildren[\s]*:[\s]*['|"|`]/;
    if (sourceText.match(angularLoadChildrenLegacySyntaxUsage)) {
      if (!sourceFile) {
        sourceFile = getSourceFile(filePath, sourceText);
      }
      if (!lineStarts) {
        lineStarts = computeLineStarts(sourceText);
      }

      function getPropertyAssignmentName(
        propertyAssignment: _ts.PropertyAssignment
      ) {
        switch (true) {
          case ts.isIdentifier(propertyAssignment.name):
            return propertyAssignment.name.getText();
          case ts.isStringLiteral(propertyAssignment.name):
            return (propertyAssignment.name as _ts.StringLiteral).text;
          default:
            return null;
        }
      }

      function getStringLiteralValue(node: _ts.Node): string {
        return node.getText().slice(1, -1);
      }

      function visitor(node: _ts.Node) {
        if (ts.isPropertyAssignment(node)) {
          const name = getPropertyAssignmentName(node);
          if (name === 'loadChildren') {
            const init = node.initializer;
            // Only the legacy string syntax needs special handling
            if (
              !ts.isStringLiteral(init) &&
              !ts.isNoSubstitutionTemplateLiteral(init)
            ) {
              return;
            }

            const nodeLineNumber = computeLineOfPosition(lineStarts, init.pos);
            const isIgnored = ignoredLines.has(nodeLineNumber);
            if (!isIgnored) {
              const childrenExpr = getStringLiteralValue(init);
              if (childrenExpr) {
                importedFiles.push({
                  pos: init.pos,
                  end: init.end,
                  fileName: childrenExpr,
                });
              }
            }

            return; // stop traversing downwards
          }
        }
        node.forEachChild((childNode) => visitor(childNode));
      }

      sourceFile.forEachChild((node) => visitor(node));
    }

    // END JH MODIFIED ========================================================================

    if (externalModule) {
      // for external modules module all nested ambient modules are augmentations
      if (ambientExternalModules) {
        // move all detected ambient modules to imported files since they need to be resolved
        for (const decl of ambientExternalModules) {
          importedFiles.push(decl.ref);
        }
      }
      return {
        referencedFiles: pragmaContext.referencedFiles,
        typeReferenceDirectives: pragmaContext.typeReferenceDirectives,
        libReferenceDirectives: pragmaContext.libReferenceDirectives,
        importedFiles,
        isLibFile: !!pragmaContext.hasNoDefaultLib,
        ambientExternalModules: undefined,
      };
    } else {
      // for global scripts ambient modules still can have augmentations - look for ambient modules with depth > 0
      let ambientModuleNames: string[] | undefined;
      if (ambientExternalModules) {
        for (const decl of ambientExternalModules) {
          if (decl.depth === 0) {
            if (!ambientModuleNames) {
              ambientModuleNames = [];
            }
            ambientModuleNames.push(decl.ref.fileName);
          } else {
            importedFiles.push(decl.ref);
          }
        }
      }
      return {
        referencedFiles: pragmaContext.referencedFiles,
        typeReferenceDirectives: pragmaContext.typeReferenceDirectives,
        libReferenceDirectives: pragmaContext.libReferenceDirectives,
        importedFiles,
        isLibFile: !!pragmaContext.hasNoDefaultLib,
        ambientExternalModules: ambientModuleNames,
      };
    }
  };
}
