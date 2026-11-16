# RST-4 final confirmation (read-only)

This is a read-only review of the current uncommitted RST-4 diff. I made no edits, used no browser and called no services.

Local checks:
- `tsc --noEmit` in `apps/web` is clean.
- `vitest run` passes: 18 files, 119 tests. That is two more tests than the previous round.
- `AbortSignal.any` and `AbortSignal.timeout` no longer appear anywhere in `src`.

## Verdict: no blockers remain

### B1: a rejected write purges readable data — resolved
`CacheScope.reject` now purges only when a write returns 403 with the message `Workspace access denied`.

For any other 403 or 404 (criterion, cycle, label, team-owner and so on):
1. `beginWrite` has already marked the parent as invalid.
2. Nothing writes confirmed data into the parent.
3. When the gate releases, the active stale queries are refetched, so the parent reloads.
4. The GET then decides the outcome. A real deletion or loss of access still purges through the read `onError` path.

The regression test is `queryCache.test.tsx:294`, where a criterion returns 404 and the parent stays readable.

### B2: `AbortSignal.any` compatibility — resolved
`api()` now wraps every write in an `AbortController` with a 30 s timer and races it with `Promise.race`. The timer covers the whole request: `getSession`, `fetch` and `response.json()`.
- **A stalled session lookup cannot send late.** After the race rejects, `requestApi` keeps running in the background. When `getSession` finally returns, `apiFetch` checks `init.signal.aborted` and throws before calling `fetch`. A late write is therefore never sent.
- **No unhandled rejections.** `Promise.race` attaches handlers to both promises. The `interrupted` promise stays pending only when nothing aborts. The `finally` block clears the timer and both listeners.
- **The user gets a clear message.** A timeout now says "Save not confirmed. Refreshing to check the result." It is never retried automatically, and the test is `api.test.ts:54`.

### N1–N4
- **N1 — fixed.** The `pendingStatuses` map is keyed by identifier and revision, and it overlays the current base. This fixes two problems:
  - A response for an earlier move no longer removes a later pending move for the same issue, because the revision check prevents it.
  - A confirmed response for a different issue no longer makes a pending card jump back.
- **N2 — fixed.** `document` is removed before the result is merged into the list cache and the overlay.
- **N3 — fixed.** The session lookup is now inside the timeout window.
- **N4 — fixed.** The uncertain-save message has been added.

## Residual notes (not blockers)
1. **An earlier move's error can be silently dropped.** Say you move a card twice. If the earlier move's request fails while the later one is still pending, the revision check makes `failure` return before `setError`. The error message is lost. The final state is still right, because the later write and the refetch converge. A good fix in RST-5 is to show the error even when nothing is rolled back.
2. **A pending entry can stay behind after disposal.** If the scope is disposed, a queued or sent write calls neither `success` nor `failure`, so its `pendingStatuses` entry remains. This only affects the hook instance that is disposed. `WorkspaceView` is keyed by `slug` (`App.tsx:47`), so switching workspace remounts the page and the stale entry is never visible.
3. **A write that commits after its timeout can show stale data.** If the server commits after the 30 s client timeout, the refetch on release can still read the state from before the commit. The view then stays stale until the next focus or write. This is acceptable given the uncertain-save wording.
4. **Already planned for RST-5:** broad workspace invalidation and refetch after each write, and owner-bound writes. The RST-4 request-count measurements should still label these post-write refetches.
