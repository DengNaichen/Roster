import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const active = (s) => ['active', 'checking', 'pending'].includes(s.status);
const bounded = (text) => String(text).slice(-6000);
const warning = (text) => ({ systemMessage: `Roster quality: ${bounded(text)}` });
const validId = (id) => typeof id === 'string' && id.length > 0 && id.length < 1024;
function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 16 * 1024 * 1024,
  });
}
export function repository(cwd) {
  return fs.realpathSync(git(cwd, 'rev-parse', '--show-toplevel').trim());
}
function store(root) {
  const dir = path.join(git(root, 'rev-parse', '--absolute-git-dir').trim(), 'roster-quality');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
function locked(dir, fn) {
  const lock = path.join(dir, 'lock');
  // Never steal a lock: an interrupted owner requires explicit local recovery.
  fs.mkdirSync(lock, { mode: 0o700 });
  try {
    return fn();
  } finally {
    fs.rmdirSync(lock);
  }
}
function readStates(dir) {
  return fs.readdirSync(dir).filter((f) => /^[a-f0-9]{64}\.json$/.test(f)).map((f) => {
    const state = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (
      state.version !== 1 || !validId(state.session) || !validId(state.turn) ||
      !/^[a-f0-9]{40,64}$/.test(state.baseline) ||
      !['active', 'checking', 'pending', 'done', 'interrupted'].includes(state.status) ||
      ![0, 1].includes(state.retries) || !validId(state.generation)
    ) {
      throw new Error('Invalid hook state; run pnpm check manually and inspect local hook state.');
    }
    if (f !== `${stateKey(state.root, state.session, state.turn)}.json`) {
      throw new Error('Hook state identity mismatch');
    }
    return state;
  });
}
export const stateKey = (root, session, turn) => hash(JSON.stringify([root, session, turn]));
function save(dir, state) {
  const target = path.join(dir, `${stateKey(state.root, state.session, state.turn)}.json`);
  const temporary = `${target}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(temporary, target);
}
function relevant(file) {
  return /^(apps\/|packages\/|scripts\/|supabase\/functions\/|\.codex\/)/.test(file) ||
    /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|deno\.(json|lock)|biome\.json)$/.test(
      file,
    );
}
export function changedFiles(root, baseline) {
  // --no-renames includes both sides of moves and deleted files.
  return [
    ...new Set([
      ...git(root, 'diff', '--name-only', '--no-renames', '-z', baseline, '--').split('\0'),
      ...git(root, 'ls-files', '--others', '--exclude-standard', '-z').split('\0'),
    ].filter(Boolean)),
  ];
}
function fingerprint(root) {
  const digest = createHash('sha256').update(git(root, 'rev-parse', 'HEAD'));
  const files = [
    ...new Set(git(root, 'ls-files', '-c', '-o', '--exclude-standard', '-z').split('\0')),
  ]
    .filter(Boolean).filter(relevant).sort();
  for (const file of files) {
    digest.update(file).update('\0');
    const absolute = path.join(root, file);
    try {
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) digest.update(fs.readlinkSync(absolute));
      else if (stat.isFile()) digest.update(fs.readFileSync(absolute));
      digest.update(String(stat.mode));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      digest.update('deleted');
    }
  }
  return digest.digest('hex');
}
export function runCheck(root, timeout = 100_000, command = ['corepack', 'pnpm', 'check']) {
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: root,
      env: { ...process.env, COREPACK_ENABLE_NETWORK: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    let output = '', timedOut = false;
    const append = (data) => {
      output = bounded(output + data.toString());
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch { /* Process may have exited while the timer fired. */ }
    }, timeout);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, output: `Unable to start checks: ${error.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !timedOut,
        output: timedOut ? `Checks timed out.\n${output}` : output,
      });
    });
  });
}

