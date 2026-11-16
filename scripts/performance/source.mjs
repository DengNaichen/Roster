import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
export async function sourceManifest() {
  const files = [
    ...new Set(
      execFileSync('git', [
        'ls-files',
        '-z',
        '--cached',
        '--others',
        '--exclude-standard',
        '--',
        'apps/web/src',
        'apps/web/package.json',
        'apps/web/vite.config.ts',
        'apps/server',
        'packages/backend/src',
        'packages/contracts',
        'pnpm-lock.yaml',
        'deno.json',
        'deno.lock',
        'scripts/performance',
      ], { encoding: 'utf8' }).split('\0').filter((path) =>
        path && !path.includes('.test.') && !path.endsWith('_test.ts') && !path.includes('/test/')
      ),
    ),
  ].sort();
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file).update('\0').update(await readFile(file)).update('\0');
  }
  return {
    head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    runtimeSha256: hash.digest('hex'),
    files: files.length,
    scope:
      'web/server/backend/contracts sources, Vite config, dependency locks and all performance scripts; excludes tests and reports',
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await sourceManifest(), null, 2));
}
