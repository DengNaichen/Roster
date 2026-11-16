// Read-only payload accounting for the isolated local fixture; no body is written.
import { writeFile } from 'node:fs/promises';
const [base, workspace, output] = process.argv.slice(2);
if (
  !['127.0.0.1', 'localhost'].includes(new URL(base).hostname) ||
  !/^perf-[a-z0-9-]+$/.test(workspace)
) throw new Error('Use a loopback perf-* workspace');
const response = await fetch(`${base}/api/w/${workspace}/issues?team=PERF&limit=50`);
if (!response.ok) throw new Error(`Business request failed (${response.status})`);
const text = await response.text();
const data = JSON.parse(text);
const items = data.items ?? data.issues;
const bytes = (value) => Buffer.byteLength(JSON.stringify(value));
const report = {
  schema: 1,
  mode: 'local-preview-fixed-identity',
  workspace,
  rows: items.length,
  totalBytes: Buffer.byteLength(text),
  duplicatedItemsEqual: data.items && data.issues
    ? JSON.stringify(data.items) === JSON.stringify(data.issues)
    : false,
  itemsBytes: bytes(items),
  documentBytes: items.reduce((sum, item) => sum + (item.document ? bytes(item.document) : 0), 0),
  listHasDocuments: items.some((item) => 'document' in item),
};
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
