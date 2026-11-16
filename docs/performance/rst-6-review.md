# RST-6 final review (read-only)

**Scope:** the current uncommitted diff in `query-roundtrips-on-writes`: the `catalog-query.ts` fast path, the additions to `service_test.ts` and `activity_test.ts`, `sql-plan.ts`/`read-ab.ts` (header only), and the RST-6 before/after/plan files.

**What I did not do:** no edits, services, browser or SQL. Test results are as you reported them.

## Verdict: no blockers. The fast path is correct. Narrow the latency claims to what the data supports.

## Null-reference fast path (`catalog-query.ts:17-36`)

### Correct as written
- **The condition is strict.** It uses `project_id === null && parent_id === null` on every input row. Rows without those keys (`undefined`) fall back to the joined path, so partial rows are safe.
- **All current callers pass rows that contain both columns:**
  - `issueSummarySelect` (list)
  - `issueSelect`/`i.*` (`readIssue`, children, relations)
  - write `output`, which receives the row from `readIssue` after the update
- **The output matches the joined path for null references:** `project_id: null`, `project: null`, `project_emoji: ''`, `parent: null`. Labels come from `l.*` through `labelDTO`, with the same `name_key,id` order, kept per issue in JS. The `il.workspace_id` filter is kept.
- **Visibility is unchanged.** With no parent there is no parent identifier to filter, and labels were never filtered by team before either.
- **No extra rows from joins.** The query is a flat label list grouped in JS, one entry per label row.
- **Snapshot consistency.** The fast path trusts the `project_id`/`parent_id` the caller just read, while the joined path re-reads `i.project_id` in a later statement. Reads run outside a transaction, so the two can differ only if a write lands between the statements. The fast path is then *more* consistent with the row it returns, not less.

### Test gap (low)
No test drives the fast path and the joined path on the same data. The budget assertions exercise the fast path, and the existing project/parent tests exercise the joined path. Suggested additions:
1. A **mixed page**: one row with a project or parent and the others null. This must use the joined path, and every row's labels, project and parent must match.
2. A **null-reference row with several labels**, including a grouped label. Check the order and the `group_id` mapping in the fast path.
3. A **partial row** without `project_id`. This must fall back.

A small `Deno.test` on the restricted test database, comparing fast-path output with joined output for the same ids, covers all three.

## Tests added since the last review

- **Revocation while waiting on the lock** (`service_test.ts`):
  1. A real second connection holds `workspaces … for update`.
  2. The test polls `pg_stat_activity` (`wait_event_type='Lock'`) until the update is blocked.
  3. It suspends the member and commits.
  4. The waiting update must reject with `forbidden`, the priority must be unchanged, and reads must be `forbidden`. A missing slug must give `not_found`.

  The polling query cannot match itself, because it is not waiting on a lock. The `rollback` after `commit` in `finally` is harmless. This test closes the earlier F4.
- **Audit leak test.** `role/joined/owner/labels/project/parent/direction` are asserted absent from audit snapshots. Good.
- **SQL budgets.** List = 3 and empty-relation REST detail = 9 are asserted through `X-Roster-Sql-Count`. Two small gaps:
  - There is **no write budget assertion** (8). The write path is where a future change would most likely add statements.
  - The rich detail budget (11) is only in the plan files, not in a test.
- **JSON vs driver codecs** (`activity_test.ts`, `Asia/Shanghai`).
  - The timestamp check is meaningful: `.123456+08` must become `2026-02-02T20:05:06.123Z` both ways. This closes F1.
  - The bigint check uses `9223372036854775807`. That value loses precision under `Number()` on **both** paths, so the test proves the two conversions are equal, not that they are exact. That is enough for today's DTOs, which use `Number()`. If exactness ever matters, use a value at or below 2^53, or compare the strings. Low.
- **EXPLAIN** now runs inside a read-only transaction. This closes F3.

## Evidence check

| | Before (SQL / bytes) | After (SQL / bytes) | Digest |
|---|---|---|---|
| Flat list | 5 / 17363 | 3 / 17363 | n/a |
| Flat detail | 20 / 14767 | 9 / 14767 | n/a |
| Flat write | 9 / 4997 | 8 / 4997 | n/a |
| Rich list | 6 / 28316 | 3 / 28316 | `13e2b60b…` identical |
| Rich detail | 46 / 188672 | 11 / 188672 | `8b14e359…` identical |
| Rich write | 9 / 5212 | 8 / 5212 | n/a |

These match your corrected REST counts. The +2 for `restDetail`/`listMembers` is right; my earlier estimate left out the REST compatibility layer.

### Latency (loopback, warm n=19)

| Path | Before p50/p95 (ms) | After p50/p95 (ms) | SQL time p50 (ms) |
|---|---|---|---|
| Flat list | 1.7/2.4 | 2.1/4.5 | not compared |
| Flat write | 2.1/5.0 | 3.0/7.6 | not compared |
| Rich detail | 7.5/11.8 | 6.1/9.0 | 7.96 → 3.97 |

### Claims the evidence supports
- The statement count drops on every path: rich detail 46 → 11, list 6 → 3, write 9 → 8.
- The list and detail payloads are byte-identical (stable SHA-256).
- Rich detail SQL time is about halved.

### Claims to avoid or label
- **Do not claim a general latency gain on loopback.** Flat list and write are *slower* at p50 and p95 in these runs. At loopback, one statement costs microseconds, so the noise dominates. Present these runs as "no regression beyond noise", and present the planned interleaved same-pool A/B as the deciding local evidence.
- **The production benefit has to be projected or measured.** It comes from removing database round trips: saved statements × the per-statement RTT from the API region to the database. Use RST-2's measured routing for the RTT, and label the result as a projection until a hosted run exists.

### `read-ab.ts`
The header looks safe: only the restricted `roster_wt_*_preview` database, the restricted role and loopback. No mocks and no artificial delay. Before relying on it, check two things:
1. **Order bias.** Alternate both A/B and B/A, include a warmup that is excluded, and use the same fixture order for both versions.
2. **SQL counts per version.** Both versions' modules load into one process, and each uses its own telemetry module instance. Confirm that each version's SQL count matches its standalone report: 6/46 before, 3/11 after on the rich fixture.

## Remaining (all low, can be done now or recorded)
1. A fast-path versus joined-path parity test: a mixed page, multiple labels and a partial row.
2. A write SQL budget assertion of 8, and a rich detail budget assertion of 11.
3. Optional: an exact bigint check, as described in the codec test above.
