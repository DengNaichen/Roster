# RST-7 code review: final check of the code blockers

- Scope: the current uncommitted source and tests in `remote-refresh-on-roundtrips`, compared with `origin/query-roundtrips-on-writes` (`ca99a31`).
- Read-only: no edits to source, git, tickets or the browser.
- Earlier reviews: `/tmp/roster-rst7-review.md` and `/tmp/roster-rst7-review-followup.md`.

## What I ran
- `apps/web`, full `npx vitest run`: **26 files and 154 tests passed.**
- `apps/web`, `npx tsc --noEmit -p .`: exit 0.
- I did not run the full `node scripts/toolchain.mjs check` or the DB suite, so rerun them as planned. I did no browser work.

## Verdict: the code blockers are resolved

### B1 (private-team spec kept after team loss): resolved
- In `queryCache.tsx`, the `readable` predicate now evaluates `typeof data.team !== "string" || !lost.has(data.team)` **first**, as an AND. An explicit lost team rejects the body before any other check.
- Identifier inference is used only when the key matches `/\/issues\/[^/?]+$/`. A `SPEC-n` identifier no longer counts as evidence that the body is readable.
- Walkthrough of the cases:
  - `SPEC-9`/`PR` is cleared.
  - `SPEC-8`/`AL` is kept.
  - A mounted `AL-1` detail is kept, and its `PR-*` relations are removed.
  - A `PR-1` detail is cleared, whether through its team field or through the identifier prefix.
  - A cycle (`Cycle.team`) from the lost team is cleared.
  - Mounted bodies with no team, issue identifier or `issues` array, such as the dependency graph, are cleared conservatively and refetched.
- Test `queryCache.test.tsx:412`: a mounted, active `SPEC-9`/`PR` is cleared, and then the observer's failing refetch runs. The test asserts the body is still `undefined` after that, which is exactly the transient-failure path I raised.

### B2 (dead `queryKey` parameter): resolved
- `fetchResource` now does `queryKey ? cache.find({queryKey, exact:true}) : undefined`. With no key, it sends no `If-None-Match` and records no validator. `resourceOptions` forwards the key of the query that is executing.
- WorkLogs passes no key, so its infinite pages never take part in validation.
- Test `queryValidators.test.ts:64`: an exact-key query and a key-less `fetchResource` share the same path. The key-less call sends no conditional header and does not overwrite the query's validator; the next keyed fetch still sends `W/"first"` and gets the 304. This test would have failed against the previous dead-parameter code, so it is a real regression test.

### Other earlier findings, rechecked in the current code
- M2 backoff classification, M3 allow-list, L1 timeout text and L4 graph cleanup are unchanged since the follow-up, and their tests pass.

## Non-blocking residuals (document them; no code change required)
1. **Some lost-team content stays on screen for up to one round-trip.**
   - What stays: mounted collections that have an `issues` array and no `team` field, such as `/specs/:id/issues` and filtered `/issues?…` lists, keep their non-row fields. Mounted unaffected details keep nested text that is not cleaned, such as activity entries that mention lost-team issues.
   - When it clears: the active refetch issued immediately afterwards corrects it.
   - Exposure is limited to content the user could read moments earlier. The report should say "best-effort local removal; authoritative convergence on the next successful read".
2. **Conservative clearing can make some mounted views flash once on team loss.** These are views with no team or issue shape: the dependency graph, revision lists and settings bodies. This is acceptable, but say so.
3. **Spec bodies that lack a `team` field would fall through to the "unknown" branch and be cleared.** That is correct today, but note it as a dependency in case the contract changes.

## Still open, outside the code-blocker scope
These are carried over from the follow-up and are not re-verified here:
- B3: rerun all final measurements on one frozen runtime, with a `sourceManifest` embedded in each artifact. Do not mark the access, lifecycle or after runs as passed until they land.
- B4 and B5: evidence wording.
  - Lifecycle recovery was triggered by a focus event; the backoff timer did not do it.
  - The access `requests` lists are cumulative.
  - The deletion delay difference is timer phase, not a code effect.
  - Status `0` means the read was aborted.
- M4: the final report needs the cost per visible tab (requests, SQL and bytes per minute) and a "hosted not measured" statement.
- The full `toolchain check` and the DB suite must be rerun after the latest frontend changes.
