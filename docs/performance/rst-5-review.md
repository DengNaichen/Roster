# RST-5 final review (read-only)

**Scope:** the current uncommitted diff in `optimistic-writes-on-cache`, together with `docs/performance/rst-5-{priority,status}-{before,after}.json`.

**What I did not do:** no edits, browser, services or test runs. The claim of 131 frontend tests and a full check passing is as you reported it.

## Verdict: no blockers in the code. The measurement claims need the labels listed below.

### Follow-up fixes
- **N1 (workspace isolation): fixed.** `onConfirmed` returns early unless `workspaceScope(path) === workspaceScope(base)`. Every confirmation path comes from `useRequestScope`, and those paths are always `/api/w/<slug>/…`, so the comparison is well-defined. The regression test uses `AL-1` in two workspaces.
- **N2: fixed.** The managed-write catch calls `scope.reject(op.entry.path, error)` before `finish`. A 403 `Workspace access denied` on a property save now purges immediately. Other 403/404 responses still leave the decision to the GET, which is consistent with RST-4's B1 fix.
- **N3: fixed.** Spec progress is marked invalid only when `op.sent && op.patch.status !== undefined`.
- **Narrow detail merges.** Only `status`, `priority` and `updated_at` are touched, so pending criterion and document edits are not overwritten. That also resolves the earlier L5 flicker.
- **Activity and history refresh.** You are deferring this to focus or RST-7. That matches the old `changeStatus` behaviour, so it is not a regression. Record it as a known gap in the RST-5 task.

## Measurement check (20 clicks per file, PERF-50 detail page, 300 ms emulated latency)

| Field | Requests (20 clicks) | Feedback `matchedMs` p50/p95 | `confirmedMs` p50/p95 | Pending at match |
|---|---|---|---|---|
| priority before | 140 (20 PATCH + 60 teams + 20 issues + 20 labels + 20 other) | 326 / 328 | 322 / 324 | 6 |
| priority after | 20 (PATCH only) | 4 / 4 | 314 / 316 | 0 |
| status before | 140 (same mix) | 323 / 327 | 319 / 323 | 6 |
| status after | 20 (PATCH only) | 3 / 4 | 312 / 315 | 0 |

All 80 samples succeeded, and Node readback confirmed the server value for every sample.

### What the numbers support
- **7 requests per click → 1.** Before, every save caused 6 revalidation GETs. After, a save causes the PATCH alone, and nothing else starts in the window up to confirmation. This is a deterministic result and the strongest claim.
- **The visible change appears about 320 ms earlier** at 300 ms latency. Before, the UI waited for the PATCH. After, the optimistic value is in the DOM in 3–4 ms.

### Labels required when reporting
1. **`matchedMs` after is optimistic display time, not save time.** Always report it next to `confirmedMs`. Confirmation stays about one round trip (312–316 ms against 319–324 ms before). The 6–10 ms difference is within noise at n=20 with emulated latency; do not claim it as a gain.
2. **The scope is the detail page only.** The probe does not measure:
   - board or list merges
   - the triage count
   - cycle count deltas
   - spec progress
   - sub-resource writes (comments, criteria), which still deliberately revalidate the affected lists

   The perf fixture has no cycle, spec links or relations. State this explicitly.
3. **The revision is not pinned.** The probe files have no `revision` field (the API baseline has `"8584b4e; before RST-5"`). Record the exact commit or a dirty-tree hash for the after runs, and commit the `writes.mjs`/`ui-probe.mjs` changes used to produce them.
4. **Environment.** Local preview, StrictMode dev build. Mutations are not duplicated, so request counts are unaffected. Chrome network emulation with loopback servers means this is not hosted latency.
5. **The success path only.** Permission loss, network failure and rollback still need the browser verification you have planned with the restricted local fixture. Until then, these are covered by unit tests only.

## Not blocking; leave for RST-7 or record
- History and audit refresh after a property change. You have already accepted this.
- The re-insert position is captured once per entry. This is cosmetic because lists are re-sorted.
- Comment, criterion and work-log saves still revalidate the active issue lists. This is deliberate. State it so that no one reads the RST-5 request reduction as covering all writes.
