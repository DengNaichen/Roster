#!/usr/bin/env node
// Node/npm are the only machine prerequisites. All project tools live in node_modules.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const env = {
  ...process.env,
  PATH: [path.join(root, 'node_modules', '.bin'), path.dirname(process.execPath), process.env.PATH]
    .filter(Boolean).join(path.delimiter),
  ROSTER_NODE: process.execPath,
  // Deno uses deno.json imports; pnpm owns package.json and its CLI binaries.
  DENO_NO_PACKAGE_JSON: '1',
};
function run(command, args) {
  const child = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (child.error) throw child.error;
  if (child.status !== 0) process.exit(child.status ?? 1);
}
function local(tool, ready = true) {
  const file = path.join(root, 'node_modules', tool, 'package.json');
  let installed;
  try {
    installed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error(`Missing local ${tool}. Run node scripts/toolchain.mjs setup first.`);
  }
  if (installed.version !== manifest.devDependencies[tool]) {
    throw new Error(`Local ${tool} version mismatch. Run node scripts/toolchain.mjs setup.`);
  }
  if (
    tool === 'deno' && ready &&
    !fs.existsSync(
      path.join(root, 'node_modules', 'deno', process.platform === 'win32' ? 'deno.exe' : 'deno'),
    )
  ) {
    throw new Error('Local Deno binary is missing. Run node scripts/toolchain.mjs setup.');
  }
  const bin = typeof installed.bin === 'string' ? installed.bin : installed.bin[tool];
  return path.join(root, 'node_modules', tool, bin);
}
try {
  const [command = 'check', ...args] = process.argv.slice(2);
  if (command === 'setup') {
    const version = manifest.devDependencies.pnpm;
    if (manifest.packageManager !== `pnpm@${version}`) {
      throw new Error('pnpm version declarations disagree');
    }
    // Bootstrap with bundled npm; nothing is installed globally. Subsequent calls use local pnpm.
    let pnpm;
    try {
      pnpm = local('pnpm');
    } catch { /* A fresh checkout has no local tools yet. */ }
    if (pnpm) run(process.execPath, [pnpm, 'install', '--frozen-lockfile']);
    else {run(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
        'exec',
        '--yes',
        `--package=pnpm@${version}`,
        '--',
        'pnpm',
        'install',
        '--frozen-lockfile',
      ]);}
    local('pnpm');
    run(process.execPath, [local('deno', false), '--version']);
    local('deno');
  } else {
    // Fail rather than accidentally falling back to a globally installed runtime.
    local('pnpm');
    local('deno');
    run(
      process.execPath,
      command === 'deno' ? [local('deno'), ...args] : [local('pnpm'), command, ...args],
    );
  }
} catch (error) {
  process.stderr.write(`toolchain: ${error.message}\n`);
  process.exitCode = 1;
}
