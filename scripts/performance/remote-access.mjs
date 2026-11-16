import { sourceManifest } from './source.mjs';
// External permission changes use normal app services. Deletion is explicitly a local fixture operation.
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
  root: process.cwd(),
  probe: await readFile(new URL('./ui-probe.mjs', import.meta.url), 'utf8'),
};
const script = `
const c=${
  JSON.stringify(c)
};const task=await taskSpace(c.space);const p=task.page(c.label);const fs=await import('node:fs/promises');const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');const run=promisify(execFile);
const url=new URL(await p.url());if(url.hostname!=='127.0.0.1')throw Error('Local preview only');
const env=await fs.readFile(c.root+'/.env.worktree','utf8');const database=/^DATABASE_URL=(.+)$/m.exec(env)?.[1];if(!database)throw Error('No worktree database');
const action=async(name,slug='perf-access')=>{const result=await run('node',['scripts/toolchain.mjs','deno','run','--allow-env','--allow-net','--allow-read','scripts/performance/access.ts',name,slug],{cwd:c.root,env:{...process.env,DATABASE_URL:database}});return JSON.parse(result.stdout.trim());};
const report={schema:1,source:c.source,measuredAt:new Date().toISOString(),observations:[]};
async function save(name,mutation){const state=await p.evaluate(()=>({at:Date.now(),titlePresent:document.querySelector('h1')?.textContent==='Permission fixture issue',visibility:document.visibilityState,online:navigator.onLine,requests:rosterUiProbe.capture()}));report.observations.push({name,mutation,...state,observedDelayMs:Date.now()-Date.parse(mutation.at)});await fs.writeFile(c.output,JSON.stringify(report,null,2));console.log({name,observedDelayMs:report.observations.at(-1).observedDelayMs,titlePresent:state.titlePresent,requests:state.requests.length});await p.evaluate(()=>rosterUiProbe.start());}
async function open(slug){await p.goto(new URL('/'+slug+'/issue/PERF-1',url).href);await p.waitForFunction(()=>document.querySelector('h1')?.textContent==='Permission fixture issue',undefined,{timeout:15000});await p.evaluate(c.probe);}
await action('setup');await open('perf-access');
try{
 let changed=await action('private');await p.waitForFunction(()=>!document.querySelector('h1')&&document.body.textContent.includes('not found'),undefined,{timeout:35000});await save('private-team-hidden',changed);
 changed=await action('public');await p.waitForFunction(()=>document.querySelector('h1')?.textContent==='Permission fixture issue',undefined,{timeout:65000});await save('team-visibility-restored',changed);
 await p.evaluate(()=>rosterUiProbe.start());changed=await action('suspend');await p.waitForFunction(()=>!document.querySelector('h1')&&document.body.textContent.includes('Workspace access denied'),undefined,{timeout:35000});await save('membership-suspended',changed);
 changed=await action('restore');await p.waitForFunction(()=>document.querySelector('h1')?.textContent==='Permission fixture issue',undefined,{timeout:65000});await save('membership-restored',changed);
}finally{await action('public');await action('restore');}
const deletion='perf-deletion-'+Date.now();await action('setup',deletion);await open(deletion);
const changed=await action('delete-fixture',deletion);await p.waitForFunction(()=>!document.querySelector('h1')&&document.body.textContent.includes('not found'),undefined,{timeout:35000});await save('deleted-fixture-disappeared',changed);
console.log(await p.snapshot());
`;
const child = spawn('ego-browser', ['nodejs'], { stdio: ['pipe', 'inherit', 'inherit'] });
child.stdin.end(script);
child.on('exit', (code) => process.exitCode = code ?? 1);
