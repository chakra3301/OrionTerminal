import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { parse } from 'acorn';
import { frontendLicenses } from './frontend-licenses.mjs';

export async function bundleXDesignNativeReactWorker() {
  const result = await build({entryPoints: ['src/apps/xdesign/pencil/nativeReact.worker.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', metafile: true, legalComments: 'inline', logLevel: 'silent', external: ['node:*', 'fs', 'path'], define: {'process.env.NODE_ENV': JSON.stringify('production'), 'import.meta': '{}'}, plugins: [{name: 'native-react-raw', setup(build) {
    build.onResolve({filter: /\?raw$/}, args => ({path: path.resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'native-react-raw'}));
    build.onLoad({filter: /.*/, namespace: 'native-react-raw'}, args => ({contents: fs.readFileSync(args.path, 'utf8'), loader: 'text', watchFiles: [args.path]}));
  }}]});
  const code = result.outputFiles[0].text;
  if (parse(code, {ecmaVersion: 'latest', sourceType: 'module'}).body.some(node => node.type.startsWith('Import') || node.type.startsWith('Export'))) throw new Error('The native renderer must be bundled without external module statements.');
  const source = `(function(){const waiting=[];self.onmessage=event=>{if(waiting.length>=2){self.postMessage({type:'error',message:'Too many requests before native renderer startup.'});return;}waiting.push(event);};(async()=>{\n${code}\nconst handler=self.onmessage;for(const event of waiting)handler(event);waiting.length=0;})().catch(error=>self.postMessage({type:'error',message:String(error).slice(0,2000)}));})();`;
  parse(source, {ecmaVersion: 'latest', sourceType: 'script'});
  const modules = new Set(Object.keys(result.metafile.inputs).map(file => path.resolve(file.replace(/^native-react-raw:/, ''))));
  const inventory = frontendLicenses('native-react', process.cwd(), () => modules), notices = [];
  inventory.buildStart();
  inventory.generateBundle.call({emitFile(asset) {notices.push({name: asset.fileName, source: asset.source});}}, {}, {});
  return {...result, source, modules, notices};
}

export function xdesignNativeReactWorker() {
  const virtual = 'virtual:xdesign-native-react-worker', resolved = '\0' + virtual;
  let inputs = new Set();
  return {name: 'orion-xdesign-native-react-worker', api: {modules: () => inputs},
    resolveId(id) {if (id === virtual) return resolved;},
    async load(id) {
      if (id !== resolved) return;
      const result = await bundleXDesignNativeReactWorker(); inputs = result.modules;
      for (const file of inputs) if (fs.existsSync(file)) this.addWatchFile(file);
      return `export default ${JSON.stringify({source: result.source, notices: result.notices})};`;
    },
    handleHotUpdate(context) {if (inputs.has(context.file)) {const module = context.server.moduleGraph.getModuleById(resolved); if (module) return [module];}},
  };
}
