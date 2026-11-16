# RST-7 review: remote refresh on round-trips

- Worktree: `/Users/nd/Developer/roster-worktrees/remote-refresh-on-roundtrips`
- Base: `origin/query-roundtrips-on-writes` (`ca99a31`, equal to HEAD). The review covers only the uncommitted diff: 10 modified files and 8 untracked files.
- Mode: read-only. I did not edit any code, git state or tickets.
- Offline engine: out of scope.
- Reviewer family: Claude (Opus 5.5), giving the cross-family read for show-me-your-work.

## Verification I ran

- `npx vitest run src/remoteRefresh.test.ts src/queryValidators.test.ts src/queryCache.test.tsx src/integration/api.test.ts` in `apps/web` passed: 4 files, 30 tests.
- `deno test --filter "conditional reads" packages/backend/src/transport/transport_test.ts` passed: 1 test.
- I did **not** run the full `node scripts/toolchain.mjs check`, any browser scenario or any hosted measurement. The final `rst-7-after.json` was still being written when I read it. Treat its numbers below as provisional.

## Findings (most severe first)

### M1 — A team-access shrink blanks every active page in the workspace, but the test claims it only drops inactive bodies
- `apps/web/src/queryCache.tsx:153-163`. `affected` matches every query in the same subject and workspace except the `/teams` query itself, and that includes **active** queries. Each one goes through `clearRejected`: data is set to `undefined`, status to `error`, and the error to "Team access changed". Only after that does `refetchQueries({type:"active"})` run.
- Failure scenario: the user is on `AL-3`, in a team they still belong to. An admin removes them from private team `PR`. On the next 15 s poll, `useResource` sees `!hasData && error`, so the open `AL-3` detail, the sidebar triage counts, the cycle pages and so on all render the error "Team access changed" or their empty `initial` value for one full refetch round-trip. Any optimistic property shown while a write is in flight is also discarded (`mergeIssueCaches` returns `undefined` when `current` is missing), and the write's confirmation cannot restore it.
- The test name `queryCache.test.tsx:227` ("discards inactive bodies…") hides this. The test never mounts an observer, so it cannot catch it.
- Fix options:
  - (a) Clear only inactive queries, and refetch active ones in place. A refetch that returns 403 or 404 already purges itself through `purgeRejected`.
  - (b) Clear only queries whose path or body references the lost team keys.
  - Either way, add a test with a mounted observer that asserts an unaffected active resource keeps its data.

### M2 — One permanently failing resource puts every remote refresh into 60 s backoff, and the coordinator keeps re-polling the 404 or 403
- `apps/web/src/remoteRefresh.ts:37-41`. `failed` means *any* active remote query has `status === "error"`. After a 404 or 403, `clearRejected` leaves the query in `status:"error"`, and it stays active as long as the page that shows the error is mounted.
- Failure scenario: a user opens a deleted issue, or keeps a tab on an issue whose team they lost. Every refresh now refetches that 404 (a full server authorization plus query each time), and the delay grows to 30 s and then 60 s. **All other** visible resources, such as the teams list and the sidebar triage count, then refresh at most once a minute. The target "≤ interval visibility" fails silently.
- Fix:
  - Back off only on transient failures: network errors, timeouts and 5xx. Treat 401, 403 and 404 as a terminal state.
  - Exclude queries in a terminal error from the coordinator predicate, or stop polling them until navigation.
  - Add a test: a mounted query that returns 404 must not change the cadence of a healthy query.

### M3 — The polling set is wider than its documented scope: the picker catalogue `/issues?limit=-1` and immutable spec revisions get polled
- `apps/web/src/remoteRefresh.ts:3-11`. The comment says "Picker catalogs keep normal focus/reconnect freshness". However, `/\/(?:issues|specs)(?:\/|\?|$)/` also matches:
  - `SpecIssues.tsx:71-72`: the link-issue picker `apiPath("/issues?limit=-1")`, which is the full, unpaged issue list of the workspace.
  - `Sidebar.tsx:154-155`: the triage count `…&status=triage&limit=-1`. This one is probably intended, but it is unbounded.
  - `SpecHistory.tsx:18-23`: `/specs/:id/revisions/:n`. These are immutable revisions.
  - `SpecIssues.tsx:62`: `/specs/:id/dependencies`.
