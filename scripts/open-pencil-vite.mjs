import fs from "node:fs";
import path from "node:path";

// OpenPencil 0.15.1's compiled packages retain source .ts worker URLs.
// Resolve only those known URLs to the corresponding published .js worker.
export function openPencilWorkers() {
  return {name:"orion-open-pencil-workers",enforce:"pre",transform(code,id){
    const file=id.split("?")[0].replaceAll("\\","/");
    if(!file.includes("/node_modules/@open-pencil/core/dist/"))return null;
    // The XPath dependency publishes CommonJS and ESM. Normalize both shapes
    // so the same query implementation works in the webview and native tests.
    if(file.endsWith("/xpath.js")) {
      const patched=code.replace(/const \{ (evaluateXPathToNodes|evaluateXPathToBoolean) \} = await import\("fontoxpath"\);/g,(_match,method)=>`const xpathModule = await import("fontoxpath"); const { ${method} } = xpathModule.default ?? xpathModule;`);
      return patched===code?null:{code:patched,map:null};
    }
    // OpenPencil 0.15.1 (and 0.16.0) serialize solid SVG fills through colorToHex,
    // which drops alpha: a 40% red exports as opaque #FF0000. Emit rgba() for
    // translucent solid fills only; gradient stops and shadows carry their alpha
    // separately and must keep the opaque color. Fail loudly if an upgrade moves it.
    if(file.endsWith("/io/formats/svg/defs.js")||file.endsWith("/io/formats/svg/export.js")) {
      const helper=`\nfunction __orionSolidFill(color, opacity, colorSpace) { const a = color.a * (opacity ?? 1); if (a >= 1 || colorSpace === "display-p3") return formatColor(color, opacity, colorSpace); const c = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255); return \`rgba(\${c(color.r)},\${c(color.g)},\${c(color.b)},\${Math.round(Math.max(0, a) * 1e6) / 1e6})\`; }\n`;
      const sites=file.endsWith("/defs.js")
        ?[['if (fill.type === "SOLID") return formatColor(fill.color, fill.opacity, ctx.colorSpace);','if (fill.type === "SOLID") return __orionSolidFill(fill.color, fill.opacity, ctx.colorSpace);']]
        :[['if (visibleFill) attrs.fill = formatColor(visibleFill.color, visibleFill.opacity, colorSpace);','if (visibleFill) attrs.fill = __orionSolidFill(visibleFill.color, visibleFill.opacity, colorSpace);']];
      let patched=code;
      for(const [from,to] of sites){if(!patched.includes(from))throw new Error(`OpenPencil SVG fill patch no longer applies to ${path.basename(file)}; re-check translucent fill export`);patched=patched.replace(from,to);}
      return {code:patched+helper,map:null};
    }
    if(!/\/(?:export|client)\.js$/.test(file))return null;
    let patched=code.replace(/new URL\("(\.\/(?:export-)?worker)\.ts", import\.meta\.url\)/g,(_match,base)=>{
      if(!fs.existsSync(path.resolve(path.dirname(file),`${base}.js`)))throw new Error(`Missing published OpenPencil worker: ${base}.js`);
      return `new URL("${base}.js", import.meta.url)`;
    });
    // Under Tauri OpenPencil packs .fig through its own native build_fig_file command, which Orion
    // does not register. Pack in the export worker, as the browser build does.
    if(file.endsWith("/io/formats/fig/export.js")) {
      const from='if (IS_TAURI) {\n\t\tconst { invoke } = await import("@tauri-apps/api/core");';
      if(!patched.includes(from))throw new Error("OpenPencil FIG packing patch no longer applies to export.js; re-check FIG export under Tauri");
      patched=patched.replace(from,from.replace("IS_TAURI","false"));
    }
    return patched===code?null:{code:patched,map:null};
  }};
}
