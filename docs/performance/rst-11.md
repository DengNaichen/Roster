# RST-11: MCP gzip negotiation

Branch: `compressed-mcp-responses`, based on main `4148a706f91efb542bcd934b362fe32aebbf24c8`.

## Change and scope

Compress authenticated successful MCP POST replies using native `CompressionStream('gzip')` when
`Accept-Encoding` permits gzip. Preserve both structured and text results and the existing JSON/SSE
protocol. No schema, query, authorization, cache ownership or frontend changes.

Explicit `gzip;q=0` overrides wildcard; absent/invalid support falls back to identity. Preserve
`Vary: Origin`, append `Accept-Encoding`, remove the original Content-Length, and skip existing
encodings/ranges/no-transform. Discovery, authentication failures, notifications returning 202,
and GET subscription streams are not compressed. Cancellation and upstream failure propagate.
No full-response buffering is added. Current tools do not emit progress notifications; gzip can
buffer small intermediate SSE events. Future progress-producing POST tools must revisit this choice.

Browser/standard fetch HTTP implementations decompress Content-Encoding before application code
reads text/JSON. Application code must not gunzip the already-decoded body again. Low-level raw HTTP
clients must handle gzip themselves or omit/reject it in Accept-Encoding.

## Actual verification

Raw samples: [rst-11-local.json](rst-11-local.json). The committed script uses real loopback TCP,
MCP transport, locally signed JWT validation, service and restricted Postgres. Runtime automatic
compression is disabled to prove this middleware supplies gzip. Two warmups and 20 alternating
samples per encoding/scenario. Raw Node HTTP measures compressed bytes; ordinary fetch separately
proves automatic decoding. All decoded business results match exactly.

| Scenario | Identity bytes | Gzip bytes | Identity P50/P95 ms | Gzip P50/P95 ms |
| --- | ---: | ---: | ---: | ---: |
| Ordinary task | 2,353 | 774 | 2.87 / 3.57 | 3.10 / 5.41 |
| Stress: 164 long document edits | 12,919,016 | 197,272 | 24.96 / 34.76 | 31.99 / 34.58 |

Each read makes one HTTP request in both modes. SQL counts and page interaction latency were not
measured in this transport-only experiment. The stress fixture is synthetic and deliberately
extreme, not a claim about typical workspace data. Its content differs from the earlier hosted
PERF-50 fixture, so the local and hosted timings are not a before/after comparison.

On loopback, compression adds CPU latency rather than improving P50. The benefit is reduced network
bytes (98.5% in this stress fixture); no hosted latency improvement is claimed. Earlier read-only
browser compression of the actual hosted 6.31 MB MCP response produced 35.1 KB with exact roundtrip,
but that was offline CompressionStream measurement, not HTTP gzip deployment.

Reproduce in this branch's isolated preview database after worktree setup:

```sh
DATABASE_URL=postgresql://roster_preview_runtime@127.0.0.1:55479/roster_wt_41c3477b7001_preview \
  node scripts/toolchain.mjs deno run --allow-env --allow-net --allow-read --allow-write \
  scripts/performance/gzip.ts /tmp/roster-gzip.json
```

Use the current worktree's own local database/port from `.env.worktree`; the example identifies the
measured worktree. The script rejects hosted/admin connections and creates a fresh synthetic
workspace on each run. Worktree cleanup drops that worktree's preview database.

## Limits and rollback

Production Supabase gateway behavior, hosted compressed OAuth/MCP requests, external MCP clients,
and browser UI over this new HTTP compression remain unverified. The browser measurement space was
handed to the user and not reclaimed for this PR. Existing production OAuth access was established
before this change; it is not evidence that hosted gzip works. No deployment or production data
mutation is part of this PR.

Transport tests cover positive/negative quality negotiation, exact Unicode decode, JSON and SSE,
headers, live GET/empty/error skips, automatic HTTP fetch decoding, cancellation and stream errors.
Existing authorization/CORS and full database tests remain applicable.

Revert this PR's squash commit to return to uncompressed responses without database migration or
client changes. Retain the stress case as a known limitation until hosted acceptance is completed.

Primary runtime reference: [Deno HTTP compression](https://docs.deno.com/runtime/fundamentals/http_server/#automatic-body-compression).
