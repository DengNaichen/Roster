# RST-4 cache implementation contract

A single memory QueryClient belongs to the signed-in subject, inside AuthBoundary and above navigation remounts. A temporarily expired session retains that subject's drafts; actual logout/unmount or identity replacement clears its client. Resource keys contain subject, workspace and canonical resource/filter path. Defaults: 30-second freshness, five-minute inactive GC, bounded read retries, focus/reconnect validation. No persistent cache or offline mutation queue.

`useResource<T>(path, initial)` keeps its existing consumer API. Initial fallback is not inserted into the cache. Cached content renders synchronously; background fetching does not set full-page loading. Initial failures remain local errors; cached refresh failures surface a shared notice. Access-denied/not-found responses remove rejected cached data rather than keep it visible.

List, detail and paginated work-log reads use Query. Explicit conflict/editor reads remain fresh API operations. Detail links prefetch on hover/focus. Remove navigation-triggered sidebar reloads; real writes still invalidate stale resources. Measurement includes requests starting between arm and click, so hover prefetch is counted.

Keep the existing per-entity/multi-entity write queue and cancellation of unsent work on disposal. Its pending writes block cache reads for that workspace, including focus reads, until the batch settles. Cancel stale cached reads before writes or authoritative updates. Scope disposal releases its waits; a sent write finishing after navigation invalidates current observers so the new page converges. Optimistic cross-view reconciliation is RST-5, not an offline engine.

Tests use real QueryClient providers, isolated per test unless deliberately shared. Retain existing filter/write, stale-focus, criterion and draft regressions; add cache reuse/deduplication, background content, scope isolation, permission purge and offline recovery cases. Compare the same local fixture before/after and record request starts as well as DOM/paint timing.
