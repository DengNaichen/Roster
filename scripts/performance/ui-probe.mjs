// Evaluate once per document in ego-lite. No URLs, credentials or content are retained.
(() => {
  globalThis.rosterUiProbe?.dispose();
  const requests = [];
  const queryIds = new Map();
  const original = globalThis.fetch.bind(globalThis);
  const origin = performance.now();
  globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === 'string' || input instanceof URL ? input : input.url,
      location.href,
    );
    const measured = url.pathname.includes('/api/');
    const resource =
      /\/(issues|teams|projects|labels|specs|capabilities|workspaces|access|session|cycles|members)(?:\/|$)/
        .exec(url.pathname)?.[1] ?? 'other';
    if (!queryIds.has(url.href)) queryIds.set(url.href, queryIds.size + 1);
    const sample = {
      queryId: queryIds.get(url.href),
      resource,
      method: init?.method ?? (input instanceof Request ? input.method : 'GET'),
      start: performance.now(),
      end: null,
      status: null,
      bytes: null,
      sqlCount: null,
    };
    if (measured) requests.push(sample);
    try {
      const response = await original(input, init);
      sample.status = response.status;
      sample.sqlCount = response.headers.has('x-roster-sql-count')
        ? Number(response.headers.get('x-roster-sql-count'))
        : null;
      if (measured) {
        void response.clone().arrayBuffer().then((buffer) => {
          sample.bytes = buffer.byteLength;
          sample.end = performance.now();
        }, () => {
          sample.end = performance.now();
          sample.status = 0;
        });
      }
      return response;
    } catch (error) {
      sample.status = 0;
      sample.end = performance.now();
      throw error;
    }
  };
  let marker = origin;
  let requestWindow = origin;
  let cancel = () => {};
  const stop = async (scenario, matched = performance.now()) => {
    const pendingAtMatch =
      requests.filter((r) => r.start >= requestWindow && (r.end === null || r.end > matched))
        .length;
    const matchedAt = performance.timeOrigin + matched;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const visible = performance.now();
    const samples = requests.filter((r) => r.start >= requestWindow).map((r) => ({
      resource: r.resource,
      method: r.method,
      status: r.status,
      startMs: r.start - marker,
      endMs: r.end === null ? null : r.end - marker,
    }));
    return {
      schema: 2,
      scenario,
      matchedMs: matched - marker,
      matchedAt,
      requestWindow: 'arm-to-visible, including hover prefetch before input',
      pendingAtMatch,
      online: navigator.onLine,
      ms: visible - marker,
      requests: samples,
      pendingAtVisible: samples.filter((r) => r.endMs === null).length,
      visibility: document.visibilityState,
    };
  };
  const probe = {
    result: null,
    start(since = performance.now()) {
      marker = performance.now();
      requestWindow = since;
    },
    stop,
    capture() {
      return requests.filter((r) => r.start >= requestWindow).map((r) => ({
        queryId: r.queryId,
        resource: r.resource,
        method: r.method,
        status: r.status,
        bytes: r.bytes,
        sqlCount: r.sqlCount,
        startMs: r.start - marker,
        endMs: r.end === null ? null : r.end - marker,
      }));
    },
    idleFor(ms) {
      const current = requests.filter((r) => r.start >= requestWindow);
      return current.length > 0 && current.every((r) => r.end !== null) &&
        performance.now() - Math.max(...current.map((r) => r.end)) >= ms;
    },
    watch(scenario, selector, text = '', fromNavigation = false) {
      cancel();
      probe.result = null;
      marker = fromNavigation ? 0 : performance.now();
      requestWindow = marker;
      const observer = new MutationObserver(check);
      function check() {
        if (![...document.querySelectorAll(selector)].some((e) => e.textContent.includes(text))) {
          return;
        }
        observer.disconnect();
        void stop(scenario).then((result) => probe.result = result);
      }
      cancel = () => observer.disconnect();
      observer.observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      check();
    },
    dispose() {
      cancel();
      globalThis.fetch = original;
    },
    arm(scenario, selector, text = '', trigger = 'a,button,[role="option"]') {
      cancel();
      probe.result = null;
      const armedAt = performance.now();
      const matches = () => {
        const el = document.querySelector(selector);
        return el && el.textContent.includes(text);
      };
      if (matches()) {
        throw new Error('Expected result is already present; choose a new visible state');
      }
      let timer;
      const observer = new MutationObserver(check);
      const events = ['pointerdown', 'mousedown', 'click'];
      function cleanup() {
        events.forEach((event) => document.removeEventListener(event, start, true));
        observer.disconnect();
        clearTimeout(timer);
      }
      function check() {
        if (!matches()) return;
        cleanup();
        void stop(scenario).then((result) => probe.result = result);
      }
      function start(event) {
        if (!(event.target instanceof Element) || !event.target.closest(trigger)) return;
        events.forEach((event) => document.removeEventListener(event, start, true));
        probe.start(armedAt);
        timer = setTimeout(() => {
          cleanup();
          probe.result = { scenario, error: 'visible result timed out' };
        }, 30000);
        observer.observe(document, {
          subtree: true,
          childList: true,
          attributes: true,
          characterData: true,
        });
        check();
      }
      cancel = cleanup;
      events.forEach((event) => document.addEventListener(event, start, { capture: true }));
    },
  };
  globalThis.rosterUiProbe = probe;
})();
