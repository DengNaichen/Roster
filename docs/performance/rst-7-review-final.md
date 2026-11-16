# RST-7 final evidence audit

- Scope:
  - `docs/performance/rst-7.md`, `delivery.md`, `decisions.tsv` and `rst-7-summary.json`.
  - The five final JSON files: `rst-7-final-after`, `lifecycle`, `access`, `conditional` and `content`.
  - `scripts/performance/remote-report.mjs` and `source.mjs`.
  - The logs `/tmp/roster-rst7-{check,web,db,build}.log`.
- Read-only. No source edits and no browser operations. The only GitHub calls were reads: `gh pr view` and `gh pr checks`.
- Earlier rounds: `/tmp/roster-rst7-review.md`, `-followup.md` and `-code-final.md`. The copies in `docs/performance/rst-7-review-*.md` are byte-identical to them.

## What I verified independently

| Claim | Check | Result |
|---|---|---|
| All five final artifacts carry the same runtime hash | Read `source.runtimeSha256` in each file | ✅ All are `d4a69f63…b6f9`. They were measured between 11:26:08Z and 11:30:15Z. |
| The current tree matches that hash | `node scripts/performance/source.mjs` | ✅ Same hash, 101 files. **The hash covers less than it appears to; see R1.** |
| `rst-7-summary.json` is regenerated from the artifacts | I reran `remote-report.mjs docs/performance` and compared the JSON | ✅ Identical. All of the script's assertions passed. |
| MCP→DOM P50/P95 = 14966/14991 ms, n=5 | Summary and artifact | ✅ The P95 at n=5 is the maximum sample, and the report says so. |
| Idle: 6×304, 26 SQL, 0 body bytes, at most 1 in flight per query | `remote-report.mjs` asserts each of these | ✅ That is 2 ticks × (3 GET, 13 SQL). |
| Hidden 32,142 ms and offline 17 s, both with 0 requests; focus 223 ms, reconnect 216 ms | Summary | ✅ |
| Backoff gap is 30,005.8 ms; recovery came through a focus event (214 ms) | The report asserts `attempts[2]-attempts[1] ≥ 29.5 s` | ✅ The wording in `rst-7.md` is accurate ("重新聚焦后", i.e. after refocusing). It does not claim that the 60 s timer recovers on its own. |
| Access: private/public 14530/14851 ms, suspend/restore 14928/14831 ms, deletion 14827 ms | The artifact, with capture windows now reset | ✅ The report asserts `titlePresent` for each scenario. The deletion timing is stated as a single sample with no comparison. |
| Content: MCP log shown in the open panel after 15,118 ms; draft kept; triage enter/leave 14726/15042 ms | Artifact (`draftPreserved: true`) | ✅ But see R2. |
| Conditional API: list 3.4/5.1 vs 3.4/4.4 ms, detail 6.5/11.7 vs 5.9/9.2 ms; bytes 17363/743278→0; SQL unchanged | Summary, 20 rows per group | ✅ |
| Cost: about 12 requests and 52 SQL per minute per visible detail tab; worst case 4 × 743,278 B ≈ 2.97 MB per minute | Arithmetic | ✅ This depends on the page: it is 3 GET per tick for **the task detail page only**. |
| Check, web, DB and build passed | Tails of the four logs | ✅ check `fail 0`; web 26 files and 154 tests; DB `35 passed (6 steps) 0 failed`; build `✓ built` with the existing warning about chunks over 500 kB. |
| The first six PRs passed CI and skipped production deploy | `gh pr checks 43…48` | ✅ All show "Check and test: pass" and "Deploy production: skipping". All are OPEN. The head of #48 is `ca99a31`, which is this branch's base. |

I did **not** independently verify these:
- The failed build with the invalid value 999. No log was named.
- The "10 system dependency edges" in Roster. I made no MCP read.
- Anything in the component tests beyond the earlier code review.

## Remaining risk flags (none blocks opening the PR)

### R1 (Medium, evidence integrity): the runtime hash does not cover the backend, Vite config or most measurement scripts
- `source.mjs` hashes only `apps/web/src` (tests excluded), `apps/web/package.json`, `pnpm-lock.yaml`, `source.mjs`, `writes.mjs` and `ui-probe.mjs`.
- It does **not** hash:
  - `packages/backend/**`: `conditional.ts`, `app.ts`, `performance.ts`. These produce the ETag, 304, CORS and SQL-count results.
  - `apps/web/vite.config.ts`.
  - `remote-*.mjs`, `conditional.mjs` or `access.ts`.
