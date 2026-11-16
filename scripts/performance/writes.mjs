// Real ego-lite clicks with browser network latency; only isolated local PERF fixtures are writable.
import { readFile } from 'node:fs/promises';
import { sourceManifest } from './source.mjs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
const [space, page, workspace, api, output, field = 'priority', count = '20'] = process.argv.slice(
  2,
);
if (
  !/^\d+$/.test(space) || !/^p\d+$/.test(page) || !/^perf-[a-z0-9-]+$/.test(workspace) ||
  !['127.0.0.1', 'localhost'].includes(new URL(api).hostname) ||
  !['status', 'priority'].includes(field) || !Number.isInteger(+count) || +count < 2 || +count > 100
) {
  throw new Error(
    'Usage: writes.mjs SPACE PAGE perf-WORKSPACE LOOPBACK_API OUTPUT [priority|status] [COUNT]',
  );
}
const config = {
  sourceManifest: await sourceManifest(),
  space: +space,
  page,
  workspace,
  api,
  output: resolve(output),
  field,
  count: +count,
  source: await readFile(new URL('./ui-probe.mjs', import.meta.url), 'utf8'),
};
const script = `
const c=${
  JSON.stringify(config)
};const p=(await taskSpace(c.space)).page(c.page);const fs=await import('node:fs/promises');
const endpoint=c.api+'/api/w/'+c.workspace+'/issues/PERF-50';const originalResponse=await fetch(endpoint);if(!originalResponse.ok)throw new Error('Fixture unavailable');const original=await originalResponse.json();
await p.goto(new URL('/'+c.workspace+'/issue/PERF-50',await p.url()).href);await p.waitForFunction(()=>document.querySelector('h1')?.textContent==='Performance fixture 50');await p.evaluate(c.source);
await p.cdp('Network.enable');await p.cdp('Network.emulateNetworkConditions',{offline:false,latency:300,downloadThroughput:-1,uploadThroughput:-1});
const samples=[];
try {
 for(let i=0;i<c.count;i++) {
  const label=c.field==='priority'?(i%2?'Low':'High'):(i%2?'Todo':'In progress');
  const value=c.field==='priority'?(i%2?4:2):(i%2?'todo':'in_progress');
  const selector='button[aria-label="Change '+c.field+' for PERF-50"]';
  await p.click(selector);
  await p.evaluate(({selector,label,field})=>rosterUiProbe.arm(field+'-feedback',selector,label,'[role="option"]'),{selector,label,field:c.field});
  await p.click('loc=role:listboxoption[name="'+label+'"]');
  await p.waitForFunction(()=>rosterUiProbe.result!==null,undefined,{timeout:30000});
  const feedback=await p.evaluate(()=>rosterUiProbe.result);
  await p.waitForFunction(()=>rosterUiProbe.idleFor(200),undefined,{timeout:30000});
  const requests=await p.evaluate(()=>rosterUiProbe.capture());
  const response=await fetch(endpoint);if(!response.ok)throw new Error('Readback failed');const saved=await response.json();if(saved[c.field]!==value)throw new Error('Saved value mismatch');
  samples.push({...feedback,requests,confirmedMs:requests.find(r=>r.method==='PATCH')?.endMs,serverValue:saved[c.field]});
 }
 const environment=await p.evaluate(()=>({browser:navigator.userAgent,origin:location.origin,visibility:document.visibilityState,online:navigator.onLine}));
 await fs.writeFile(c.output,JSON.stringify({schema:1,workspace:c.workspace,identifier:'PERF-50',field:c.field,latencyMs:300,count:c.count,measuredAt:new Date().toISOString(),environment,method:'DOM feedback plus completed request window; Node readback outside measured window',sourceManifest:c.sourceManifest,samples},null,2));
 console.log({field:c.field,samples:samples.length,requests:samples.reduce((n,s)=>n+s.requests.length,0),output:c.output});
} finally {
 await p.cdp('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
 const response=await fetch(endpoint+(c.field==='status'?'/status':''),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({[c.field]:original[c.field]})});if(!response.ok)throw new Error('Fixture restore failed');
}
`;
const child = spawn('ego-browser', ['nodejs'], { stdio: ['pipe', 'inherit', 'inherit'] });
child.stdin.end(script);
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
