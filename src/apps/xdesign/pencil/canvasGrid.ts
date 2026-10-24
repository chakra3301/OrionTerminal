import type { Editor } from "@open-pencil/core/editor";
import { installNativeLineStroke } from "./nativeRendererLine";
import { installNativeOpacityLayers } from "./nativeRendererLifecycle";

type Renderer = Parameters<Editor["setCanvasKit"]>[1];

/** The grid belongs to the workspace, not the saved page or exported artwork.
 * OpenPencil 0.15 clears the viewport to an opaque page color before painting.
 * Insert our backdrop at that clear, only during viewport presentation. */
export function installCanvasGrid(editor: Editor, element: HTMLElement, showGrid: () => boolean = () => true) {
  const setCanvasKit = editor.setCanvasKit;
  const installed = new Map<Renderer, () => void>();
  const install = (renderer: Renderer) => {
    if (installed.has(renderer)) return;
    const { ck } = renderer;
    const paint = new ck.Paint();
    paint.setAntiAlias(false);
    paint.setStyle(ck.PaintStyle.Stroke);
    const restoreLineStroke = installNativeLineStroke(renderer), restoreOpacity = installNativeOpacityLayers(renderer);
    const render = renderer.renderFromEditorState;
    const destroy = renderer.destroy;
    let active = true;
    const restore = () => {
      if (!active) return;
      active = false;
      renderer.renderFromEditorState = render;
      renderer.destroy = destroy;
      restoreLineStroke();
      restoreOpacity();
      paint.delete();
      installed.delete(renderer);
    };
    renderer.destroy = function () { restore(); return destroy.call(this); };
    renderer.renderFromEditorState = function (state, graph, textEditor, width, height, showRulers, layer, interactive) {
      if (layer === "overlays") return render.call(this, state, graph, textEditor, width, height, showRulers, layer, interactive);
      const background = ck.parseColorString(getComputedStyle(element).getPropertyValue("--xd-bg").trim() || "#1e1e1e");
      const color = { r: background[0]!, g: background[1]!, b: background[2]!, a: 1 };
      const ink = color.r * .2126 + color.g * .7152 + color.b * .0722 > .5 ? 0 : 1;
      const rulerColor = (a: number) => ({ r: ink, g: ink, b: ink, a });
      const surface = this.surface, getCanvas = surface.getCanvas;
      const canvas = getCanvas.call(surface);
      const clear = canvas.clear;
      // CanvasKit returns a new JS handle from getCanvas(). Keep this handle
      // for the presentation pass so its clear interceptor is actually used.
      surface.getCanvas = () => canvas;
      canvas.clear = function (value) {
        clear.call(this, value);
        if (!showGrid()) return;
        const dpr = renderer.dpr;
        paint.setStrokeWidth(dpr);
        paint.setColor(ck.Color4f(ink, ink, ink, ink ? .04 : .06));
        // Match the original editor's fixed 40 CSS-pixel square grid.
        for (let x = 0; x < width; x += 40) this.drawLine((x + .5) * dpr, 0, (x + .5) * dpr, height * dpr, paint);
        for (let y = 0; y < height; y += 40) this.drawLine(0, (y + .5) * dpr, width * dpr, (y + .5) * dpr, paint);
      };
      try {
        return render.call(this, { ...state, pageColor: color, rulerTheme: {
          background: color, tick: rulerColor(.18), text: rulerColor(.6), label: rulerColor(.85),
        } }, graph, textEditor, width, height, showRulers, layer, interactive);
      } finally {
        canvas.clear = clear;
        surface.getCanvas = getCanvas;
        this.pageColor = state.pageColor;
        this.rulerTheme = state.rulerTheme ?? null;
      }
    };
    installed.set(renderer, restore);
  };
  editor.setCanvasKit = (ck, renderer) => { install(renderer); setCanvasKit(ck, renderer); };
  if (editor.renderer) install(editor.renderer);
  return () => {
    editor.setCanvasKit = setCanvasKit;
    for (const restore of installed.values()) restore();
  };
}
