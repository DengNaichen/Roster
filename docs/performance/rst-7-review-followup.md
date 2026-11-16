# RST-7 follow-up review

- Scope: the current uncommitted diff against `origin/query-roundtrips-on-writes` (`ca99a31`), plus the new artifacts `rst-7-access*.json`, `rst-7-lifecycle.json`, `rst-7-conditional.json`, `rst-7-source.json` and the `decisions.tsv` rows.
- Read-only: no edits to source, git, tickets or the browser.
- Previous review: `/tmp/roster-rst7-review.md`.
- What I ran: the touched web test files, `remoteRefresh`, `queryValidators`, `queryCache` and `integration/api`. All 4 files and 33 tests passed. I did not rerun the full check or the DB suite.

## Status of the previous findings

| ID | Status | Notes |
|---|---|---|
| M1 team shrink blanks active pages | **Mostly fixed. New hole, see B1** | Mounted issue bodies and collections are kept and denied rows removed. Covered by a mounted-observer unit test. Not exercised in the browser: the access fixture has only one team, so the open issue *is* the lost one. |
| M2 permanent error slows everything | Fixed | Only network errors, 408, 429 and 5xx back off. `rst-7-access.json` shows recovery after a restore taking 14.8 s and 14.9 s, against 29.9 s and 29.7 s in `rst-7-access-before-review.json`. That gain comes from M2 and holds up. |
| M3 polling scope | Fixed | Explicit allow-list. The picker and `/revisions/:n` are excluded and tested. Triage and the spec graph are kept on purpose, which is fine. |
| M4 cost model | Documented in `decisions.tsv` ("304 saves bodies but still runs authorization and SQL") | The final report still needs requests, SQL and bytes per minute per tab, plus "hosted not measured". |
| M5 phase lock | Disclosed ("5 phase-aligned updates", "local preview only") | OK. |
| L1 timeout text | Fixed | `api.ts:154` now reads "Request timed out. Try again." |
| L2 work logs | Accepted | Logs are append-only. OK as a documented limitation. |
| L3 executing queryKey | **Not implemented. See B2** | |
| L4 graph cleanup | Fixed | Nodes and orphaned edges are removed. |

## Remaining blockers

### B1 (Medium, security/correctness): a mounted private-team **spec** survives a team loss
- `apps/web/src/queryCache.tsx:167-175`, the `readable` predicate. Spec identifiers are `SPEC-<n>` (`packages/backend/src/modules/specs/application/service.ts:65,91`). So `missing("SPEC-9")` compares the prefix `"SPEC"` with the lost team keys, and that is always false.
- The predicate is an OR. The `identifier` branch therefore passes before the `team` branch can reject the body, even when `data.team === "PR"` is a lost team.
- Scenario: the user has `SPEC-9` (team `PR`, private) open and is removed from `PR`. The spec body, with its full `content`, is **kept** and stays on screen until the active refetch returns 403 or 404.
  - If that refetch fails transiently (offline, 5xx, timeout), TanStack keeps `data` on error, so the private body stays visible indefinitely.
  - This is the exact case the comment says is handled ("Discard … conservatively").
- The same OR also lets through any future body that carries both an `identifier` not prefixed by a team and a `team`.
- Fix:
  - Reject when *any* team signal is lost: `typeof data.team === "string" ? !lost.has(data.team) : <identifier rule>`. Apply the identifier rule only to issue-shaped bodies (`/issues/:id` keys), not to everything that has an `identifier`.
  - Add a unit test: a mounted `/specs/SPEC-9` with `{identifier:"SPEC-9", team:"PR"}` must be cleared when `PR` is lost.
- Related, Low: mounted bodies with an `issues` array (a cycle page or `/specs/:id/issues` of the lost team) keep their non-row metadata, such as cycle name and spec title, until the refetch completes. The same transient-failure caveat applies. Consider requiring `data.team`/`cycle.team` not lost for collections too, or accept this and document it.

### B2 (Medium, show-me-your-work accuracy; Low at runtime): the L3 fix is claimed but the parameter is dead
- `apps/web/src/queryCache.tsx` `fetchResource(scope, path, signal, queryKey?)`. `queryKey` is never read. The function still does `find({queryKey: resourceKey(subject, path), exact: true})` for every caller, WorkLogs included.
- `resourceOptions` forwards the key, but nothing uses it. So "executing queryKey explicitly forwarded … no WorkLogs validators" is not what the code does.
  - Today it is harmless, because no exact-key query exists for `…/work-logs?before=N`.
  - The follow-up note and any report or decision row that cites this fix are inaccurate.
