/**
 * FX exports — JSON scene files, a fully self-contained HTML embed (its own
 * tiny WebGL2 player, no editor code, shaders prebuilt at export time), and
 * offscreen PNG snapshots (also used by "FX as frame fill" in slice 9).
 */

import {
  buildFragment,
  isUniformParam,
  customCodeOf,
  FX_CUSTOM_ID,
  type FxScene,
} from "./fxModel";
import { fxEffect } from "./fxRegistry";
import { sanitizeScene } from "./fxStore";
import { createCompositor } from "./compositor";
import { rasterizeSource } from "./fxRaster";
import { evalSceneKeyframes } from "./fxTimeline";

// ── JSON scene files ──────────────────────────────────────────────────────

export type FxSceneFile = { kind: "orion-fx-scene"; version: 1; scene: FxScene };

export function sceneToJson(scene: FxScene): string {
  const file: FxSceneFile = { kind: "orion-fx-scene", version: 1, scene };
  return JSON.stringify(file, null, 2);
}

/** Parse + sanitize a scene file. Returns null on anything malformed. */
export function sceneFromJson(text: string): FxScene | null {
  try {
    const raw = JSON.parse(text) as Partial<FxSceneFile>;
    if (raw?.kind !== "orion-fx-scene" || !raw.scene) return null;
    const s = raw.scene as Partial<FxScene>;
    if (!Array.isArray(s.layers) || typeof s.width !== "number") return null;
    return sanitizeScene(raw.scene);
  } catch {
    return null;
  }
}

// ── Offscreen snapshot ────────────────────────────────────────────────────

/** Render one frame of a scene into a PNG blob, offscreen. Rasterizes all
 * source layers first and applies timeline keyframes at `timeSec`. */
export async function renderFxSnapshot(
  scene: FxScene,
  timeSec: number,
  pixelW: number,
  pixelH: number,
): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  const compositor = createCompositor(canvas, { preserveDrawingBuffer: true });
  if (!compositor) return null;
  try {
    for (const layer of scene.layers) {
      if (!fxEffect(layer.effectId)?.source) continue;
      const cnv = await rasterizeSource(layer, pixelW, pixelH);
      if (cnv) compositor.updateSource(layer.id, cnv);
    }
    const overrides = evalSceneKeyframes(scene, timeSec);
    compositor.render(
      scene,
      { time: timeSec, mouse: [0.5, 0.5] },
      pixelW,
      pixelH,
      overrides,
    );
    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
  } finally {
    compositor.dispose();
  }
}

// ── HTML embed ────────────────────────────────────────────────────────────

type EmbedSpec = {
  source: boolean;
  params: { key: string; type: string; min?: number; max?: number; default: number | string }[];
};

/** The standalone player. Kept dependency-free and small — this exact
 * string ships inside every exported embed. */
