import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Worker } from "node:worker_threads";
import { SceneGraph } from "@open-pencil/scene-graph";
import { bundleXDesignScriptWorker } from "./xdesign-script-worker.mjs";
import { build } from "esbuild";
import { parse } from "acorn";
import path from "node:path";
import { readdir } from "node:fs/promises";
import { packageForModule } from "./frontend-licenses.mjs";

const output=process.env.XDESIGN_SCRIPT_OUTPUT??"/tmp/xdesign-script-worker";
await mkdir(output,{recursive:true});
const bundle=await bundleXDesignScriptWorker(),source=bundle.source;
assert.ok(!Object.keys(bundle.metafile.inputs).some(file=>/src\/apps\/xdesign\/(pencil\/(runtime|toolExecution|slots|document)\.ts|store\.ts)|node_modules\/ulid\//.test(file)),"The worker must not import host runtime, editor actions or persistence");
await writeFile(`${output}/script-worker.js`,source);
const hashes={};for(const file of Object.keys(bundle.metafile.inputs).filter(file=>!file.startsWith("<")))hashes[file]=createHash("sha256").update(await readFile(file)).digest("hex");
const documentBundle=await build({stdin:{contents:'export {serializeGraph,deserializeGraph} from "./src/apps/xdesign/pencil/graphDocument.ts"',resolveDir:process.cwd()},bundle:true,write:false,format:"esm",platform:"node",logLevel:"silent"});
const {serializeGraph,deserializeGraph}=await import(`data:text/javascript;base64,${Buffer.from(documentBundle.outputFiles[0].text).toString("base64")}`);
const harness=`const{parentPort,workerData}=require('node:worker_threads');const vm=require('node:vm');
const context=vm.createContext(Object.create(null));
vm.runInContext(\`(()=>{
 const messages=[];globalThis.self=globalThis;globalThis.postMessage=data=>messages.push(data);globalThis.__readOutputs=()=>messages.splice(0);
 globalThis.console={log(){},info(){},warn(){},error(){},debug(){}};
 globalThis.TextEncoder=class{encode(s){const bytes=[];for(const c of unescape(encodeURIComponent(s)))bytes.push(c.charCodeAt(0));return new Uint8Array(bytes);}};
 globalThis.TextDecoder=class{decode(bytes){let s='';for(const byte of bytes)s+=String.fromCharCode(byte);return decodeURIComponent(escape(s));}};
 globalThis.performance={now:()=>Date.now()};
 globalThis.structuredClone=value=>{const seen=new Map();const copy=item=>{if(item===null||typeof item!=="object"){if(typeof item==="function"||typeof item==="symbol")throw Error("DataCloneError");return item;}if(seen.has(item))return seen.get(item);let result;if(item instanceof ArrayBuffer)result=item.slice(0);else if(ArrayBuffer.isView(item))result=new item.constructor(copy(item.buffer),item.byteOffset,item.length);else if(item instanceof Date)result=new Date(item);else if(item instanceof Map){result=new Map();seen.set(item,result);for(const[key,value]of item)result.set(copy(key),copy(value));}else if(item instanceof Set){result=new Set();seen.set(item,result);for(const value of item)result.add(copy(value));}else{result=Array.isArray(item)?[]:{};seen.set(item,result);for(const[key,value]of Object.entries(item))Object.defineProperty(result,key,{value:copy(value),writable:true,enumerable:true,configurable:true});}return result;};return copy(value);};
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
 globalThis.btoa=s=>{let bits=0,value=0,out='';for(const c of s){value=(value<<8)|c.charCodeAt(0);bits+=8;while(bits>=6){bits-=6;out+=alphabet[(value>>bits)&63];}}if(bits)out+=alphabet[(value<<(6-bits))&63];while(out.length%4)out+='=';return out;};
 globalThis.atob=s=>{let bits=0,value=0,out='';for(const c of s.replace(/=+$/,'')){const n=alphabet.indexOf(c);if(n<0)throw Error('base64');value=(value<<6)|n;bits+=6;if(bits>=8){bits-=8;out+=String.fromCharCode((value>>bits)&255);}}return out;};
})()\`,context);
vm.runInContext(workerData.source,context,{timeout:8000});
const poll=setInterval(()=>{for(const text of vm.runInContext('__readOutputs()',context)){const message=JSON.parse(text);if(message.type==='worker-ready'){vm.runInContext('self.onmessage({data:'+JSON.stringify(workerData.input)+'})',context);continue;}parentPort.postMessage(message);if(message.type!=='started')clearInterval(poll);}},2);`;
async function run(input,timeout=8000){
 const worker=new Worker(harness,{eval:true,workerData:{source,input},resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:16,stackSizeMb:4}});
 const messages=[];
 try{return await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>resolve({type:"timeout",messages}),timeout);
  worker.on("message",message=>{messages.push(message);if(message.type!=="started"){clearTimeout(timer);resolve(message);}});worker.on("error",error=>{clearTimeout(timer);reject(error);});
 });}finally{await worker.terminate();}
}
const graph=new SceneGraph(),page=graph.getPages()[0],encoded=serializeGraph(graph);
const input=code=>({graph:encoded,pageId:page.id,selection:[],code});
const checks=[];
const create=await run(input("const frame=figma.createFrame();frame.name='Worker';frame.resize(240,160);for(let i=0;i<3;i++){const r=figma.createRectangle();r.x=i*30;frame.appendChild(r);}figma.currentPage.selection=[frame];({id:frame.id,count:frame.children.length})"));
assert.equal(create.type,"result",JSON.stringify(create).slice(0,1500));assert.equal(JSON.parse(create.output.result).count,3);assert.equal(deserializeGraph(create.output.graph).nodes.size,6);assert.equal(serializeGraph(graph),encoded);checks.push("published API, loops, selection and source isolation");
const asyncResult=await run(input("const value=await Promise.resolve(42);console.log('worker');value"));assert.equal(asyncResult.type,"result");assert.equal(asyncResult.output.result,"42");assert.deepEqual(asyncResult.output.logs,["worker"]);checks.push("async expressions and bounded console");
const capabilities=await run(input("({window:typeof window,parent:typeof parent,document:typeof document,process:typeof process,require:typeof require,fetch:typeof fetch,indexedDB:typeof indexedDB,worker:typeof Worker,postMessage:typeof postMessage,tauri:typeof __TAURI_INTERNALS__,constructor:Function('return typeof process')()})"));assert.equal(capabilities.type,"result");assert.ok(Object.values(JSON.parse(capabilities.output.result)).every(value=>value==="undefined"));checks.push("ambient facilities and function-constructor realm");
const imported=await run(input("await import('node:fs')"));assert.equal(imported.type,"error");checks.push("no host module import in verifier realm");
const failed=await run(input("figma.createRectangle();throw Error('deliberate')"));assert.equal(failed.type,"error");assert.ok(failed.error.includes("deliberate"));assert.equal(serializeGraph(graph),encoded);checks.push("error keeps original source");
const loop=await run(input("while(true){}"),1000);assert.equal(loop.type,"timeout");checks.push("separate thread termination for nonterminating code");
const record={checks,passed:checks.length,bundleSha256:createHash("sha256").update(source).digest("hex"),bundleBytes:Buffer.byteLength(source),inputs:hashes,warnings:bundle.warnings.map(item=>item.text),limits:"Actual bundled worker execution in a null-prototype VM realm inside real Node threads; DOM/CSP/opaque-origin/native WebKit acceptance remains unverified."};
if(process.env.XDESIGN_SCRIPT_BUNDLE_DIR){
 const dist=process.env.XDESIGN_SCRIPT_BUNDLE_DIR,matched=[];
 for(const file of (await readdir(`${dist}/assets`)).filter(file=>file.startsWith("scriptRuntime-")&&file.endsWith(".js"))){
  const code=await readFile(`${dist}/assets/${file}`,"utf8"),pending=[parse(code,{ecmaVersion:"latest",sourceType:"module"})];
  while(pending.length){
   const node=pending.pop();
   const value=node.type==="Literal"?node.value:node.type==="TemplateLiteral"&&node.expressions.length===0?node.quasis[0].value.cooked:null;
   if(typeof value==="string"&&createHash("sha256").update(value).digest("hex")===record.bundleSha256)matched.push(file);
   for(const item of Object.values(node)){if(Array.isArray(item))pending.push(...item.filter(child=>child&&typeof child==="object"&&"type" in child));else if(item&&typeof item==="object"&&"type" in item)pending.push(item);}
  }
 }
 assert.equal(matched.length,1,"The checked worker must appear exactly once in the production script chunk");
 const notices=(await readdir(`${dist}/licenses`)).filter(file=>file.startsWith("main-")&&file.endsWith(".json"));
 const packages=new Set();for(const file of notices)for(const pkg of JSON.parse(await readFile(`${dist}/licenses/${file}`,"utf8")))packages.add(`${pkg.name}@${pkg.version}`);
 const required=new Set();for(const file of Object.keys(hashes)){const pkg=packageForModule(path.resolve(file));if(pkg)required.add(`${pkg.name}@${pkg.version}`);}
 for(const pkg of required)assert.ok(packages.has(pkg),`Missing embedded-worker production notice: ${pkg}`);
 record.production={chunk:matched[0],chunkSha256:createHash("sha256").update(await readFile(`${dist}/assets/${matched[0]}`)).digest("hex"),workerCopies:matched.length,workerPackages:[...required].sort(),noticePackages:packages.size};
}
await writeFile(`${output}/checks.json`,JSON.stringify(record,null,2)+"\n");
console.log(JSON.stringify({passed:record.passed,bundleBytes:record.bundleBytes,inputs:Object.keys(hashes).length,warnings:record.warnings,production:record.production?{workerCopies:record.production.workerCopies,workerPackages:record.production.workerPackages.length,noticePackages:record.production.noticePackages}:undefined},null,2));
