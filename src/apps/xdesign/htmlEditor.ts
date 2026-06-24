// Pure core for the in-place HTML-artifact visual editor (Part 2 Phase 1).
//
// The preview renders the artifact in a same-origin <iframe srcdoc>, so the
// parent can read+edit iframe.contentDocument directly. This module holds the
// pure, testable pieces: a stable element path (so a selection survives a
// re-serialize), inline-style read/merge helpers, and serialize-for-save which
// strips all injected editor chrome before persisting/exporting. The DOM-bridge
// wiring in HtmlArtifactPreview.tsx is the thin untested side-effect layer.

/** Marker id of the editor's injected <style> (outline/selection chrome). */
export const EDITOR_STYLE_ID = "xd-editor-style";
/** Attribute prefix for all editor-injected attributes. */
export const EDITOR_ATTR_PREFIX = "data-xd-";

/** Path from the document root to an element as child-element indices. Stable
 * across re-serialization since it only depends on structural position. */
export function pathOf(el: Element): number[] {
  const path: number[] = [];
  let node: Element | null = el;
  while (node && node.parentElement) {
    const parent: Element = node.parentElement;
    const idx = Array.prototype.indexOf.call(parent.children, node);
    path.unshift(idx);
    node = parent;
  }
  return path;
}

/** Resolve a path produced by pathOf against a root element (documentElement).
 * The first index is interpreted relative to the root's children. */
export function elementAt(root: Element, path: number[]): Element | null {
  let node: Element | null = root;
  for (const idx of path) {
    if (!node) return null;
    const child: Element | undefined = node.children[idx];
    if (!child) return null;
    node = child;
  }
  return node;
}

/** Parse an inline style string into an ordered prop→value map. */
export function parseInlineStyle(style: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!style) return out;
  for (const decl of style.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const val = decl.slice(i + 1).trim();
    if (prop) out[prop] = val;
  }
  return out;
}

/** Serialize a prop→value map back to an inline style string. */
export function serializeInlineStyle(map: Record<string, string>): string {
  return Object.entries(map)
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");
}

/** Merge a patch into an existing inline style string. A null/empty patch value
 * removes that property. Returns the new style string. */
export function mergeInlineStyle(
  existing: string | null | undefined,
  patch: Record<string, string | null>,
): string {
  const map = parseInlineStyle(existing);
  for (const [k, v] of Object.entries(patch)) {
    const prop = k.trim().toLowerCase();
    if (v == null || v === "") delete map[prop];
    else map[prop] = v;
  }
  return serializeInlineStyle(map);
}

/** Remove all editor-injected chrome from a (cloned) element tree in place:
 * the injected <style>, every data-xd-* attribute, and contenteditable. */
export function stripEditorChrome(root: Element): void {
  const injected = root.querySelector(`#${EDITOR_STYLE_ID}`);
  if (injected) injected.remove();
  const all = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const el of all) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith(EDITOR_ATTR_PREFIX) || attr.name === "contenteditable") {
        el.removeAttribute(attr.name);
      }
    }
    // Drop an empty leftover style="" we may have created.
    if (el.getAttribute("style") === "") el.removeAttribute("style");
  }
}

/** Produce the persistable HTML for a document, stripping editor chrome first.
 * Clones documentElement so the live (edited) DOM keeps its chrome. */
export function serializeForSave(doc: Document): string {
  const clone = doc.documentElement.cloneNode(true) as Element;
  stripEditorChrome(clone);
  const dt = doc.doctype ? "<!doctype html>\n" : "";
  return dt + clone.outerHTML;
}
