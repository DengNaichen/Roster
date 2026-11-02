/** Dependency boundaries are executable so future features cannot silently undo the split. */
const root = new URL('./', import.meta.url);
async function* sources(dir: URL): AsyncGenerator<URL> {
  for await (const entry of Deno.readDir(dir)) {
    const path = new URL(entry.name + (entry.isDirectory ? '/' : ''), dir);
    if (entry.isDirectory) yield* sources(path);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('_test.ts')) yield path;
  }
}
Deno.test('Backend modules, pure issue use cases and public contracts respect dependency boundaries', async () => {
  const violations: string[] = [];
  for await (const file of sources(root)) {
    const path = file.pathname.slice(root.pathname.length);
    const source = await Deno.readTextFile(file);
    const owner = /^modules\/([^/]+)\//.exec(path)?.[1];
    const pure = /^modules\/issues\/(application|domain)\//.test(path);
    for (const match of source.matchAll(/(?:from\s*|import\s*|import\s*\(\s*)['"]([^'"]+)['"]/g)) {
      const specifier = match[1];
      if (pure && /drizzle|npm:pg|infrastructure|platform\/database/.test(specifier)) {
        violations.push(`${path}: pure use case imports ${specifier}`);
      }
      if (!specifier.startsWith('.')) continue;
      const target = new URL(specifier, file).pathname.slice(root.pathname.length);
      const module = /^modules\/([^/]+)\/(.+)/.exec(target);
      if (module && module[1] !== owner && module[2] !== 'index.ts') {
        violations.push(`${path}: imports another module's internals: ${specifier}`);
      }
      if (path.startsWith('transport/') && target.startsWith('platform/database/')) {
        violations.push(`${path}: transport must call application services, not the database`);
      }
    }
    if (pure && /sql`/.test(source)) violations.push(`${path}: SQL in a pure use case`);
  }
  for await (const file of sources(new URL('../../contracts/', root))) {
    const source = await Deno.readTextFile(file);
    if (/backend\/|export interface \w*Service\b/.test(source)) {
      violations.push(
        `${file.pathname}: public DTO contracts contain backend implementation interfaces`,
      );
    }
  }
  if (violations.length) throw new Error(violations.join('\n'));
});