const EMBED_PLAYER = String.raw`
(function () {
  var D = window.__FX_DATA__;
  var canvas = document.getElementById("fx");
  var gl = canvas.getContext("webgl2", { antialias: false, alpha: false });
  if (!gl) { canvas.replaceWith(document.createTextNode("WebGL2 required")); return; }
  var BLENDS = ["normal","add","screen","multiply","overlay","softlight","difference","lighten","darken"];
  function hx(h){var m=/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(h||"");if(!m)return[0,0,0];var s=m[1];if(s.length===3)s=s.replace(/./g,function(c){return c+c});return[parseInt(s.slice(0,2),16)/255,parseInt(s.slice(2,4),16)/255,parseInt(s.slice(4,6),16)/255];}
  function sh(t,src){var s=gl.createShader(t);gl.shaderSource(s,src);gl.compileShader(s);return s;}
  var VS = "#version 300 es\nlayout(location=0) in vec2 aPos; out vec2 vUv; void main(){vUv=aPos*0.5+0.5;gl_Position=vec4(aPos,0.,1.);}";
  var progs = {};
  for (var eid in D.shaders) {
    var p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, D.shaders[eid]));
    gl.linkProgram(p);
    progs[eid] = gl.getProgramParameter(p, gl.LINK_STATUS) ? p : null;
  }
  var COPY = gl.createProgram();
  gl.attachShader(COPY, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(COPY, sh(gl.FRAGMENT_SHADER, "#version 300 es\nprecision highp float;uniform sampler2D uTex;in vec2 vUv;out vec4 o;void main(){o=texture(uTex,vUv);}"));
  gl.linkProgram(COPY);
  var vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  var vb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
  function target(w,h){var t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);var f=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,f);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t,0);return{t:t,f:f};}
  var scene = D.scene;
  var W = Math.round(scene.width * Math.min(devicePixelRatio || 1, 2));
  var H = Math.round(scene.height * Math.min(devicePixelRatio || 1, 2));
  canvas.width = W; canvas.height = H;
  var A = target(W,H), B = target(W,H);
  var srcTex = {};
  var blank = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, blank);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0,0]));
  for (var lid in D.sources) (function(lid){
    var img = new Image();
    img.onload = function(){
      var t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      srcTex[lid] = t;
    };
    img.src = D.sources[lid];
  })(lid);
  var mouse=[0.5,0.5], mt=[0.5,0.5], mp=[0.5,0.5], hover=0, speed=0, smoothed={};
  canvas.addEventListener("pointermove", function(e){var r=canvas.getBoundingClientRect();mt[0]=(e.clientX-r.left)/r.width;mt[1]=1-(e.clientY-r.top)/r.height;});
  canvas.addEventListener("pointerenter", function(){hover=1;});
  canvas.addEventListener("pointerleave", function(){hover=0;});
  var visible = true;
  if (typeof IntersectionObserver !== "undefined") new IntersectionObserver(function(en){visible=en[0]?en[0].isIntersecting:true;}).observe(canvas);
  function evalKfs(kfs, t){
    if(!kfs.length) return undefined;
    if(t<=kfs[0].t) return kfs[0].v;
    var L=kfs[kfs.length-1];
    if(t>=L.t) return L.v;
    for(var i=0;i<kfs.length-1;i++){var a=kfs[i],b=kfs[i+1];if(t>=a.t&&t<=b.t){var s=b.t-a.t,f=s>0?(t-a.t)/s:1,e=b.ease||"inOut";if(e==="hold")f=0;else if(e==="inOut")f=f*f*(3-2*f);return a.v+(b.v-a.v)*f;}}
    return L.v;
  }
  var t0 = performance.now(), last = t0, T = 0;
  function frame(now){
    requestAnimationFrame(frame);
    if(!visible || document.hidden) { last = now; return; }
    var dt = Math.min(0.1,(now-last)/1000); last = now;
    T += dt;
    var k = 1 - Math.exp(-dt*8);
    mouse[0]+=(mt[0]-mouse[0])*k; mouse[1]+=(mt[1]-mouse[1])*k;
    if(dt>0){var raw=Math.min(1,Math.hypot(mt[0]-mp[0],mt[1]-mp[1])/dt/2);speed=Math.max(raw,speed*Math.exp(-dt*4));}
    mp[0]=mt[0]; mp[1]=mt[1];
    var ac=Math.min(1,T/1.2); var appear=1-Math.pow(1-ac,3);
    var inputs={mouseX:mouse[0],mouseY:mouse[1],mouseSpeed:speed,hover:hover,appear:appear};
    var dur=Math.max(0.1,scene.duration||6);
    var t01=((T%dur)+dur)%dur/dur;
    gl.bindVertexArray(vao);
    gl.viewport(0,0,W,H);
    var bg=hx(scene.background);
    var ping=A, pong=B;
    gl.bindFramebuffer(gl.FRAMEBUFFER,ping.f);
    gl.clearColor(bg[0],bg[1],bg[2],1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    for(var i=0;i<scene.layers.length;i++){
      var l=scene.layers[i];
      if(l.hidden||l.opacity<=0) continue;
      var prog=progs[l.effectId==="custom"?("custom:"+l.id):l.effectId]||progs[l.effectId], spec=D.specs[l.effectId];
      if(!prog||!spec) continue;
      gl.bindFramebuffer(gl.FRAMEBUFFER,pong.f);
      gl.useProgram(prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D,ping.t);
      gl.uniform1i(gl.getUniformLocation(prog,"uTex"),0);
      if(spec.source){gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,srcTex[l.id]||blank);gl.uniform1i(gl.getUniformLocation(prog,"uSrc"),1);}
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D,(l.maskLayerId&&srcTex[l.maskLayerId])||blank);
      gl.uniform1i(gl.getUniformLocation(prog,"uMask"),2);
      gl.uniform1f(gl.getUniformLocation(prog,"uHasMask"),(l.maskLayerId&&srcTex[l.maskLayerId])?1:0);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform2f(gl.getUniformLocation(prog,"uResolution"),W,H);
      gl.uniform1f(gl.getUniformLocation(prog,"uTime"),T);
      gl.uniform2f(gl.getUniformLocation(prog,"uMouse"),mouse[0],mouse[1]);
      gl.uniform1f(gl.getUniformLocation(prog,"uMouseSpeed"),speed);
      gl.uniform1f(gl.getUniformLocation(prog,"uOpacity"),l.opacity);
      gl.uniform1f(gl.getUniformLocation(prog,"uBlend"),Math.max(0,BLENDS.indexOf(l.blend||"normal")));
      for(var j=0;j<spec.params.length;j++){
        var p=spec.params[j];
        if(p.type==="text"||p.type==="image") continue;
        var u=gl.getUniformLocation(prog,"u_"+p.key);
        if(!u) continue;
        var v=(l.params[p.key]!==undefined?l.params[p.key]:p.default);
        if(l.keyframes&&l.keyframes[p.key]){var kv=evalKfs(l.keyframes[p.key],t01);if(kv!==undefined)v=kv;}
        if(l.bindings&&l.bindings[p.key]&&p.type==="number"){
          var b=l.bindings[p.key];
          var rawv=inputs[b.source]||0;
          var sid=l.id+":"+p.key;
          var prev=(sid in smoothed)?smoothed[sid]:rawv;
          var kk=1-Math.exp(-dt*(30-Math.min(1,Math.max(0,(b.smooth===undefined?0.3:b.smooth)))*27));
          var sm=prev+(rawv-prev)*kk;
          smoothed[sid]=sm;
          v=Math.min(p.max,Math.max(p.min,(typeof v==="number"?v:p.default)+b.amount*(p.max-p.min)*sm));
        }
        if(p.type==="color"){var c=hx(String(v));gl.uniform3f(u,c[0],c[1],c[2]);}
        else gl.uniform1f(u,typeof v==="number"?v:Number(v)||0);
      }
      gl.drawArrays(gl.TRIANGLES,0,3);
      var tmp=ping; ping=pong; pong=tmp;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    gl.viewport(0,0,W,H);
    gl.useProgram(COPY);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D,ping.t);
    gl.uniform1i(gl.getUniformLocation(COPY,"uTex"),0);
    gl.drawArrays(gl.TRIANGLES,0,3);
  }
  requestAnimationFrame(frame);
})();
`;

