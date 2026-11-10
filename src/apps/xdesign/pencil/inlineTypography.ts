import { applyStyleToRange, removeStyleFromRange } from "@open-pencil/core/text";
import type { Editor } from "@open-pencil/core/editor";
import type { CharacterStyleOverride, SceneNode } from "@open-pencil/scene-graph";

export function textRange(text:string,start:number,end:number):[number,number] {
  if(!Number.isFinite(start)||!Number.isFinite(end))throw new Error("Invalid character selection");
  let a=Math.max(0,Math.min(text.length,Math.trunc(Math.min(start,end)))),b=Math.max(a,Math.min(text.length,Math.trunc(Math.max(start,end))));
  // Character styles use UTF-16 offsets. Keep surrogate pairs intact.
  const low=(i:number)=>i>0&&i<text.length&&/[\uDC00-\uDFFF]/.test(text[i]!)&&/[\uD800-\uDBFF]/.test(text[i-1]!);
  if(low(a))a--;if(low(b))b++;return [a,b];
}
export async function formatTextRange(editor:Editor,node:SceneNode,range:[number,number],patch:CharacterStyleOverride|null):Promise<void> {
  if(editor.graph.getNode(node.id)!==node||node.locked||node.type!=="TEXT")throw new Error("Select an editable text layer");
  if(node.text.length>1_000_000)throw new Error("Text formatting supports up to one million characters");
  const text=editor.textEditor?.nodeId===node.id?editor.textEditor.state?.text??node.text:node.text;
  const [start,end]=textRange(text,...range);if(start===end)throw new Error("Select characters to format");
  if(editor.state.editingTextId===node.id)editor.commitTextEdit();
  const current=editor.graph.getNode(node.id);if(!current||current.text!==text)throw new Error("The text changed; select the current characters again");
  const styleRuns=patch?applyStyleToRange(current.styleRuns,start,end,patch,text.length):removeStyleFromRange(current.styleRuns,start,end,["fontFamily","fontSize","fontWeight","italic","letterSpacing","lineHeight","fills","textDecoration","textDecorationStyle","textDecorationThickness","textDecorationFills","textDecorationSkipInk","textUnderlineOffset","fontFeatures","fontVariations","textLanguage"],text.length);
  editor.updateNodeWithUndo(node.id,{styleRuns},patch?"Format selected text":"Clear character formatting");
  await editor.loadFontsForNodes([node.id]);
}
