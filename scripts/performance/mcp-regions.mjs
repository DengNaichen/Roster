import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
const [space, pageLabel, workspace, output] = process.argv.slice(2);
if (!/^\d+$/.test(space) || !/^p\d+$/.test(pageLabel) || !/^perf-[a-z0-9-]+$/.test(workspace)) {
  throw new Error(
    'Usage: node scripts/performance/mcp-regions.mjs SPACE PAGE perf-WORKSPACE OUTPUT',
  );
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
if(new URL(await page.url()).hostname!=='roster-ten-sigma.vercel.app')throw new Error('Use the signed-in Roster production page');
await page.evaluate(config.source);
const identity=await page.evaluate(()=>JSON.parse(localStorage.getItem('sb-qietzaqhmforixtpicjd-auth-token'))?.user?.id);
if(!identity)throw new Error('Sign in first');
const samples={auto:[],'eu-west-3':[]};
const url='https://qietzaqhmforixtpicjd.supabase.co/functions/v1/mcp/w/'+config.workspace+'/mcp';
async function call(region,name,args){
 const session=await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('sb-qietzaqhmforixtpicjd-auth-token'));return {access_token:s?.access_token,subject:s?.user?.id};});
 if(!session.access_token||session.subject!==identity)throw new Error('Session changed');
 const start=performance.now();const response=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/json',Accept:'application/json, text/event-stream',...(region==='auto'?{}:{'x-region':region})},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}),signal:AbortSignal.timeout(30000)});
 const raw=await response.text();const ms=performance.now()-start;const begin=performance.now();let payload=null;
 try{payload=JSON.parse(response.headers.get('content-type')?.includes('text/event-stream')?raw.split(String.fromCharCode(10)).find(line=>line.startsWith('data:')).slice(5):raw);}catch{}
 const result=payload?.result?.structuredContent?.result;
 const success=response.ok&&!payload?.result?.isError&&!!payload?.result;
 if(success&&name==='update_issue'&&(result?.identifier!==args.identifier||result?.priority!==args.priority))throw new Error('MCP update result differs');
 return {status:success?200:(response.ok?500:response.status),ms,bytes:Buffer.byteLength(raw),parseMs:performance.now()-begin,region:response.headers.get('x-sb-edge-region'),sqlCount:null,sqlMs:null,appMs:null};
}
async function save(){const report={schema:1,mode:'hosted-mcp-real-browser-session-node-fetch',workspace:config.workspace,measuredAt:new Date().toISOString(),plannedCount:10,coldStart:'uncontrolled; first-observed is not cold',samples,summary:{},errors:{}};for(const region of Object.keys(samples)){report.summary[region]=await page.evaluate(rows=>rosterProbe.summarize(rows),samples[region].filter(s=>s.status===200));report.errors[region]=samples[region].filter(s=>s.status!==200).length;}await fs.writeFile(config.output,JSON.stringify(report,null,2));return report;}
for(let i=0;i<10;i++){
 for(const region of i%2?['eu-west-3','auto']:['auto','eu-west-3']){
  for(const [scenario,name,args] of [['list','list_issues',{team:'PERF',limit:50}],['detail','get_issue',{identifier:'PERF-1'}],['write','update_issue',{identifier:'PERF-50',priority:i%2?3:2}]]){
   const sample=await call(region,name,args);samples[region].push({scenario:scenario+'-'+(i?'warm':'first-observed'),...sample});await save();if(sample.status===401)throw new Error('Session expired; partial report retained');
  }
 }
 if(i%5===4)console.log({completedPairs:i+1});
}
await call('auto','update_issue',{identifier:'PERF-50',priority:3});const report=await save();console.log({summary:report.summary,errors:report.errors});
`;
const child = spawn('ego-browser', ['nodejs'], { stdio: ['pipe', 'inherit', 'inherit'] });
child.stdin.end(script);
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