- Every one of these runs the full handler and the full SQL every 15 s, even when the reply is a 304. The ETag is computed *after* the handler; see M4.
- Fix: use an explicit allow-list of content resources instead of a broad regex. Add a test case that asserts `/issues?limit=-1` (picker) and the revision paths are **not** polled, or rewrite the comment to say they are.

### M4 — The cost model is not stated: a 304 saves bytes only, the server still does the whole read, and the hosted cost is unmeasured
- `packages/backend/src/transport/http/conditional.ts:4-22` runs `await next()`. That means authorization plus the full query and serialisation. Then it clones the body and SHA-256-hashes it for **every** 200 GET under `/api/w/*`, including requests without `If-None-Match`.
- The comment says so, and the transport test asserts `calls === 2`. But the RST-7 artifacts show what this costs per tab:
  - `rst-7-after.json`: 3 requests every 15 s, with SQL counts 2, 2 and 9.
  - `rst-7-initial-after.json`: 7 requests every 15 s, before the polling set was narrowed.
  - The one 200 in each cycle is the issue detail, at **168–321 KB, growing per update** because the activity history grows.
- On the hosted deployment (Supabase Edge Functions), every poll is a function invocation. The steady-state load is roughly `tabs × polled resources × 4/min`, and nothing has measured it.
- Required in the final report:
  - Requests per minute per visible tab.
  - SQL per minute.
  - Bytes per minute when nothing changed and when one issue changes.
  - An explicit statement that no hosted invocation or cost measurement was done. Do not say "304 reduces server load".
  - Optionally, consider jitter: there is no jitter today, so tabs opened together stay phase-aligned.

### M5 — The latency samples are phase-locked to the poll timer, so "≈15 s" is the worst case, not a typical value
- `scripts/performance/remote-refresh.mjs:38-46`. Each sample fires the MCP update right after the DOM showed the previous change. The previous change became visible right after a poll tick, so every update lands at the start of a fresh 15 s window.
- `initial-after` and `after` both show `visibilityMs` 14574–15009 for 5 of 5 samples, which is effectively the interval itself.
- The method field says "no navigation/focus between samples", but it does not mention the phase lock.
- Report the result as "upper bound ≈ interval (15 s) when the tab is visible and focused. The expected mean for a random arrival is ≈ interval/2 + RTT. n=5, local preview only." Or add a random 0–15 s delay before each update so the samples spread across the interval.
- `rst-7-before.json` has **n=1** and a timeout at 30 s (`visibilityMs: null`). Report it as "not visible within 30 s without focus or navigation", not as a latency number, and do not compute a speedup ratio from it.
- The backoff path, the hidden-tab path and the offline path were not measured. Do not imply that ≤15 s holds under failure: backoff reaches 60 s, and a hidden tab never refreshes until it becomes visible again.

### L1 — The 30 s GET timeout shows "Showing cached content." even when nothing is cached
- `apps/web/src/integration/api.ts:173-184`. All GETs now go through the 30 s abort, which covers initial loads and not only polls. On a cold load with no cache, `useResource` shows "Refresh timed out. Showing cached content." (`!hasData && error`), and that is false.
- This is also new behaviour for slow initial reads such as hosted cold starts and `limit=-1` lists: before, they had no client timeout. Now they fail, are retried once, and then error.
- Fix: choose the message based on whether cached data exists. Report the behaviour change.

### L2 — Work logs refresh only when the count changes
- `apps/web/src/WorkLogs.tsx:125-129`. Edits and deletes that keep the same `work_log_count` never refresh the open history. A delete followed by an add within one poll interval nets to the same count and is missed. Also, every mount (each time the tab is switched back) forces `refetch()`, and that refetches **all** loaded pages even when the data is fresh.
- Write this down as a known limitation, or key the refresh on a server `updated_at`/version of the logs. The second point is fine if it is intentional, but the report should say so.

### L3 — The validator is attached by path lookup, not to the query that is executing
- `apps/web/src/queryCache.tsx:446-465`. `fetchResource` finds `resourceKey(subject, path)` and records `pendingValidators` and `conditional` on *that* query. Today the only caller with a different key is `WorkLogs.tsx:120` (`…/work-logs?before=N`). No exact-key query exists for that path, so nothing is mis-paired.
- If a future caller fetches a path under one key while a `useResource` holds the same path under its own key, it could pair one response's tag with another response's data. The 304 would still be sound, because a 304 implies the body equals the tag's body. The worse effect is cross-feeding the wrong `value` into a query of a different shape.
- Hardening: pass the executing `Query` (or its key) from `queryFn` context instead of looking it up. Or add an assertion that `query.queryKey` deep-equals the caller's key.

