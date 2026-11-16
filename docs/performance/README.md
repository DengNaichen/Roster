# Performance regression protocol

Use the same commit, fixture, browser, network and authentication mode for each before/after pair. Run against an isolated `perf-*` workspace; never mutate the development workspace `roster`. Fixture v2 has 50 synthetic issues, identical long documents, no project/labels/parent. Read PERF-1; write only PERF-50 so audit growth does not change the detail sample. This is a payload stress fixture, not a claim about typical customer data. Add labeled/parented/private-team coverage separately.

## API measurement in ego-lite

Read ego-browser skill and run `ego-browser skill`. Create one task space, navigate to the actual app, and sign in normally. Resume its ID for subsequent commands. Tokens stay in the page; never print browser storage, request headers or response bodies.

Load `scripts/performance/probe.mjs` with `page.evaluate(await fs.readFile(absolutePath, 'utf8'))`. Start the run without awaiting its long promise in Page.evaluate (ego-lite limits evaluations to 15 seconds):

```js
await page.evaluate(() => {
  window.perfRun = { status: 'running' };
  void rosterProbe.run({
    base: 'https://PROJECT.supabase.co/functions/v1/api',
    workspace: 'perf-baseline-YYYYMMDD',
    seed: true, // first setup only; resumes an incomplete synthetic fixture
    count: 20,
    // region: 'eu-west-3', // regional comparison only
  }).then(report => window.perfRun = { status: 'complete', report })
    .catch(error => window.perfRun = { status: 'failed', error: String(error) });
});
```

Poll only `perfRun.status` until settled, then save `perfRun.report` as JSON. Do not launch another run while it is pending. A failed request invalidates the run, never relabel a 401 as a business sample. For local preview set `preview: true` and the worktree's API base. Preview uses a fixed local identity and **does not verify OAuth**. Fixture creation and final priority restoration are outside the timed sample count. The first of 20 samples is separated from 19 warm samples. First observed does not prove a cold start. P95 uses nearest rank; 19 warm samples have a coarse tail estimate. Compare enough repeated batches for production decisions.

Response bytes are UTF-8 decoded JSON bytes, not compressed network bytes. JSON parsing is measured separately after body download; sub-millisecond values have browser timer quantization. Client duration includes fetch, body transfer and browser scheduling. SQL duration includes driver round trips and, outside transactions, pool wait. Transaction checkout, BEGIN/COMMIT/ROLLBACK and commit latency are excluded; it is not database CPU time. Unknown metrics are null, never zero.

## SQL diagnostics

`ROSTER_PERFORMANCE=true` enables `Server-Timing: app, sql` and `X-Roster-Sql-Count` on successful non-streaming responses from the normal authenticated bootstrap. It is off in deployed configuration by default; no deployment is needed for local preview, which enables it. Counters cover application executions, including failed statements, excluding transaction BEGIN/COMMIT/ROLLBACK. They retain no SQL, parameters, user IDs or content. Error and SSE responses omit diagnostics; MCP SSE headers precede tool completion, so SQL/app metrics there remain unavailable. Async request contexts prevent concurrent requests sharing counters. Do not add total SQL time to app time (it is included and may overlap).

When production has no diagnostic headers, record SQL and execution region as unavailable (region may separately be observed through sanitized CDP response metadata). Obtaining those metrics requires an independently authorized instrumented deployment or existing trace evidence. Do not infer them from a different environment. Region verification is `x-sb-edge-region`, subject to CORS exposure; browser null means unavailable. Database indexes and plans require local EXPLAIN evidence, not assumptions.

## Browser interactions

Install `scripts/performance/ui-probe.mjs` once per document with `page.evaluate(source)` (or `Page.addScriptToEvaluateOnNewDocument` before first navigation in the same ego round). For an interaction, call `rosterUiProbe.arm(scenario, expectedCssSelector, expectedText, triggerCssSelector)`, then use ego-lite's normal click. The expected result must be absent before the action. Wait for `rosterUiProbe.result`, then save it. Do not launch a second action until this result settles. For initial navigation, observe the first actual issue row after DOMContentLoaded and call `stop('first-list')`; elapsed time includes navigation bootstrap when installed before the document loads.

Schema 2 starts on the first actual pointer/mouse/click event, waits for the expected DOM plus two animation frames, and includes requests **started** since the marker, with start/end offsets and pending-at-visible count. It counts body completion via response clones (diagnostic overhead is present in both versions), never exports content, and uses resource categories without IDs or search terms. Record browser build, fixture, commit, network/CPU throttling and sample count in the report manifest. Early schema-1 UI observations are exploratory upper bounds and cannot establish cache-before-fetch or request-budget acceptance. Include first load, repeated list entry, list/detail round trip, property feedback and confirmed write. Never use a fixed sleep as proof that rendering completed.

## Remote update visibility

Open the synthetic task in the browser. Make a normal MCP update to PERF-50 in the **same test workspace**, record acknowledgement time, and wait for the new visible property. Report acknowledgement-to-visibility latency, observation window, request overhead, page visibility and network state. The local preview MCP is a real local transport with a fixed identity; it does not prove hosted OAuth. If the UI remains stale at the end of the observation window, report that lower bound, not a fabricated latency.

## Regression gates

Keep authorization, user/workspace isolation, per-issue write ordering, stale response rejection and recovery as functional gates. API improvements must compare the same dataset/region/authentication. Browser hot navigation should render cached data without a blocking fetch; mutation feedback should occur before network confirmation. Set numeric budgets in the baseline report after the actual measurements. RST-7's initial request budget is at most one refresh in flight per query, visible-only polling and bounded retry backoff. No offline replication is in scope.

批量页面往返：`node scripts/performance/roundtrip.mjs SPACE_ID PAGE_LABEL perf-WORKSPACE OUTPUT.json 20`，复用已建立的 ego-lite TaskSpace。`watch(scenario, selector, text)` 可立即开始被动远端观察，输出 `matchedAt` 的绝对毫秒时间，与 MCP 的 `acknowledgedAt` 相减；`matchedMs` 与 `pendingAtMatch` 在 DOM 条件满足时捕获，两帧后的 `ms` 单独保留。不能在观察过程中切换被测页面，否则 rAF 可能暂停。
