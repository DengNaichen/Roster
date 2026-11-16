import { sourceManifest } from './source.mjs';
// Real local MCP -> an already-open ego-lite page. No tokens, bodies or SQL are exported.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
const [space, label, workspace, output, count = '5', timeout = '30000'] = process.argv.slice(2);
if (
  !/^\d+$/.test(space) || !/^p\d+$/.test(label) || !/^perf-[a-z0-9-]+$/.test(workspace) ||
  !Number.isInteger(+count) || +count < 1 || +count > 20 || !Number.isInteger(+timeout) ||
  +timeout < 1000 || +timeout > 60000
) throw Error('SPACE PAGE perf-WORKSPACE OUTPUT [COUNT] [TIMEOUT_MS]');
const config = {
  source: await sourceManifest(),
  space: +space,
  label,
  workspace,
  output: resolve(output),
  count: +count,
  timeout: +timeout,
  probe: await readFile(new URL('./ui-probe.mjs', import.meta.url), 'utf8'),
};
const script = `
const c=${
  JSON.stringify(config)
};const task=await taskSpace(c.space);const p=task.page(c.label);const fs=await import('node:fs/promises');
const url=new URL(await p.url());if(!['127.0.0.1','localhost'].includes(url.hostname))throw Error('Local preview only');
const apiModule=await p.evaluate(workspace=>import('/src/integration/api.ts').then(m=>m.mcpServerUrl(workspace)),c.workspace);
const endpoint=new URL(apiModule);if(endpoint.hostname!=='127.0.0.1'||!endpoint.pathname.startsWith('/w/'+c.workspace+'/'))throw Error('Wrong workspace');
async function update(priority){
 const started=performance.now();const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'update_issue',arguments:{identifier:'PERF-1',priority}}}),signal:AbortSignal.timeout(30000)});
 const body=await r.text();const frames=r.headers.get('content-type')?.includes('text/event-stream')?body.split('\\n').filter(l=>l.startsWith('data:')).map(l=>JSON.parse(l.slice(5))):[JSON.parse(body)];const reply=frames.find(f=>f.id===1);const result=reply?.result?.structuredContent?.result;
 if(!r.ok||reply?.error||reply?.result?.isError||result?.priority!==priority)throw Error('MCP update failed');
 return {status:r.status,ms:performance.now()-started,acknowledgedAt:Date.now()};
}
await update(3);
await p.goto(new URL('/'+c.workspace+'/issue/PERF-1',url).href);
await p.waitForFunction(()=>document.querySelector('[aria-label="Change priority for PERF-1"]')?.textContent.includes('Medium'),undefined,{timeout:15000});
await p.evaluate(c.probe);
const samples=[];
try{for(let i=0;i<c.count;i++){
 const priority=i%2?3:2;const expected=priority===2?'High':'Medium';
 await p.evaluate(expected=>{window.remoteSeen=null;window.remoteObserver?.disconnect();rosterUiProbe.start();const observer=new MutationObserver(()=>{if(document.querySelector('[aria-label="Change priority for PERF-1"]')?.textContent.includes(expected)){window.remoteSeen=Date.now();observer.disconnect();}});window.remoteObserver=observer;observer.observe(document,{subtree:true,childList:true,characterData:true});},expected);
 const result=await update(priority);
 let timeout=false;try{await p.waitForFunction(()=>window.remoteSeen!==null,undefined,{timeout:c.timeout});}catch(e){if(!/timeout|timed out/i.test(String(e)))throw e;timeout=true;}
 const observation=await p.evaluate(()=>({seenAt:window.remoteSeen,observedAt:Date.now(),visibility:document.visibilityState,online:navigator.onLine,requests:rosterUiProbe.capture()}));
 samples.push({...result,priority,timeout,...observation,visibilityMs:observation.seenAt===null?null:observation.seenAt-result.acknowledgedAt});
 if(timeout)break;
}}finally{await update(3);await p.evaluate(()=>window.remoteObserver?.disconnect());}
await fs.writeFile(c.output,JSON.stringify({schema:1,source:c.source,method:'real local MCP acknowledgement to DOM MutationObserver; no navigation/focus between samples',measuredAt:new Date().toISOString(),workspace:c.workspace,samples},null,2));console.log(samples.map(({requests,...s})=>({...s,requests:requests.length})));
`;
const child = spawn('ego-browser', ['nodejs'], { stdio: ['pipe', 'inherit', 'inherit'] });
child.stdin.end(script);
child.on('exit', (code) => process.exitCode = code ?? 1);
