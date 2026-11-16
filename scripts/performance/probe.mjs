// Evaluate in ego-lite's Page. Tokens and response bodies remain in that Page.
// The exported report contains only numeric samples, status and region.
(() => {
  const percentile = (values, fraction) => {
    const ordered = values.filter((value) => value !== null).sort((a, b) => a - b);
    return ordered.length ? ordered[Math.ceil(ordered.length * fraction) - 1] : null;
  };
  const summarize = (samples) =>
    Object.fromEntries(
      [...new Set(samples.map((sample) => sample.scenario))].map((scenario) => {
        const rows = samples.filter((sample) => sample.scenario === scenario);
        return [scenario, {
          samples: rows.length,
          failedHttpSamples: rows.filter((row) => row.status < 200 || row.status >= 300).length,
          regions: [...new Set(rows.map((row) => row.region))],
          ...Object.fromEntries(
            ['ms', 'bytes', 'parseMs', 'sqlCount', 'sqlMs', 'appMs'].map((key) => [key, {
              unknown: rows.filter((row) => row[key] === null).length,
              p50: percentile(rows.map((row) => row[key]), 0.5),
              p95: percentile(rows.map((row) => row[key]), 0.95),
            }]),
          ),
        }];
      }),
    );
  globalThis.rosterProbe = {
    summarize,
    async run(
      {
        revision = 'unspecified',
        throttling = 'none',
        base,
        workspace,
        count = 20,
        region,
        preview = false,
        seed = false,
        seedCount = 50,
        startIndex = 0,
      },
    ) {
      if (!/^perf-[a-z0-9-]+$/.test(workspace)) throw new Error('Use a dedicated perf-* workspace');
      const url = new URL(base);
      if (
        preview
          ? !['127.0.0.1', 'localhost'].includes(url.hostname)
          : !url.hostname.endsWith('.supabase.co')
      ) {
        throw new Error('Expected loopback preview or Supabase API');
      }
      if (!Number.isInteger(count) || count < 0 || count > 100) {
        throw new Error('Count must be 0..100');
      }
      const session = preview
        ? null
        : JSON.parse(localStorage.getItem(`sb-${url.hostname.split('.')[0]}-auth-token`) ?? 'null');
      if (!preview && !session?.access_token) {
        throw new Error('Sign in through the application first');
      }
      const headers = {
        'Content-Type': 'application/json',
        ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
      };
      const samples = [];
      async function request(path, method = 'GET', body, scenario) {
        const target = new URL(`${base.replace(/\/$/, '')}/api${path}`);
        if (region) target.searchParams.set('forceFunctionRegion', region);
        if (!preview) {
          const current = JSON.parse(
            localStorage.getItem(`sb-${url.hostname.split('.')[0]}-auth-token`) ?? 'null',
          );
          if (!current?.access_token || current.user?.id !== session.user?.id) {
            throw new Error('Browser session changed; restart measurement');
          }
          headers.Authorization = `Bearer ${current.access_token}`;
        }
        const start = performance.now();
        const response = await fetch(target, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(30000),
        });
        const text = await response.text();
        const elapsed = performance.now() - start;
        const parseStart = performance.now();
        if (!response.ok) {
          throw new Error(`Business request failed (${response.status}); not a valid baseline`);
        }
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error(`Non-JSON business response (${response.status})`);
        }
        const parseMs = performance.now() - parseStart;
        const timing = response.headers.get('Server-Timing') ?? '';
        const timingValue = (name) => {
          const value = new RegExp(`${name};dur=([0-9.]+)`).exec(timing)?.[1];
          return value === undefined ? null : Number(value);
        };
        if (scenario) {
          samples.push({
            scenario,
            status: response.status,
            ms: elapsed,
            bytes: new TextEncoder().encode(text).length,
            parseMs,
            sqlCount: response.headers.has('X-Roster-Sql-Count')
              ? Number(response.headers.get('X-Roster-Sql-Count'))
              : null,
            sqlMs: timingValue('sql'),
            appMs: timingValue('app'),
            region: response.headers.get('x-sb-edge-region'),
          });
        }
        if (!response.ok) {
          throw new Error(`Business request failed (${response.status}); not a valid baseline`);
        }
        return data;
      }
      const path = `/w/${workspace}`;
      const fixtureDocument = {
        lead: 'Synthetic performance fixture. '.repeat(40).trim(),
        sections: [{
          title: 'Details',
          blocks: [{
            type: 'paragraph',
            text: 'Deterministic fixture content for payload comparison. '.repeat(60).trim(),
          }],
        }],
        criteria: [{ id: 'AC-1', title: 'Fixture only', detail: '', done: false }],
      };
      if (seed) {
        const existing = await request('/workspaces');
        if (!existing.workspaces.some((item) => item.slug === workspace)) {
          await request('/workspaces', 'POST', { slug: workspace, name: 'Performance Test' });
        }
        const teams = await request(`${path}/teams`);
        if (!teams.teams.some((item) => item.key === 'PERF')) {
          await request(`${path}/teams`, 'POST', { key: 'PERF', name: 'Performance Test' });
        }
        const existingIssues = await request(`${path}/issues?team=PERF&limit=100`);
        for (let i = (existingIssues.issues ?? existingIssues.items).length; i < seedCount; i++) {
          await request(`${path}/issues`, 'POST', {
            team: 'PERF',
            title: `Performance fixture ${i + 1}`,
            status: 'todo',
            priority: 3,
            document: fixtureDocument,
          });
        }
      }
      const fixture = await request(`${path}/issues?team=PERF&limit=100`);
      const issues = fixture.issues ?? fixture.items;
      let fingerprint = null;
      if (count) {
        await request(`${path}/issues/PERF-50`, 'PATCH', { priority: 3, status: 'todo' });
        if (
          issues.length !== 50 || new Set(issues.map((issue) => issue.identifier)).size !== 50 ||
          issues.some((issue) =>
            issue.title !== `Performance fixture ${Number(issue.identifier.slice(5))}` ||
            !/^PERF-([1-9]|[1-4][0-9]|50)$/.test(issue.identifier)
          )
        ) throw new Error('Fixture differs: expected PERF-1..50');
        const canonical = (value) =>
          Array.isArray(value)
            ? value.map(canonical)
            : value && typeof value === 'object'
            ? Object.fromEntries(
              Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
            )
            : value;
        for (const row of issues) {
          const document = row.document ??
            (await request(`${path}/issues/${row.identifier}`)).document;
          if (JSON.stringify(canonical(document)) !== JSON.stringify(canonical(fixtureDocument))) {
            throw new Error('Document differs from fixture v2');
          }
          if (
            row.project !== null || row.parent !== null || row.labels.length ||
            (row.identifier !== 'PERF-50' && (row.status !== 'todo' || row.priority !== 3))
          ) throw new Error('Fixture metadata differs');
        }
        const hash = await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(JSON.stringify(canonical(fixtureDocument))),
        );
        fingerprint = [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0'))
          .join('');
      }
      for (let i = 0; i < count; i++) {
        const temperature = i + startIndex === 0 ? 'first-observed' : 'warm';
        await request(`${path}/issues?team=PERF&limit=50`, 'GET', undefined, `list-${temperature}`);
        await request(`${path}/issues/PERF-1`, 'GET', undefined, `detail-${temperature}`);
        await request(
          `${path}/issues/PERF-50`,
          'PATCH',
          { priority: i % 2 ? 3 : 2 },
          `write-${temperature}`,
        );
      }
      if (count) await request(`${path}/issues/PERF-50`, 'PATCH', { priority: 3 });
      return {
        schema: 2,
        revision,
        browser: navigator.userAgent,
        visibility: document.visibilityState,
        seed,
        seedCount,
        startIndex,
        environment: { apiOrigin: url.origin, workspace, throttling },
        measuredAt: new Date().toISOString(),
        mode: preview ? 'local-preview-fixed-identity' : 'authenticated-rest',
        count,
        requestedRegion: region ?? 'auto',
        coldStart: 'unobservable; first-observed is not proof of cold start',
        dataset: { issues: issues.length, fixture: 'v2', documentSha256: fingerprint },
        samples,
        summary: summarize(samples),
      };
    },
  };
})();
