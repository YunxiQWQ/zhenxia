import type { Plugin } from 'vite';
import ts from 'typescript';
import { zhCN } from '../frontend/src/i18n/zh-CN';

// Resolve UI labels at render time. The build must retain the English source keys.
const reverse = new Map<string, string>();
for (const [key, value] of Object.entries(zhCN)) if (!reverse.has(value)) reverse.set(value, key);
const keyFor = (value: string) =>
  Object.prototype.hasOwnProperty.call(zhCN, value) ? value : reverse.get(value);
const uiProperties = new Set([
  'label',
  'title',
  'desc',
  'subtitle',
  'description',
  'heading',
  'message',
]);
const internalAttributes = new Set([
  'className',
  'id',
  'key',
  'role',
  'type',
  'value',
  'href',
  'src',
  'name',
]);
export function translateUiSource(code: string, id: string): string | null {
  const normalized = id.replace(/\\/g, '/').split('?')[0];
  if (
    !normalized.includes('/frontend/src/') ||
    normalized.includes('/i18n/') ||
    normalized.includes('.test.')
  )
    return null;
  if (
    !normalized.endsWith('.tsx') &&
    !/\/utils\/(clipDisplay|clipRowPresentation|contextMenuLabel|dateRange)\.ts$/.test(normalized)
  )
    return null;
  const source = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits: { start: number; end: number; value: string }[] = [];
  const bodies: { start: number; end?: number }[] = [];
  let translated = 0;
  const replace = (node: ts.Node, value: string) => {
    edits.push({ start: node.getStart(source), end: node.getEnd(), value });
    translated++;
  };
  function protectedCall(node: ts.Node): boolean {
    for (let p = node.parent; p; p = p.parent) {
      if (
        ts.isCallExpression(p) &&
        (/^(t|tGlobal|__uiT|invoke|listen|emit)$/.test(p.expression.getText(source)) ||
          /^(console\.|JSON\.)/.test(p.expression.getText(source)))
      )
        return true;
      if (ts.isFunctionLike(p)) break;
    }
    return false;
  }
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name && /^[A-Z]/.test(node.name.text) && node.body)
      bodies.push({ start: node.body.getStart(source) + 1 });
    if (
      ts.isFunctionExpression(node) &&
      node.body &&
      ((node.name && /^[A-Z]/.test(node.name.text)) ||
        (ts.isCallExpression(node.parent) &&
          /(?:memo|forwardRef)$/.test(node.parent.expression.getText(source))))
    )
      bodies.push({ start: node.body.getStart(source) + 1 });
    if (
      ts.isArrowFunction(node) &&
      ts.isCallExpression(node.parent) &&
      /(?:memo|forwardRef)$/.test(node.parent.expression.getText(source))
    ) {
      bodies.push(
        ts.isBlock(node.body)
          ? { start: node.body.getStart(source) + 1 }
          : { start: node.body.getStart(source), end: node.body.getEnd() }
      );
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      /^[A-Z][a-z]/.test(node.name.text) &&
      node.initializer &&
      ts.isArrowFunction(node.initializer)
    ) {
      const body = node.initializer.body;
      bodies.push(
        ts.isBlock(body)
          ? { start: body.getStart(source) + 1 }
          : { start: body.getStart(source), end: body.getEnd() }
      );
    }
    if (ts.isJsxText(node)) {
      const raw = node.getText(source),
        text = raw.trim(),
        key = keyFor(text);
      if (key) replace(node, raw.replace(text, `{__uiT(${JSON.stringify(key)})}`));
      return;
    }
    if (ts.isStringLiteral(node)) {
      const key = keyFor(node.text);
      if (!key || protectedCall(node)) return;
      const p = node.parent;
      if (
        ts.isImportDeclaration(p) ||
        ts.isExportDeclaration(p) ||
        ts.isLiteralTypeNode(p) ||
        ts.isImportSpecifier(p)
      )
        return;
      if (ts.isPropertyAssignment(p)) {
        if (p.name === node || !uiProperties.has(p.name.getText(source).replace(/['"]/g, '')))
          return;
        replace(p, `get ${p.name.getText(source)}() { return __uiT(${JSON.stringify(key)}); }`);
        return;
      }
      if (ts.isJsxAttribute(p)) {
        const attr = p.name.getText(source);
        if (!internalAttributes.has(attr) && !attr.startsWith('data-'))
          replace(node, `{__uiT(${JSON.stringify(key)})}`);
        return;
      }
      if (ts.isBinaryExpression(p) && /^(===|!==|==|!=)$/.test(p.operatorToken.getText(source)))
        return;
      if (ts.isCaseClause(p) || ts.isElementAccessExpression(p)) return;
      let ancestor: ts.Node | undefined = p,
        inFunction = false,
        inJsx = false;
      while (ancestor && !ts.isSourceFile(ancestor)) {
        if (ts.isFunctionLike(ancestor)) inFunction = true;
        if (ts.isJsxExpression(ancestor)) inJsx = true;
        ancestor = ancestor.parent;
      }
      if (ts.isArrayLiteralExpression(p) && !inJsx) return;
      if (inFunction || inJsx) replace(node, `__uiT(${JSON.stringify(key)})`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!translated) return null;
  for (const body of bodies) {
    edits.push({
      start: body.start,
      end: body.start,
      value: body.end === undefined ? '\n__useUiLanguage();\n' : '(__useUiLanguage(), ',
    });
    if (body.end !== undefined) edits.push({ start: body.end, end: body.end, value: ')' });
  }
  let output = code;
  for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end))
    output = output.slice(0, edit.start) + edit.value + output.slice(edit.end);
  const importPath =
    normalized.slice(0, normalized.indexOf('/frontend/src/')) + '/frontend/src/i18n/index';
  return `import { tGlobal as __uiT${bodies.length ? ', useUiLanguage as __useUiLanguage' : ''} } from ${JSON.stringify(importPath)};\n${output}`;
}
export function chineseUiPlugin(): Plugin {
  return {
    name: 'zhenxia-runtime-ui',
    enforce: 'pre',
    transform(code, id) {
      if (
        (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
          ?.VITEST
      )
        return null;
      const output = translateUiSource(code, id);
      return output === null ? null : { code: output, map: null };
    },
  };
}
