import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
const output=process.env.XDESIGN_FIDELITY_OUTPUT??"/tmp/xdesign-authored-fidelity";
await mkdir(output,{recursive:true});
const cases=[];
for(const name of ["slots","variable-override-precedence","circle-text","gold-preview","material3","nuxtui"]){
  console.log(`Checking authored ${name}.fig`);
  await rm(`${output}/${name}.json`,{force:true});
  const child=spawn(process.execPath,["node_modules/vitest/vitest.mjs","run","--config","scripts/xdesign-fidelity.config.ts"],{env:{...process.env,XDESIGN_FIDELITY_CASE:name,XDESIGN_FIDELITY_OUTPUT:output},stdio:["ignore","pipe","pipe"],detached:true});
  let log="",timedOut=false;for(const stream of [child.stdout,child.stderr])stream.on("data",data=>{if(log.length<64*1024)log+=data.toString();});
  const timer=setTimeout(()=>{timedOut=true;try{process.kill(-child.pid,"SIGKILL");}catch{}},120000);
  const code=await new Promise(resolve=>{child.on("error",()=>resolve(1));child.on("close",resolve);});clearTimeout(timer);
  let record;try{record=JSON.parse(await readFile(`${output}/${name}.json`,"utf8"));}catch{record={name,status:"failed",error:"No fixture report was produced"};}
  if(timedOut){record.status="failed";record.error=`Acceptance exceeded its 120-second process limit at ${record.stage??"fixture setup"}`;}
  if(code!==0&&record.status==="passed"){record.status="failed";record.error="The fixture process failed after its assertions";}
  cases.push(record);await writeFile(`${output}/${name}.log`,log);console.log(`${name}: ${record.status}${record.error?` · ${record.error}`:""}`);
}
await writeFile(`${output}/report.json`,JSON.stringify({kind:"Orion import, project persistence and re-export consistency; not a Figma screenshot oracle",fixtureDirectory:process.env.XDESIGN_OPEN_PENCIL_FIXTURES,createdAt:new Date().toISOString(),cases},null,2));
if(cases.some(record=>record.status!=="passed"))process.exitCode=1;