async function handleEvent(event, check) {
  const root = repository(event.cwd || process.cwd());
  const name = event.hook_event_name;
  if (!['UserPromptSubmit', 'Stop', 'Interrupt', 'SessionEnd'].includes(name)) return {};
  const identified = validId(event.session_id) && validId(event.turn_id);
  if (!identified && name !== 'SessionEnd') {
    if (name !== 'Stop') return warning('Missing session/turn id; no baseline recorded.');
    const result = await check(root);
    return warning(
      `Missing session/turn id: full read-only checks ${result.ok ? 'passed' : 'failed'}. ` +
        `No baseline or automatic continuation is available.\n${result.output}`,
    );
  }
  if (name === 'SessionEnd' && !validId(event.session_id)) return {};
  const dir = store(root);
  const key = stateKey(root, event.session_id, event.turn_id);
  let state, collision = false;
  const early = locked(dir, () => {
    const states = readStates(dir);
    state = states.find((s) => stateKey(s.root, s.session, s.turn) === key);
    const peers = states.filter((s) =>
      s.root === root && s.session !== event.session_id && active(s)
    );
    collision = peers.length > 0;
    if (name === 'SessionEnd' || name === 'Interrupt') {
      for (
        const s of states.filter((s) =>
          s.root === root && s.session === event.session_id &&
          (name === 'SessionEnd' || s.turn === event.turn_id)
        )
      ) {
        // Only this session's records can be cleaned. Other owners are never expired here.
        s.status = 'interrupted';
        s.generation = randomUUID();
        save(dir, s);
      }
      return {};
    }
    if (name === 'UserPromptSubmit') {
      // A continuation is linked only by the exact reason generated for this session.
      const parent = states.find((s) =>
        s.root === root && s.session === event.session_id &&
        s.status === 'pending' && typeof s.reason === 'string' && s.reason === event.prompt
      );
      if (state && !parent) return warning('Duplicate turn id; existing baseline retained.');
      const baseline = parent ? parent.baseline : git(root, 'rev-parse', 'HEAD').trim();
      for (
        const previous of states.filter((s) =>
          s.root === root && s.session === event.session_id && active(s)
        )
      ) {
        previous.status = 'interrupted';
        previous.generation = randomUUID();
        save(dir, previous);
      }
      if (parent) {
        parent.status = 'done';
        save(dir, parent);
      }
      state = {
        version: 1,
        root,
        session: event.session_id,
        turn: event.turn_id,
        baseline,
        retries: parent ? 1 : 0,
        origin: parent ? parent.origin : key,
        generation: randomUUID(),
        status: 'active',
        collision,
      };
      save(dir, state);
      // Remember overlap on both records even if one session finishes first.
      for (const peer of peers) {
        peer.collision = true;
        save(dir, peer);
      }
      return collision
        ? warning(
          'Another active session shares this worktree. Use a separate worktree; automatic repair is disabled.',
        )
        : {};
    }
    if (!state) return null;
    if (['done', 'interrupted', 'checking'].includes(state.status)) {
      return warning('Duplicate, interrupted, or concurrent Stop; no automatic continuation.');
    }
    state.status = 'checking';
    state.collision ||= collision;
    save(dir, state);
    return null;
  });
  if (early !== null) return early;
  if (!state) {
    const result = await check(root);
    return warning(
      `No verified baseline for this turn: full read-only checks ${
        result.ok ? 'passed' : 'failed'
      }. No automatic continuation.\n${result.output}`,
    );
  }
  const unlinkedContinuation = event.stop_hook_active === true && state.retries === 0;
  let result;
  let changedDuringCheck = false;
  try {
    const files = changedFiles(root, state.baseline);
    if (!unlinkedContinuation && !files.some(relevant)) result = { ok: true, output: '' };
    else {
      const before = fingerprint(root);
      result = await check(root);
      changedDuringCheck = before !== fingerprint(root);
    }
  } catch (error) {
    result = { ok: false, output: error.message };
  }
  return locked(dir, () => {
    const states = readStates(dir);
    const current = states.find((s) => stateKey(s.root, s.session, s.turn) === key);
    if (!current || current.generation !== state.generation || current.status !== 'checking') {
      return warning('Check became stale or was interrupted; result discarded.');
    }
    collision ||= current.collision || states.some((s) =>
      s.root === root &&
      s.session !== event.session_id && active(s)
    );
    current.status = 'done';
    if (collision || changedDuringCheck) {
      save(dir, current);
      return warning(
        'Shared worktree activity or file changes during checks detected. Automatic repair disabled; rerun pnpm check in an isolated worktree.',
      );
    }
    if (unlinkedContinuation) {
      save(dir, current);
      return warning(
        `Unverified continuation baseline: full read-only checks ${
          result.ok ? 'passed' : 'failed'
        }; no further automatic repair.\n${result.output}`,
      );
    }
    if (result.ok) {
      save(dir, current);
      return {};
    }
    const message =
      `Checks failed. Run corepack pnpm format:write if needed, fix the diagnostics, then corepack pnpm check. Do not modify unrelated changes.\n${
        bounded(result.output)
      }`;
    if (event.stop_hook_active || current.retries >= 1) {
      save(dir, current);
      return warning(`Still unresolved after the allowed repair pass.\n${message}`);
    }
    current.retries = 1;
    current.status = 'pending';
    current.reason = `Roster quality check ${randomUUID()} (same session only).\n${message}`;
    save(dir, current);
    return { decision: 'block', reason: current.reason };
  });
}

export async function handle(event, check = runCheck) {
  try {
    return await handleEvent(event, check);
  } catch (error) {
    if (event.hook_event_name !== 'Stop') {
      return warning(`Baseline/state unavailable: ${error.message}`);
    }
    const root = repository(event.cwd || process.cwd());
    const result = await check(root);
    return warning(
      `State/check error: ${error.message}. Full read-only checks ${
        result.ok ? 'passed' : 'failed'
      }; no automatic continuation.\n${result.output}`,
    );
  }
}