### L4 — The 404 reference cleanup is shallow and leaves the cleaned queries idle while `VITE_REMOTE_REFRESH_MS=0`
- `apps/web/src/queryCache.tsx:79-99,121-131`. Only the top-level `issues`, `children`, `blocks`, `blocked_by`, `related` and `parent` fields are cleaned. Nested shapes are not, for example cycle or project pages with issue arrays inside groups, or `SpecGraph.nodes/edges`. Those depend on the next poll.
- `cancel()` plus `isInvalidated:true` with no refetch means that when the coordinator is disabled (`0`) and focus refetch is the only trigger, a list whose in-flight read was cancelled stays stale until the next focus.
- This is acceptable, but the report should say "best-effort removal from top-level collections; others converge on the next poll".

### L5 — Positive checks (confirmed, no action)
- Data identity: a validator is used only when `validator.data === query.state.data`. A 304 only certifies a body that is byte-equal to the tagged one, so even a rollback that restores the identity is sound. I found no in-place mutation of cached data: `issueCache.mergeIssueCaches` and all `useResource.update` callers return new objects. Cancelled reads cannot certify later edits, because `onSuccess` checks the aborted signal and a test covers it.
- User and workspace isolation: validators and team baselines are keyed by `Query` object, and the key contains subject and workspace. `ServerCacheBoundary` starts one coordinator per subject and stops it on `needsLogin`. The tests assert that another owner sends no `If-None-Match` and that the purge leaves another workspace untouched.
- ETag and permissions: authentication runs before `conditionalRead`, so a 401 never reaches the service. 403, 404 and other errors carry no ETag and are never 304. Clients see 403 and 404 normally, and `onValidator` is not called on errors. CORS allows `If-None-Match` and exposes `ETag`, and the 304 keeps `Access-Control-Allow-Origin`. `Cache-Control: no-store` plus a client `cache:"no-store"` keep authenticated bodies out of HTTP caches.
- Coordinator: there is one timer per client. It reuses in-flight reads (`cancelRefetch:false`), coalesces focus and online events at 100 ms, and does not run while hidden or offline. Focus and reconnect refetch are disabled only for polled resources while the coordinator is enabled, so there is no double fetch.

## Required before claiming RST-7 is done
1. Fix M1 and M2, or explicitly accept them in the ticket with a mounted-observer test that documents the behaviour.
2. Resolve the M3 scope mismatch, either in code or in the comment and report.
3. The final report must state:
   - The phase-lock caveat and n (M5).
   - That `before` is n=1 and a 30 s timeout.
   - That everything was measured on local preview only.
   - The polling cost per tab (M4).
   - That no hosted, backoff, hidden-tab or permission-shrink browser scenario was measured, unless an artifact exists. Do not mark the browser scenarios that are still being added as passed.
4. Run the full `node scripts/toolchain.mjs check` (I did not).

## Show-me-your-work audit: decisions.tsv and the RST-1…6 reports

Method: a subagent recomputed every reported P50/P95, byte count, SQL count and request total from the cited JSON, using nearest-rank percentiles. **No numeric mismatch was found.** The problems below are about labelling, sample size and how far the results are generalised. Paths are under `docs/performance/`.

### High
- **D1. RST-2 sets the production region from a single batch at one location.** `rst-2.md:68-79` and `decisions.tsv` (RST-2 row) choose eu-west-3 based on one interleaved batch of about 3 minutes per transport (`rst-2-regions.json`, measured 06:09; MCP at 06:12), run from one workstation. `README.md:25` itself requires "enough repeated batches for production decisions". The batch shows no variance between runs, and the size of the gain (-80% / -87%) depends on where the client is. Either add repeated batches from more than one time and place, or downgrade the decision to "provisional, single batch".

