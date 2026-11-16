// Node fetch inside ego-lite compares routing without changing deployed CORS/config.
// The signed-in bearer is held only in memory and sent only to the same Supabase project.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
const [space, pageLabel, workspace, output] = process.argv.slice(2);
if (!/^\d+$/.test(space) || !/^p\d+$/.test(pageLabel) || !/^perf-[a-z0-9-]+$/.test(workspace)) {
  throw new Error('Usage: node scripts/performance/regions.mjs SPACE PAGE perf-WORKSPACE OUTPUT');
}
const config = {
  space: Number(space),
  pageLabel,
  workspace,
  output: resolve(output),
  source: await readFile(new URL('./probe.mjs', import.meta.url), 'utf8'),
};
const script = `
const config=${
  JSON.stringify(config)
};const task=await taskSpace(config.space);const page=task.page(config.pageLabel);const fs=await import('node:fs/promises');
const project='qietzaqhmforixtpicjd';const base='https://'+project+'.supabase.co/functions/v1/api/api/w/'+config.workspace;
if(new URL(await page.url()).hostname!=='roster-ten-sigma.vercel.app')throw new Error('Use the signed-in Roster production page');
await page.evaluate(config.source);
const identity=await page.evaluate(()=>JSON.parse(localStorage.getItem('sb-qietzaqhmforixtpicjd-auth-token'))?.user?.id);
if(!identity)throw new Error('Sign in first');
async function request(region,path,method='GET',body){
 const session=await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('sb-qietzaqhmforixtpicjd-auth-token'));return {access_token:s?.access_token,user:{id:s?.user?.id}};});
 if(!session?.access_token||session.user?.id!==identity)throw new Error('Session changed');
 const headers={Authorization:'Bearer '+session.access_token,'Content-Type':'application/json',...(region==='auto'?{}:{'x-region':region})};
 const start=performance.now();const response=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});const raw=await response.text();const ms=performance.now()-start;
 const parseStart=performance.now();let data=null;try{data=JSON.parse(raw);}catch{}const parseMs=performance.now()-parseStart;
 return {data,sample:{status:response.status,ms,bytes:Buffer.byteLength(raw),parseMs,sqlCount:null,sqlMs:null,appMs:null,region:response.headers.get('x-sb-edge-region'),errorCode:response.ok?null:(typeof data?.code==='string'?data.code:'http-error')}};
}
const fixture=await request('auto','/issues?team=PERF&limit=100');if(!fixture.data)throw new Error('Fixture request failed');const issues=fixture.data.issues??fixture.data.items;
if(issues.length!==50||issues.some(i=>!/^PERF-([1-9]|[1-4][0-9]|50)$/.test(i.identifier)))throw new Error('Invalid fixture');
await request('auto','/issues/PERF-50','PATCH',{priority:3,status:'todo'});
const samples={auto:[],'eu-west-3':[]};
async function save(){
 const report={schema:1,mode:'real-browser-session-node-fetch',workspace:config.workspace,measuredAt:new Date().toISOString(),plannedCount:20,transport:'Node fetch through ego-lite; identical client for both regions; browser CORS excluded',coldStart:'uncontrolled; first-observed is not cold',samples,summary:{},errors:{}};
 for(const region of Object.keys(samples)){
  report.summary[region]=await page.evaluate(rows=>rosterProbe.summarize(rows),samples[region].filter(s=>s.status>=200&&s.status<300));
  report.errors[region]=samples[region].filter(s=>s.status<200||s.status>=300).length;
 }
 await fs.writeFile(config.output,JSON.stringify(report,null,2));return report;
}
for(let i=0;i<20;i++){
 for(const region of i%2?['eu-west-3','auto']:['auto','eu-west-3']){
  for(const [name,path,method,body] of [['list','/issues?team=PERF&limit=50','GET'],['detail','/issues/PERF-1','GET'],['write','/issues/PERF-50','PATCH',{priority:i%2?3:2}]]){
   const result=await request(region,path,method,body);samples[region].push({scenario:name+'-'+(i?'warm':'first-observed'),...result.sample});await save();
   if(result.sample.status===401)throw new Error('Session expired; partial report retained, no write retry');
  }
 }
 if(i%5===4)console.log({completedPairs:i+1});
}
await request('auto','/issues/PERF-50','PATCH',{priority:3});
const report=await save();console.log({summary:report.summary,errors:report.errors});
`;
const child = spawn('ego-browser', ['nodejs'], { stdio: ['pipe', 'inherit', 'inherit'] });
child.stdin.end(script);
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
