# RST-7 owner-boundary delta: code verdict

- Read-only. I ran no tests and no browser while the frozen measurement was in progress. The only commands were file reads, `git diff`/`status` and one run of `node scripts/performance/source.mjs`, which only hashes files.
- Scope of this review:
  - The `ServerCacheProvider.finished` ownership change.
  - The new regression test.
  - The widened `sourceManifest`.
  - The archive in `rst-7-pre-ownership/`.

## Verdict: the code change is correct and resolves the reported race. No code blockers remain.

### The fix: `apps/web/src/queryCache.tsx`, `ServerCacheProvider` and `finished`
- **Before:**
  - Every mounted provider listened to the global `roster-write-finished` window event.
  - Each one called `scope.reject(path, error)` for **any** finished write that carried an error, whoever had started it.
  - `scope.reject` builds the key with *its own* subject (`resourceKey(subject, path)`).
  - So suppose a write from the old account was still pending when the user switched account. If it then ended with "Workspace access denied", it purged the **new** account's workspace cache. That is a cross-account side effect.
  - `rst-7-owner-regression-before.txt` shows the new test failing against the earlier code with `expected undefined to deeply equal { title: 'new account content' }`. So the reproduction is real.
- **After:** `finished` looks up `releases.get(id)` and returns early unless this provider's own `started` handler registered that id. Only owned writes can reject or release.
  - The ids are unique `Symbol()`s created per write in `shared.tsx:291`, so they cannot collide across accounts.
  - Ownership is decided per mounted effect instance, which is the boundary that matters. `AuthBoundary` keys the subtree by subject, so an account switch always unmounts the old provider. The old provider's cleanup releases its pending barriers, and the new provider never sees those ids.
- There is only one production mount (`queryCache.tsx:436`), so there is no case of two providers sharing ownership.

### The test: `queryCache.test.tsx:441`
- The test mounts the new account's provider, dispatches an orphan `writeFinished` with a 403 "Workspace access denied" and an unknown id, and asserts that the new account's data is kept. This matches the production race: the old provider is unmounted and the id is unknown to the new provider.
- **Gap (Low): there is no positive counterpart.** No test shows that an *owned* write (`writeStarted` and then `writeFinished` with the same id) that ends in 403 "Workspace access denied" still purges this account's workspace.
  - The code path is trivially still reachable.
  - Still, a short test pairing the two events would lock in that the early return did not disable `reject`.
  - Add it after the measurement freeze; it does not change runtime code.

### Residual behaviour to document (Low, no change required)
- This early return now ignores even a writer's own late 403 "Workspace access denied" in one case: the write was in flight when this **same-subject** provider's effect re-ran. That happens with the StrictMode replay in dev, or if `scope` ever changed identity.
  - Before, the late 403 purged immediately.
  - Now the next GET performs the purge: polling at 15 s, or an active refetch. This matches the existing comment on `reject` ("otherwise the ensuing GET decides").
  - In production, `scope` is stable per client and subject (`scopeFor` memoises it), so this is effectively dev-only. The leak window is one poll interval of data the user could read a moment earlier.

### `scripts/performance/source.mjs` (resolves R1 from the final audit)
- The manifest now covers `apps/web/src`, `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/server`, `packages/backend/src`, `packages/contracts`, `pnpm-lock.yaml`, `deno.json`, `deno.lock` and all of `scripts/performance`. It excludes `.test.`, `_test.ts` and `/test/` files. That comes to 236 files, and the `scope` text matches.
- It hashes working-tree file contents over tracked and untracked non-ignored files, so files that are staged but then edited are captured correctly.
- The current tree hashes to `d34d1fbd…5594`. `rst-7-final-after.json` (11:48:03Z) already carries `d34d1fbd…`, 236 files.
- **Remaining limits** (state these; no change needed):
  - The hash proves which files were on disk when each script started. It does not prove that the *running* API and Vite processes loaded them.
  - "Backend restarted" is a process fact the artifacts do not record. If you want it machine-checked, record the API process start time, or have the API serve the manifest hash, and assert that it is newer than every hashed file's mtime.
  - An ignored file that affects the runtime, such as `.env.worktree` or `VITE_REMOTE_REFRESH_MS`, is outside the hash. The interval is at least visible in the measured cadence.

### Status of the rerun when I read it (not a verdict on the evidence)
- **Already on the new hash:** `rst-7-final-after.json` has `d34d1fbd`.
- **Still the old hash, `d4a69f63` (101 files), in `docs/performance/`:**
  - `lifecycle`, `access` and `conditional` (11:26–11:29Z).
  - `content` (11:40Z, an intermediate rerun).
  - These still have to be overwritten by the running rerun.
- `remote-report.mjs` refuses mixed hashes, so a partial rerun cannot be summarised by mistake. Good.
- `rst-7-pre-ownership/` holds all seven pre-fix files (`access`, `conditional`, `content`, `final-after`, `lifecycle`, `source`, `summary`), all on `d4a69f63`. Keep them labelled as superseded. Do not cite them as final acceptance.
- `rst-7.md` and `delivery.md` still quote the pre-ownership numbers and the 154-test count. They must be regenerated from the new summary, with 155 tests and the new hash, before the PR.

## Before opening the PR
1. Let the frozen rerun finish. Then rerun `remote-report.mjs` and confirm a single hash, `d34d1fbd…`, across all five artifacts. Update `rst-7.md`, `delivery.md` and `decisions.tsv` from the new summary, adding the ownership-race row.
2. After the freeze, optionally add the positive owned-write 403 test.
3. Earlier wording items R3 and R4 from `/tmp/roster-rst7-review-final.md` still apply:
   - R3: the `delivery.md` rows need their caveats (worst phase and n=5, "task detail" scoping, the RST-2 single batch and its pre-RST-3 payload).
   - R4: note in the PR body that the 15 s default was chosen without hosted load or cost data.
   - R2 is moot once the content artifact is regenerated on the new hash.
