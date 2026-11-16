// Real TCP + MCP + restricted local Postgres. No hosted credentials or production writes.
import { request as httpRequest } from 'node:http';
import { gunzipSync } from 'node:zlib';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'npm:jose@6.1.3';
import { createDatabase } from '../../packages/backend/src/platform/database/client.ts';
import { createIdentityVerifier } from '../../packages/backend/src/platform/auth/jwt.ts';
import { createService } from '../../packages/backend/src/service.ts';
import { createMcpFetch } from '../../packages/backend/src/transport/mcp/server.ts';

const connection = Deno.env.get('DATABASE_URL');
const [output] = Deno.args;
if (!connection || !output) throw new Error('Provide DATABASE_URL and an output JSON path');
const dbUrl = new URL(connection);
if (
  dbUrl.hostname !== '127.0.0.1' || dbUrl.username !== 'roster_preview_runtime' ||
  !/^\/roster_wt_[a-f0-9]{12}_preview$/.test(dbUrl.pathname)
) {
  throw new Error('Only the restricted local worktree preview database is allowed');
}
const { db, pool } = createDatabase(connection);
const service = createService(db);
const ctx = {
  identity: { subject: crypto.randomUUID(), name: 'Gzip benchmark', email: 'gzip@example.test' },
};
const slug = 'gzip-' + crypto.randomUUID();
const issuer = 'https://gzip.example.test/auth/v1';
const { privateKey, publicKey } = await generateKeyPair('ES256');
const jwk = await exportJWK(publicKey);
jwk.kid = 'gzip';
jwk.alg = 'ES256';
const bearer = await new SignJWT({ role: 'authenticated', email: ctx.identity.email })
  .setProtectedHeader({ alg: 'ES256', kid: 'gzip' }).setIssuer(issuer).setAudience('authenticated')
  .setSubject(ctx.identity.subject).setIssuedAt().setExpirationTime('10m').sign(privateKey);
const handler = createMcpFetch({
  service,
  publicUrl: 'http://localhost',
  authorizationServer: issuer,
  allowedOrigins: ['https://gzip.example.test'],
  verify: createIdentityVerifier({
    issuer,
    audience: 'authenticated',
    jwks: createLocalJWKSet({ keys: [jwk] }),
  }),
});
const server = Deno.serve({
  hostname: '127.0.0.1',
  port: 0,
  automaticCompression: false,
  onListen() {},
}, handler);
const endpoint = `http://127.0.0.1:${server.addr.port}/w/${slug}/mcp`;
const headers = {
  Authorization: `Bearer ${bearer}`,
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
  'MCP-Protocol-Version': '2025-11-25',
  Origin: 'https://gzip.example.test',
};
const body = (identifier: string) =>
  JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'get_issue', arguments: { identifier } },
  });
function parse(text: string) {
  const frames = text.split('\n').filter((line) => line.startsWith('data: '));
  const rpc = frames.length
    ? frames.map((line) => JSON.parse(line.slice(6))).find((v) => v.id === 1)
    : JSON.parse(text);
  if (!rpc?.result?.structuredContent || rpc.error || rpc.result.isError) {
    throw new Error('MCP business failure');
  }
  return rpc.result;
}
async function raw(identifier: string, encoding: string) {
  const start = performance.now();
  return await new Promise<{ ms: number; bytes: number; decodedBytes: number; result: unknown }>(
    (resolve, reject) => {
      const req = httpRequest(endpoint, {
        method: 'POST',
        headers: { ...headers, 'Accept-Encoding': encoding },
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => {
          try {
            if (
              res.statusCode !== 200 ||
              res.headers['access-control-allow-origin'] !== headers.Origin
            ) throw new Error('HTTP/CORS failure');
            if (
              (res.headers['content-encoding'] === 'gzip') !== (encoding === 'gzip')
            ) throw new Error('Encoding mismatch');
            const bytes = Buffer.concat(chunks);
            const decoded = encoding === 'gzip' ? gunzipSync(bytes) : bytes;
            resolve({
              ms: performance.now() - start,
              bytes: bytes.length,
              decodedBytes: decoded.length,
              result: parse(decoded.toString()),
            });
          } catch (error) {
            reject(error);
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(30000, () => req.destroy(new Error('Timeout')));
      req.end(body(identifier));
    },
  );
}
try {
  await service.createWorkspace(ctx, { slug, name: 'Disposable gzip benchmark' });
  await service.createTeam(ctx, slug, { key: 'GZ', name: 'Gzip' });
  const normal = await service.createIssue(ctx, slug, { team: 'GZ', title: 'Ordinary response' });
  const large = await service.createIssue(ctx, slug, {
    team: 'GZ',
    title: 'Repeated long document fixture',
  });
  // 164 edits intentionally represent a stress fixture, not a typical user task.
  for (let i = 0; i < 164; i++) {
    await service.updateIssue(ctx, slug, large.identifier, {
      document: {
        lead: `Revision ${i}`,
        sections: [{
          title: 'Details',
          blocks: [0, 1].map((part) => ({
            type: 'paragraph' as const,
            text: `${i}/${part}: ${'Synthetic task description. '.repeat(170)}`,
          })),
        }],
        criteria: [],
      },
    });
  }
  const samples: {
    scenario: string;
    encoding: string;
    ms: number;
    bytes: number;
    decodedBytes: number;
  }[] = [];
  for (const issue of [normal, large]) {
    let reference: string | undefined;
    for (let round = -2; round < 20; round++) {
      for (const encoding of round % 2 ? ['identity', 'gzip'] : ['gzip', 'identity']) {
        const sample = await raw(issue.identifier, encoding);
        const result = JSON.stringify(sample.result);
        if (reference !== undefined && result !== reference) {
          throw new Error('Decoded payload changed');
        }
        reference = result;
        if (round >= 0) {
          samples.push({
            scenario: issue === normal ? 'normal' : 'stress',
            encoding,
            ms: sample.ms,
            bytes: sample.bytes,
            decodedBytes: sample.decodedBytes,
          });
        }
      }
    }
    // Standard fetch client does not need manual gunzip.
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { ...headers, 'Accept-Encoding': 'gzip' },
      body: body(issue.identifier),
    });
    if (JSON.stringify(parse(await response.text())) !== reference) {
      throw new Error('Automatic decompression failed');
    }
  }
  const summary = ['normal', 'stress'].flatMap((scenario) =>
    ['identity', 'gzip'].map((encoding) => {
      const rows = samples.filter((s) => s.scenario === scenario && s.encoding === encoding);
      const sorted = rows.map((s) => s.ms).sort((a, b) => a - b);
      return {
        scenario,
        encoding,
        n: rows.length,
        p50: sorted[9],
        p95: sorted[18],
        bytes: rows[0].bytes,
        decodedBytes: rows[0].decodedBytes,
        requestsPerRead: 1,
      };
    })
  );
  await Deno.writeTextFile(
    output,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        slug,
        mode:
          'loopback TCP, actual MCP handler/service/Postgres, locally signed JWT; NOT hosted OAuth; 2 warmups +20 alternating samples per mode',
        automaticDecompression: true,
        exactPayloadEquality: true,
        summary,
        samples,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await server.shutdown();
  await pool.end();
}