- The `scope` text says "measurement scripts", which overstates what is covered.
- File mtimes show the backend files were last changed at 18:55–18:58 local time, before the final runs (19:26–19:30), so the measurements very likely used the current backend. The hash does not prove it, though.
- Fix (before or soon after the PR):
  - Add `packages/backend/src`, `apps/web/vite.config.ts` and `scripts/performance/*.{mjs,ts}` to the manifest, or record a second `backendSha256`.
  - Change the `scope` string to match.
  - Until that is done, make `rst-7.md` say "the runtime hash covers the web runtime and part of the probe; the backend was unchanged during the run by timestamp, not by hash".

### R2 (Medium-Low, evidence integrity): `remote-content.mjs` and `remote-report.mjs` changed after their outputs
- `rst-7-content.json` was written at 19:31:02 local. `remote-content.mjs` has mtime **19:31:45**, so the script was edited after the artifact it is cited for. `remote-report.mjs` (19:33:58) was also edited after the run. I reran it, and the summary still matches exactly, so that part is fine.
- Both files are untracked and outside the hash, so I cannot tell what changed in `remote-content.mjs`.
- Either rerun content with the final script (the frontend is frozen, so the runtime hash stays the same), or state in `rst-7.md` what changed and why the change does not affect the result.

### R3 (Low, wording): the summary rows in `delivery.md` drop caveats that `rst-7.md` keeps
- The RST-7 row "MCP→DOM P50/P95 14966/14991ms" should carry "(worst poll phase, n=5, local)" in the row itself. The caveat currently appears only further down, under "不能外推" (cannot be generalised).
- Change "默认3请求/15秒" (3 requests per 15 s by default) to "task detail page: 3 requests per 15 s". Other pages poll a different set.
- The RST-2 row and "区域方案由真实Tokyo/Paris结果支持" (the region choice is backed by real Tokyo/Paris results) still present **one interleaved batch from one location** with no qualifier. This was D1 in the first review. The P95 at n≈19 is the maximum (D2), and the RST-2 numbers predate the RST-3/RST-6 payload and SQL changes (D3).
  - The general line "小样本P95受极值影响" (small-sample P95 is dominated by outliers) partly covers D2.
  - D1 and D3 are not covered. Add "single batch, one client location; measured on the pre-RST-3 payload" to the RST-2 row or to the "不能外推" section.

### R4 (Low, product risk to state in the PR): poll load scales with open tabs
- Each visible tab runs its own timer with no jitter. A 304 still runs authentication, SQL, SHA-256 and an Edge invocation.
- `rst-7.md` already says this, along with "no hosted cost, concurrency or production-scale data measured". Keep that sentence in the PR body, so the reviewer sees that the 15 s default is a product decision made without load data.
- `VITE_REMOTE_REFRESH_MS=0` is the documented kill switch.

### R5 (Info): rollback and compatibility claims
- I checked these against the code:
  - With `0`, polling is disabled and the normal focus/reconnect behaviour returns (`refetchOnWindowFocus` returns true when `!refreshInterval`).
  - A new frontend against an old backend never sends `If-None-Match`, because no validator exists.
  - The advice to keep the `If-None-Match` CORS allow-list when rolling back the backend is correct.
- No database migration.

### R6 (Info): states that must still be recorded after the PR is created
- The RST-7 PR URL, its CI result and the ticket move to **In review** are not done yet. Do not mark the ticket Done: production deploy, the OAuth first-login/refresh/revoke/sign-out cycle and hosted CORS are explicitly unverified, and `rst-7.md` and `delivery.md` say so correctly.
- `decisions.tsv` row 11:15:18 still says "browser rerun pending". The 11:33:58 row supersedes it. That is fine for an append-only log; a reader only needs to read both rows.

## Bottom line
The factual claims in `rst-7.md` match the final artifacts and logs. The caveats on phase locking, n=5, local-only measurement, 304 cost, deletion through a fixture, and OAuth or production not being verified are present and accurate.

Two evidence-integrity gaps remain:
- R1: the hash scope leaves out the backend and the scripts.
- R2: the content script was edited after its run.

Neither undermines the measured results, given the timestamps, but both should be fixed or disclosed in the PR. R3 is wording only.
