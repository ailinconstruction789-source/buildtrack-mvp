/** Copy the unchanged route dependency closure; never load application environment files. */
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import ts from 'typescript';

export const voiceEntries = ['app/layout.tsx', 'app/customer-voices/page.tsx', 'app/sales-crm/customer-voices/page.tsx',
  'app/api/customer-voices/route.ts', 'app/api/sales-crm/customer-voices/route.ts'];
const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.json', '/index.ts', '/index.tsx', '/index.js'];
export function collectLocalSources(root, entries = voiceEntries) {
  const base = realpathSync(root), files = new Set(), pending = entries.map(entry => resolve(base, entry));
  const check = path => {
    const rel = relative(base, path);
    if (!rel || isAbsolute(rel) || rel.startsWith('..') || rel.split(/[\\/]/).some(p => p.startsWith('.env') || p === 'node_modules' || p === '__tests__')) throw new Error('Refuse unsafe source path');
    // Also reject links in ancestor directories, not just in the leaf.
    let cursor = path;
    while (cursor !== base) { if (lstatSync(cursor).isSymbolicLink()) throw new Error('Refuse linked source'); cursor = dirname(cursor); }
    return rel;
  };
  const dependency = (specifier, from) => {
    if (!specifier.startsWith('@/') && !specifier.startsWith('.')) return;
    const stem = specifier.startsWith('@/') ? resolve(base, specifier.slice(2)) : resolve(dirname(from), specifier);
    const path = extensions.map(extension => stem + extension).find(candidate => existsSync(candidate) && lstatSync(candidate).isFile());
    if (!path) throw new Error(`Unresolved local test dependency: ${specifier}`);
    check(path); pending.push(path);
  };
  while (pending.length) {
    const path = pending.pop(); check(path); if (files.has(path)) continue; files.add(path);
    const extension = extname(path);
    if (['.ts', '.tsx', '.js', '.jsx', '.mjs'].includes(extension)) {
      const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
      const visit = node => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) dependency(node.moduleSpecifier.text, path);
        if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
          const argument = node.arguments[0];
          if (!argument || !ts.isStringLiteral(argument)) throw new Error('Dynamic module path needs explicit test snapshot support');
          dependency(argument.text, path);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    } else if (extension === '.css') {
      for (const match of readFileSync(path, 'utf8').matchAll(/@import\s+["']([^"']+)["']/g)) dependency(match[1], path);
    }
  }
  return [...files].map(path => relative(base, path)).sort();
}
export function copyVoiceSnapshot(root, destination) {
  const sources = [...collectLocalSources(root), 'package.json', 'postcss.config.mjs', 'tsconfig.json'];
  for (const source of sources) {
    const target = join(destination, source); mkdirSync(dirname(target), { recursive: true });
    cpSync(join(root, source), target, { force: false, errorOnExist: true });
  }
  cpSync(join(root, 'next.config.ts'), join(destination, 'next.original.ts'), { force: false, errorOnExist: true });
  cpSync(join(root, 'scripts/sales-ui-test/next.config.fixture.txt'), join(destination, 'next.config.ts'), { force: false, errorOnExist: true });
  return sources;
}
