import { sourceManifest } from './source.mjs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
const [space, label, output] = process.argv.slice(2);
if (!/^\d+$/.test(space) || !/^p\d+$/.test(label) || !output) throw Error('SPACE PAGE OUTPUT');
const c = {
  space: +space,
  label,
  output: resolve(output),
  source: await sourceManifest(),
  probe: await readFile(new URL('./ui-probe.mjs', import.meta.url), 'utf8'),
};
const script = `
const c=${
  JSON.stringify(c)
};const task=await taskSpace(c.space);const p=task.page(c.label);const fs=await import('node:fs/promises');
const url=new URL(await p.url());if(url.hostname!=='127.0.0.1')throw Error('Local preview only');const slug='perf-baseline-v2';
const endpoint=await p.evaluate(slug=>import('/src/integration/api.ts').then(m=>m.mcpServerUrl(slug)),slug);
async function mcp(name,args){const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}),signal:AbortSignal.timeout(30000)});const text=await r.text();const frames=r.headers.get('content-type')?.includes('text/event-stream')?text.split('\\n').filter(l=>l.startsWith('data:')).map(l=>JSON.parse(l.slice(5))):[JSON.parse(text)];const reply=frames.find(f=>f.id===1);if(!r.ok||reply?.error||reply?.result?.isError||!reply?.result?.structuredContent?.result)throw Error('MCP failure');return{status:r.status,acknowledgedAt:Date.now()};}
const report={schema:1,source:c.source,measuredAt:new Date().toISOString(),observations:[]};async function save(name,ack,extra={}){const data=await p.evaluate(()=>({observedAt:Date.now(),requests:rosterUiProbe.capture(),visibility:document.visibilityState,online:navigator.onLine}));report.observations.push({name,...ack,...data,observedDelayMs:data.observedAt-ack.acknowledgedAt,...extra});await fs.writeFile(c.output,JSON.stringify(report,null,2));console.log({name,observedDelayMs:data.observedAt-ack.acknowledgedAt,...extra});}
await p.goto(new URL('/'+slug+'/issue/PERF-1',url).href);await p.waitForFunction(()=>document.querySelector('[aria-label="Comment"]'),undefined,{timeout:15000});console.log(await p.snapshot({scope:'full_page'}));
await p.fill('loc=css:[aria-label="Comment"]','Local draft survives remote work log');await p.click('loc=role:tab[name*="Agent work logs"]');
await p.evaluate(c.probe);await p.evaluate(()=>rosterUiProbe.start());
const summary='RST-7 remote log '+Date.now();let ack=await mcp('add_work_log',{identifier:'PERF-1',kind:'progress',summary,body:'Synthetic log used to verify remote refresh. No business data.'});
await p.waitForFunction(summary=>[...document.querySelectorAll('.work-log-list button')].some(b=>b.textContent.includes(summary)),summary,{timeout:35000});await save('new-mcp-log-in-open-panel',ack);
await p.click('loc=role:tab[name*="Comments"]');const kept=await p.evaluate(()=>document.querySelector('[aria-label="Comment"]').value==='Local draft survives remote work log');if(!kept)throw Error('Draft lost');report.draftPreserved=kept;await p.fill('loc=css:[aria-label="Comment"]','');
await mcp('update_issue',{identifier:'PERF-50',status:'todo'});await p.goto(new URL('/'+slug+'/team/PERF/triage',url).href);await p.waitForFunction(()=>!document.body.textContent.includes('Loading…'));await p.evaluate(c.probe);
try{await p.evaluate(()=>rosterUiProbe.start());ack=await mcp('update_issue',{identifier:'PERF-50',status:'triage'});await p.waitForFunction(()=>document.querySelector('[aria-label="Select PERF-50"]'),undefined,{timeout:35000});await save('mcp-task-enters-triage',ack);
await p.evaluate(()=>rosterUiProbe.start());ack=await mcp('update_issue',{identifier:'PERF-50',status:'todo'});await p.waitForFunction(()=>!document.querySelector('[aria-label="Select PERF-50"]'),undefined,{timeout:35000});await save('mcp-task-leaves-triage',ack);
}finally{await mcp('update_issue',{identifier:'PERF-50',status:'todo'});}
await fs.writeFile(c.output,JSON.stringify(report,null,2));console.log(await p.snapshot());
`;
const child = spawn('ego-browser', ['nodejs'], { stdio: ['pipe', 'inherit', 'inherit'] });
child.stdin.end(script);
child.on('exit', (code) => process.exitCode = code ?? 1);
