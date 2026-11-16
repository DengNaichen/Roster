// Reuse one existing ego-lite TaskSpace. No browser engine other than ego-lite is launched.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
const [space, pageLabel, workspace, output, count = '20'] = process.argv.slice(2);
if (
  !/^\d+$/.test(space) || !/^p\d+$/.test(pageLabel) || !/^perf-[a-z0-9-]+$/.test(workspace) ||
  !Number.isInteger(Number(count)) || Number(count) < 1 || Number(count) > 100
) {
  throw new Error(
    'Usage: node scripts/performance/roundtrip.mjs SPACE PAGE perf-WORKSPACE OUTPUT [COUNT]',
  );
}
const source = await readFile(new URL('./ui-probe.mjs', import.meta.url), 'utf8');
const config = {
  space: Number(space),
  pageLabel,
  workspace,
  output: resolve(output),
  count: Number(count),
  source,
};
const script = `
const config=${JSON.stringify(config)};
const task=await taskSpace(config.space);const page=task.page(config.pageLabel);const fs=await import('node:fs/promises');
await page.goto(new URL('/'+config.workspace,await page.url()).href);
await page.waitForFunction(workspace=>!!document.querySelector('a[href="/'+workspace+'/issue/PERF-1"]'),config.workspace,{timeout:30000});
await page.evaluate(config.source);
const samples=[];
for(let i=0;i<config.count;i++){
 await page.evaluate(w=>rosterUiProbe.arm('list-to-detail','h1','Performance fixture 1','a[href="/'+w+'/issue/PERF-1"]'),config.workspace);
 await page.click('loc=href:/'+config.workspace+'/issue/PERF-1 >> nth=0');
 await page.waitForFunction(()=>rosterUiProbe.result!==null,undefined,{timeout:40000});
 samples.push(await page.evaluate(()=>rosterUiProbe.result));
 await page.evaluate(w=>rosterUiProbe.arm('detail-to-list','[aria-label="Select PERF-50"]','','a[href="/'+w+'/"]'),config.workspace);
 await page.click('loc=href:/'+config.workspace+'/');
 await page.waitForFunction(()=>rosterUiProbe.result!==null,undefined,{timeout:40000});
 samples.push(await page.evaluate(()=>rosterUiProbe.result));
}
const environment=await page.evaluate(()=>({browser:navigator.userAgent,origin:location.origin,visibility:document.visibilityState,online:navigator.onLine}));
await fs.writeFile(config.output,JSON.stringify({schema:2,workspace:config.workspace,method:'input event to DOM match and two animation frames',measuredAt:new Date().toISOString(),environment,samples},null,2));
console.log(samples.map(s=>({scenario:s.scenario,matchedMs:s.matchedMs,paintedMs:s.ms,requests:s.requests?.length,pendingAtMatch:s.pendingAtMatch})));
`;
const child = spawn('ego-browser', ['nodejs'], { stdio: ['pipe', 'inherit', 'inherit'] });
child.stdin.end(script);
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
