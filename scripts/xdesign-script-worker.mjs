import path from "node:path";
import { build } from "esbuild";
import { parse } from "acorn";

export async function bundleXDesignScriptWorker() {
  const result=await build({entryPoints:["src/apps/xdesign/pencil/scriptSandbox.worker.ts"],bundle:true,write:false,format:"esm",platform:"browser",target:"es2022",metafile:true,legalComments:"inline",logLevel:"silent",external:["node:*","fs","path"],define:{"process.env.NODE_ENV":JSON.stringify("production"),"import.meta":"{}"}});
  const code=result.outputFiles[0].text;
  if(parse(code,{ecmaVersion:"latest",sourceType:"module"}).body.some(node=>node.type.startsWith("Import")||node.type.startsWith("Export")))throw new Error("The script worker must be bundled without external module statements.");
  const source=`(async()=>{\n${code}\n})().catch(error=>self.postMessage(JSON.stringify({version:1,type:"error",error:String(error).slice(0,1000)})));`;
  parse(source,{ecmaVersion:"latest",sourceType:"script"});
  return {...result,source};
}
export function xdesignScriptWorker() {
  const virtual="virtual:xdesign-script-worker", resolved="\0"+virtual;
  let inputs=new Set();
  return {name:"orion-xdesign-script-worker",api:{modules:()=>inputs},
    resolveId(id){if(id===virtual)return resolved;},
    async load(id){
      if(id!==resolved)return;
      const result=await bundleXDesignScriptWorker();
      inputs=new Set(Object.keys(result.metafile.inputs).filter(file=>!file.startsWith("<")).map(file=>path.resolve(file)));
      for(const file of inputs)this.addWatchFile(file);
      return `export default ${JSON.stringify(result.source)};`;
    },
    handleHotUpdate(context){if(inputs.has(context.file)){const module=context.server.moduleGraph.getModuleById(resolved);if(module)return[module];}}
  };
}
