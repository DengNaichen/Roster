import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'roster tools ')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.copyFileSync(
    new URL('./toolchain.mjs', import.meta.url),
    path.join(root, 'scripts/toolchain.mjs'),
  );
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      packageManager: 'pnpm@10.20.0',
      devDependencies: { pnpm: '10.20.0', deno: '2.9.6' },
    }),
  );
  function tool(name, version) {
    const dir = path.join(root, 'node_modules', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version, bin: 'bin.cjs' }));
    fs.writeFileSync(
      path.join(dir, 'bin.cjs'),
      'console.log(JSON.stringify({args:process.argv.slice(2),path:process.env.PATH,cwd:process.cwd()}))',
    );
    if (name === 'deno') {
      fs.writeFileSync(
        path.join(dir, process.platform === 'win32' ? 'deno.exe' : 'deno'),
        'fixture',
      );
    }
  }
  const run = (...args) =>
    spawnSync(process.execPath, [path.join(root, 'scripts/toolchain.mjs'), ...args], {
      encoding: 'utf8',
      cwd: os.tmpdir(),
    });
  return { root, tool, run };
}
test('missing local tools fail without using global tools or installing', (t) => {
  const f = fixture(t), result = f.run('check');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing local pnpm/);
  assert.equal(fs.existsSync(path.join(f.root, 'node_modules')), false);
});
test('local version mismatch fails with setup guidance', (t) => {
  const f = fixture(t);
  f.tool('pnpm', '9.0.0');
  f.tool('deno', '2.9.6');
  assert.match(f.run('check').stderr, /version mismatch/);
});
test('local tool receives arguments and worktree PATH independently of caller cwd', (t) => {
  const f = fixture(t);
  f.tool('pnpm', '10.20.0');
  f.tool('deno', '2.9.6');
  const result = f.run('check');
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.args, ['check']);
  assert.equal(fs.realpathSync(output.cwd), fs.realpathSync(f.root));
  assert.equal(output.path.split(path.delimiter)[0], path.join(f.root, 'node_modules', '.bin'));
  assert.deepEqual(JSON.parse(f.run('deno', 'task', 'check').stdout).args, ['task', 'check']);
});
test('missing Deno executable cannot trigger lazy installation during checks', (t) => {
  const f = fixture(t);
  f.tool('pnpm', '10.20.0');
  f.tool('deno', '2.9.6');
  fs.unlinkSync(
    path.join(f.root, 'node_modules/deno', process.platform === 'win32' ? 'deno.exe' : 'deno'),
  );
  const result = f.run('check');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /binary is missing/);
  assert.equal(result.stdout, '');
});
