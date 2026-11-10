import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const output=path.resolve(process.env.XDESIGN_PHOTOSHOP_OUTPUT??"/tmp/xdesign-authored-photoshop");
await mkdir(output,{recursive:true});
const reportPath=path.join(output,"report.json");
const manifest=await readFile(path.join(repository,"resources/xdesign-photoshop-corpus.sha256"),"utf8");
const preflight={kind:"Photoshop authored acceptance",createdAt:new Date().toISOString(),corpusCommit:"f5b1178cab15309e05b7b504545df3c701f6d8fd",manifestSha256:createHash("sha256").update(manifest).digest("hex"),status:"not-run",fixtures:manifest.trim().split("\n").length};
try {
  if(!process.env.XDESIGN_PHOTOSHOP_CORPUS)throw new Error("Set XDESIGN_PHOTOSHOP_CORPUS to the pinned photocraft-corpus/photoshop directory. Missing authored files cannot pass acceptance.");
  const root=await realpath(process.env.XDESIGN_PHOTOSHOP_CORPUS);
  for(const line of manifest.trim().split("\n")){
    const [digest,name]=line.split("  ");
    if(!digest||!name||path.isAbsolute(name)||name.split(/[\\/]/).some(part=>part===".."||part==="."))throw new Error("Invalid pinned corpus manifest");
    const filename=await realpath(path.join(root,name));
    if(!filename.startsWith(root+path.sep))throw new Error(`Corpus path escapes its directory: ${name}`);
    const metadata=await stat(filename);if(!metadata.isFile()||metadata.size>512*1024*1024)throw new Error(`Invalid corpus file: ${name}`);
    const hash=createHash("sha256");for await(const chunk of createReadStream(filename))hash.update(chunk);
    if(hash.digest("hex")!==digest)throw new Error(`Corpus checksum mismatch: ${name}`);
  }
  await writeFile(reportPath,JSON.stringify({...preflight,status:"running"},null,2));
  const log=createWriteStream(path.join(output,"native.log"));
  const child=spawn("cargo",["test","--locked","--offline","--lib","xdesign_photoshop_authored_acceptance","--","--ignored","--nocapture"],{cwd:path.join(repository,"src-tauri"),env:{...process.env,XDESIGN_PHOTOSHOP_CORPUS:root,XDESIGN_PHOTOSHOP_REPORT:reportPath},stdio:["ignore","pipe","pipe"]});
  for(const stream of [child.stdout,child.stderr])stream.on("data",data=>{log.write(data);process.stdout.write(data);});
  const code=await new Promise((resolve,reject)=>{child.on("error",reject);child.on("close",resolve);});log.end();
  const report=JSON.parse(await readFile(reportPath,"utf8"));
  const complete=Array.isArray(report.cases)&&report.cases.length===preflight.fixtures;
  const passed=code===0&&complete&&report.cases.every(record=>record.status==="passed");
  await writeFile(reportPath,JSON.stringify({...report,createdAt:preflight.createdAt,status:passed?"passed":"failed",complete,processExitCode:code},null,2));
  process.exitCode=passed?0:1;
}catch(error){await writeFile(reportPath,JSON.stringify({...preflight,error:String(error)},null,2));console.error(String(error));process.exitCode=1;}
console.log(`Authored Photoshop report: ${reportPath}`);
