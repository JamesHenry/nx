import * as ts from 'typescript';

function fileNameToScriptKind(fileName: string): ts.ScriptKind {
  if (fileName.endsWith('.ts')) return ts.ScriptKind.TS;
  if (fileName.endsWith('.js')) return ts.ScriptKind.JS;
  if (fileName.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (fileName.endsWith('.jsx')) return ts.ScriptKind.JSX;
  return ts.ScriptKind.Unknown;
}

// JH: modified
export function getSourceFile(fileName: string, contents: string) {
  return ts.createSourceFile(
    fileName,
    contents,
    ts.ScriptTarget.ESNext,
    true,
    fileNameToScriptKind(fileName)
  );
}

export function commentText(
  sourceText: string,
  comment: ts.CommentRange
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
export function forEachToken(
  node: ts.Node,
  cb: (node: ts.Node) => void,
  sourceFile: ts.SourceFile = node.getSourceFile()
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

export type ForEachTokenCallback = (
  fullText: string,
  kind: ts.SyntaxKind,
  range: ts.TextRange,
  parent: ts.Node
) => void;
/**
 * Iterate over all tokens and trivia of `node`
 *
 * @description JsDoc comments are treated like regular comments
 *
 * @param node The node whose tokens should be visited
 * @param cb Is called for every token contained in `node` and trivia before the token
 */
export function forEachTokenWithTrivia(
  node: ts.Node,
  cb: ForEachTokenCallback,
  sourceFile: ts.SourceFile = node.getSourceFile()
) {
  const fullText = sourceFile.text;
  const scanner = ts.createScanner(
    sourceFile.languageVersion,
    false,
    sourceFile.languageVariant,
    fullText
  );
  return forEachToken(
    node,
    (token) => {
      const tokenStart =
        token.kind === ts.SyntaxKind.JsxText || token.pos === token.end
          ? token.pos
          : token.getStart(sourceFile);
      if (tokenStart !== token.pos) {
        // we only have to handle trivia before each token. whitespace at the end of the file is followed by EndOfFileToken
        scanner.setTextPos(token.pos);
        let kind = scanner.scan();
        let pos = scanner.getTokenPos();
        while (pos < tokenStart) {
          const textPos = scanner.getTextPos();
          cb(fullText, kind, { pos, end: textPos }, token.parent!);
          if (textPos === tokenStart) break;
          kind = scanner.scan();
          pos = scanner.getTokenPos();
        }
      }
      return cb(
        fullText,
        token.kind,
        { end: token.end, pos: tokenStart },
        token.parent!
      );
    },
    sourceFile
  );
}

export type ForEachCommentCallback = (
  fullText: string,
  comment: ts.CommentRange
) => void;

/** Iterate over all comments owned by `node` or its children */
export function forEachComment(
  node: ts.Node,
  cb: ForEachCommentCallback,
  sourceFile: ts.SourceFile = node.getSourceFile()
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
          token.pos === 0 ? (ts.getShebang(fullText) || '').length : token.pos,
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
  function commentCallback(pos: number, end: number, kind: ts.CommentKind) {
    cb(fullText, { pos, end, kind });
  }
}

/** Exclude trailing positions that would lead to scanning for trivia inside JsxText */
function canHaveTrailingTrivia(token: ts.Node): boolean {
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
  node: ts.Node
): node is ts.JsxElement | ts.JsxFragment {
  return (
    node.kind === ts.SyntaxKind.JsxElement ||
    node.kind === ts.SyntaxKind.JsxFragment
  );
}