/** Build a self-contained HTML embed. `sources` maps source-layer id →
 * PNG data URL (rasterized by the caller at scene resolution). */
export function buildEmbedHtml(
  scene: FxScene,
  sources: Record<string, string>,
  title = "Orion FX",
): string {
  const shaders: Record<string, string> = {};
  const specs: Record<string, EmbedSpec> = {};
  for (const layer of scene.layers) {
    const spec = fxEffect(layer.effectId);
    if (!spec) continue;
    // Custom layers carry their own body — one shader entry per layer.
    if (layer.effectId === FX_CUSTOM_ID) {
      shaders[`${FX_CUSTOM_ID}:${layer.id}`] = buildFragment(
        spec,
        customCodeOf(layer),
      );
    }
    if (shaders[layer.effectId]) continue;
    shaders[layer.effectId] = buildFragment(spec);
    specs[layer.effectId] = {
      source: !!spec.source,
      params: spec.params.map((p) => ({
        key: p.key,
        type: p.type,
        min: p.type === "number" ? p.min : undefined,
        max: p.type === "number" ? p.max : undefined,
        default: isUniformParam(p) || p.type === "text" || p.type === "image" ? p.default : 0,
      })),
    };
  }
  const data = JSON.stringify({ scene, shaders, specs, sources }).replace(
    /<\/script>/gi,
    "<\\/script>",
  );
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title.replace(/[<>&]/g, "")}</title>
<style>
  html, body { margin: 0; height: 100%; background: ${scene.background}; }
  body { display: grid; place-items: center; }
  #fx { max-width: 100vw; max-height: 100vh; aspect-ratio: ${scene.width} / ${scene.height}; width: 100%; }
</style>
</head>
<body>
<canvas id="fx"></canvas>
<script>window.__FX_DATA__ = ${data};</script>
<script>${EMBED_PLAYER}</script>
</body>
</html>
`;
}
