import { sourceManifest } from './source.mjs';
// Exercise real browser visibility/network lifecycle. Reuses a caller-owned ego-lite space.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
const [space, label, output] = process.argv.slice(2);
if (!/^\d+$/.test(space) || !/^p\d+$/.test(label) || !output) throw Error('SPACE PAGE OUTPUT');
const c = {
  source: await sourceManifest(),
  space: +space,
  label,
  output: resolve(output),
  probe: await readFile(new URL('./ui-probe.mjs', import.meta.url), 'utf8'),
};
const script = `
const c=${
  JSON.stringify(c)
};const task=await taskSpace(c.space);const p=task.page(c.label);const fs=await import('node:fs/promises');
const url=new URL(await p.url());if(url.hostname!=='127.0.0.1')throw Error('Local preview only');
const workspace='perf-baseline-v2';const base=new URL('/'+workspace+'/issue/PERF-1',url).href;
await p.goto(base);await p.waitForFunction(()=>document.querySelector('[aria-label="Change priority for PERF-1"]')?.textContent.includes('Medium'));
const endpoint=await p.evaluate(()=>import('/src/integration/api.ts').then(m=>m.mcpServerUrl('perf-baseline-v2')));
async function update(priority){const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'update_issue',arguments:{identifier:'PERF-1',priority}}}),signal:AbortSignal.timeout(30000)});const t=await r.text();const frames=r.headers.get('content-type')?.includes('text/event-stream')?t.split('\\n').filter(l=>l.startsWith('data:')).map(l=>JSON.parse(l.slice(5))):[JSON.parse(t)];if(!r.ok||frames.find(f=>f.id===1)?.result?.structuredContent?.result?.priority!==priority)throw Error('MCP failed');return Date.now();}
const report={schema:1,source:c.source,measuredAt:new Date().toISOString(),mode:'real ego-lite local preview; MCP writes through normal transport',observations:[]};
async function save(name,extra={}){const state=await p.evaluate(()=>({at:Date.now(),visibility:document.visibilityState,online:navigator.onLine,requests:rosterUiProbe.capture()}));report.observations.push({name,...extra,...state});await fs.writeFile(c.output,JSON.stringify(report,null,2));console.log({name,...extra,visibility:state.visibility,online:state.online,requests:state.requests.length});}
await p.evaluate(c.probe);await p.evaluate(()=>rosterUiProbe.start());
await new Promise(r=>setTimeout(r,32000));await save('unchanged-visible-32s');
await p.evaluate(()=>{rosterUiProbe.start();window.hiddenInterval=null;let hiddenAt=null;const visibility=()=>{if(document.visibilityState==='hidden'){hiddenAt=Date.now();rosterUiProbe.start();}else if(hiddenAt){window.hiddenInterval={hiddenAt,visibleAt:Date.now(),requests:rosterUiProbe.capture()};document.removeEventListener('visibilitychange',visibility);}};document.addEventListener('visibilitychange',visibility);});
const blank=(await task.pages()).find(page=>page.label!==c.label)??await task.newPage();await blank.goto('about:blank');await blank.cdp('Page.bringToFront');
// Any Page operation activates that page in ego-lite. Leave p1 completely untouched while hidden.
const hiddenAck=await update(2);await new Promise(r=>setTimeout(r,32000));
const focusedAt=Date.now();await p.cdp('Page.bringToFront');
const hidden=await p.evaluate(()=>window.hiddenInterval);if(!hidden||hidden.visibleAt-hidden.hiddenAt<31000)throw Error('No real hidden interval');report.observations.push({name:'hidden-32s',acknowledgedAt:hiddenAck,...hidden});await fs.writeFile(c.output,JSON.stringify(report,null,2));console.log({name:'hidden-32s',requests:hidden.requests.length,hiddenMs:hidden.visibleAt-hidden.hiddenAt});await p.waitForFunction(()=>document.querySelector('[aria-label="Change priority for PERF-1"]')?.textContent.includes('High'),undefined,{timeout:5000});await save('focus-catch-up',{focusedAt,observedDelayMs:Date.now()-focusedAt});
await p.cdp('Network.enable');await p.cdp('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1});
await p.waitForFunction(()=>!navigator.onLine);await p.evaluate(()=>rosterUiProbe.start());
const offlineAck=await update(3);await new Promise(r=>setTimeout(r,17000));await save('offline-17s',{acknowledgedAt:offlineAck});
const onlineAt=Date.now();await p.cdp('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
await p.waitForFunction(()=>navigator.onLine&&document.querySelector('[aria-label="Change priority for PERF-1"]')?.textContent.includes('Medium'),undefined,{timeout:5000});await save('reconnect-catch-up',{onlineAt,observedDelayMs:Date.now()-onlineAt});
await p.evaluate(()=>rosterUiProbe.start());await p.cdp('Network.setBlockedURLs',{urls:['*://127.0.0.1:*/api/w/perf-baseline-v2/*']});
try{await p.waitForFunction(()=>document.querySelector('[role="alert"]')?.textContent.includes('Could not refresh'),undefined,{timeout:20000});await save('blocked-url-error');
await p.waitForFunction(()=>rosterUiProbe.capture().filter(r=>r.status===0).length>=12,undefined,{timeout:40000});await save('blocked-url-backoff');
}finally{await p.cdp('Network.setBlockedURLs',{urls:[]});}
await blank.cdp('Page.bringToFront');const recoveryAt=Date.now();await p.cdp('Page.bringToFront');
await p.waitForFunction(()=>![...document.querySelectorAll('[role="alert"]')].some(e=>e.textContent.includes('Could not refresh')),undefined,{timeout:5000});await save('network-failure-recovered',{observedDelayMs:Date.now()-recoveryAt});
`;
const child = spawn('ego-browser', ['nodejs'], { stdio: ['pipe', 'inherit', 'inherit'] });
child.stdin.end(script);
child.on('exit', (code) => process.exitCode = code ?? 1);
