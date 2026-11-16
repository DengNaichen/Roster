import { sourceManifest } from './source.mjs';
// Compare full and conditional business GETs on the same unchanged data in ego-lite.
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
const [space, label, workspace, output] = process.argv.slice(2);
if (
  !/^\d+$/.test(space) || !/^p\d+$/.test(label) || !/^perf-[a-z0-9-]+$/.test(workspace) || !output
) throw Error('SPACE PAGE perf-WORKSPACE OUTPUT');
const c = {
  source: await sourceManifest(),
  space: +space,
  label,
  workspace,
  output: resolve(output),
};
const script = `
const c=${
  JSON.stringify(c)
};const t=await taskSpace(c.space);const p=t.page(c.label);const fs=await import('node:fs/promises');
const url=new URL(await p.url());if(url.hostname!=='127.0.0.1')throw Error('Local preview only');
await p.goto(new URL('/'+c.workspace+'/issue/PERF-1',url).href);await p.waitForFunction(()=>document.querySelector('h1'));
const result=await p.evaluate(async workspace=>{
 const {apiFetch}=await import('/src/integration/api.ts');const rows=[];
 for(const resource of ['issues?team=PERF&limit=50','issues/PERF-1']){
  const path='/api/w/'+workspace+'/'+resource;
  const initial=await apiFetch(path,{cache:'no-store',signal:AbortSignal.timeout(30000)});const tag=initial.headers.get('ETag');const original=await initial.text();
  if(initial.status!==200||!tag)throw Error('Expected authenticated business result with validator');
  for(let i=0;i<20;i++)for(const conditional of i%2?[true,false]:[false,true]){
   const start=performance.now();const response=await apiFetch(path,{cache:'no-store',headers:conditional?{'If-None-Match':tag}:{},signal:AbortSignal.timeout(30000)});const body=await response.text();
   if(response.headers.get('ETag')!==tag||response.status!==(conditional?304:200)||body!==(conditional?'':original))throw Error('Data changed or conditional read failed');
   rows.push({resource:resource.includes('?')?'list':'detail',conditional,status:response.status,ms:performance.now()-start,bytes:new TextEncoder().encode(body).length,sqlCount:Number(response.headers.get('X-Roster-Sql-Count'))});
  }
 }
 return{schema:1,measuredAt:new Date().toISOString(),method:'alternating order; 20 full and 20 conditional GETs per resource; exact body and validator equality; local ego-lite',rows};
},c.workspace);await fs.writeFile(c.output,JSON.stringify({...result,source:c.source},null,2));console.log({samples:result.rows.length,allExpectedStatusAndBody:true});
`;
const child = spawn('ego-browser', ['nodejs'], { stdio: ['pipe', 'inherit', 'inherit'] });
child.stdin.end(script);
child.on('exit', (code) => process.exitCode = code ?? 1);