### Medium
- **D2. Most "P95" values are really the maximum.** With n=19 or n=9, nearest-rank P95 is the slowest sample (RST-1/3/4/5/6 warm tables, RST-2 MCP). Call it "max (n=19)" or add repeated batches and dispersion.
- **D3. The RST-2 numbers are stale.** They measure the 499,805-byte list and the 20-SQL detail path, which RST-3 (17,363 B) and RST-6 (9 SQL) replaced. The region gain grows with the number of DB round trips, so -87% overstates the gain on the current code. Add a note in `rst-2.md`.
- **D4. The RST-6 fast-path story is not backed by the browser data.** `rst-6.md:27` implies the null-reference fast path fixed the initial list regression. But the final `rst-6-after.json` is *worse* than `rst-6-initial-after.json`: flat list P95 4.5 vs 3.2, detail 6.0 vs 4.7. Only the in-process A/B shows a gain, and that A/B has no write scenario, while writes regressed from 2.1/5.0 to 3.0/7.6. Its baseline is a mutable worktree path (`rst-6-read-ab.json .baseline`), not a SHA. State the browser regression plainly.
- **D5. The RST-4 offline claim goes beyond its artifact.** `rst-4.md:35` says content is kept after reconnect, but `rst-4-offline.json` is a single offline observation with no reconnect field. It was taken before the review fixes (08:16:41) and may overlap with the API probe that ran at the same time.
- **D6. The RST-2 browser CORS claim is thin.** `rst-2.md:87` cites `rst-2-browser-cors.json`, which records only status 200, the issue count and the origin. It does not show that `x-region` was sent or that `x-sb-edge-region` was readable.
- **D7. RST-7 is phase-locked.** See M5. Each write lands 20–108 ms after the previous refresh was seen, so every sample is about one full interval (14.6–15.0 s) by design.

### Low
- **D8.** `rst-5.md:14`: the row labelled "PATCH 响应" (PATCH response) is really `confirmedMs`, input to PATCH end. The PATCH itself is about 311 ms in both runs.
- **D9.** `rst-5-network-failure.json` (09:08) and `rst-5-permission.json` (09:11) were captured *before* the rebase to abd8df8 (~09:19). Only `rst-5-browser.json` was captured after it. Say which checks were rerun.
- **D10.** The cited commits 6d5e6aa, b572cff, 8584b4e (the RST-5 sourceManifest head) and 87e5e77 are not ancestors of HEAD, so they can be lost to gc or a fresh clone. Push them or tag them.
- **D11.** Some decision rows cite evidence that is not in the repo: `/tmp/roster-performance-pg.log`, and the test-pass counts (99/105/119/138 web and 34 backend) have no saved logs.
- **D12.** `rst-6.md:25` "about 33 await stages" comes from reading the code and has no artifact.
- **D13.** `environment.md:58` lists only the RST-1 ports and DB. Later tickets used different worktree databases and ports.

### RST-7 artifacts: comparability notes for the final report
- None of the three files records the code revision, browser build or port. Add these.
- `before` is n=1 and censored (>30 s, zero requests). It is not a latency and cannot support a ratio.
- `initial-after` and `after` are comparable on request count and SQL per refresh: 7 requests / 29 SQL vs 3 requests / 13 SQL.
- **Byte counts are not comparable across files or samples.** The detail body grows with every write because each write appends audit history: 168 KB → 245 KB in `initial-after`, 302 KB → 379 KB in `after`, and 417 KB in `rst-7-lifecycle.json`, which was still being written. Report bytes only with a fixed fixture, or reset the issue between runs.
- 304s still run 2–9 SQL each. Conditional requests save transfer, not DB work.
- The partial `rst-7-lifecycle.json` shows polls at about 14.5 s and 29.6 s, nothing while hidden, and a focus catch-up of 7 requests in **two bursts**, including a 417 KB re-download. Check whether the two bursts are the coordinator's catch-up plus the non-remote `refetchOnWindowFocus` queries, or a double fetch.
- No artifact yet backs the README budget items "bounded retry backoff", "at most one refresh in flight" beyond the observed lack of overlap, permission shrink, or 404 cleanup in the browser. Do not report these as passed until artifacts exist.

### Limitations to state in the RST-7 / series summary
- Nothing after RST-2 was measured on the hosted deployment. RST-3 through RST-7 ran on local loopback with a Vite dev build and StrictMode, on one machine.
- Hosted acceptance (first-screen budget, OAuth refresh and revoke) was never done (`rst-1.md:30,42`).
- The 50-issue fixture cannot support index or query-plan conclusions. The rich fixture is a single dataset.
- RST-4's "zero requests" result fits entirely inside the 30 s staleTime, so stale-revalidation was never exercised.