- Fix: `const query = queryKey ? cache.find({queryKey, exact:true}) : undefined;`. That skips validators entirely when no key is passed. Add a test that a `fetchResource` call without a key never sends `If-None-Match` or records a validator, even when a same-path query exists.

### B3 (Medium, evidence): the lifecycle and backoff artifacts predate the final code
- `rst-7-lifecycle.json` was measured at 11:06:48Z. The M1 and M2 changes are recorded at 11:15:18Z (`decisions.tsv`), and further frontend-only changes came after. Neither `rst-7-lifecycle.json` nor `rst-7-access*.json` carries a source or runtime hash. `rst-7-source.json` (`head ca99a31` plus `runtimeSha256`) does not name the artifact it describes, and HEAD is the same for every run because the work is uncommitted, so it cannot tell runs apart.
- Required:
  - Record a `runtimeSha256` inside each artifact.
  - Rerun lifecycle on the final runtime. Its backoff path (status-less network errors) should be unchanged, but that should be shown, not argued.
  - The final report must not present `rst-7-lifecycle.json` as evidence for the final code until then.

### B4 (Low/Medium, evidence wording): what the lifecycle backoff recovery actually shows
- `network-failure-recovered`: after unblocking, recovery came 219 ms later. In the same instant, the focus-only queries 4–7 (labels, other, teams) were refetched. That is the focus or visibility catch-up path, not the backoff timer expiring.
- The artifact does show 30 s spacing between failures: first attempt at 14.9 s, retry at 15.9 s, next cycle at 45.9 s.
- Report it as: "backoff 15→30 s observed; recovery triggered by a focus/visibility event; recovery via the 60 s timer was not measured". Do not write "recovered within 219 ms" without that qualifier.

### B5 (Low, evidence wording): access artifacts
- `requests` in `rst-7-access*.json` accumulates across observations, because the capture window is not reset per scenario. "team-visibility-restored" repeats the whole request list of "private-team-hidden". Do not quote per-scenario request counts from these files. Either reset the probe per observation or say the lists are cumulative.
- `deleted-fixture-disappeared` takes 4,203 ms in the final run and 14,621 ms before. The difference comes from timer phase, not from code: both are bounded by the 15 s poll. Do not present it as an improvement.
- Statuses of `0` (for example `2:issues:0`, `5:teams:0`) are reads the probe recorded as aborted, cancelled by the purge or the write barrier. Say so, or readers will take them for failures.
- Deletion fixture (`scripts/performance/access.ts:76-93`):
  - It bypasses application authorization with direct SQL. This is acceptable for a disposable `perf-deletion-*` local workspace, and the comment says so.
  - The trailing error text still says "Use setup, suspend, restore, private or public". Add `delete-fixture`.
  - Because there is no public delete API, a "deleted issue" in production can only come from moves or visibility changes. The 404 scenario stands in for those; state that in the report.

## Docs and decisions (delta since the first review)
- The new `decisions.tsv` RST-7 rows are accurate and appropriately hedged: phase-aligned, local only, "304 … still runs authorization and SQL", "browser rerun pending".
- The row "Narrow periodic reads from seven to three" cites `rst-7-after.json`. That run predates M3's final allow-list, so check that the final allow-list still yields 3 requests per tick on the task detail.
- The row "32135 ms actually hidden with zero requests". The artifact shows `hiddenAt…visibleAt` = 32,135 ms and an empty `requests` list. It is consistent.
- The focus catch-up issues two bursts: focus-only queries at about 32.135 s, then the coordinator 100 ms later. These are different queries, not a double fetch. A one-line note in the report would pre-empt the question.
- The D1–D13 items from the first review (RST-2 single batch, P95 = max, RST-6 browser regression, RST-4 offline, unpinned commits and so on) are untouched. They do not block RST-7, but the series summary must not repeat those claims unqualified.

## Required before RST-7 can be marked done
1. Fix B1 and add the spec test.
2. Implement B2 for real, or withdraw the L3 claim.
3. Rerun lifecycle and access on the final runtime with per-artifact runtime hashes (B3). Wait for the access rerun that is underway; do not mark it passed until it lands.
4. Fix the wording in the final report: B4, B5, and the M4 cost per tab (requests, SQL and bytes per minute; hosted not measured).
5. Rerun the full check and DB tests after the latest frontend changes. The 152 web, 35 DB and 6-step results predate them.
