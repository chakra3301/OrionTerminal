import { describe, it, expect } from "vitest";
import {
  pathOf,
  elementAt,
  parseInlineStyle,
  serializeInlineStyle,
  mergeInlineStyle,
  serializeForSave,
  cleanOuterHTML,
  EDITOR_STYLE_ID,
} from "./htmlEditor";

function docFrom(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("element path", () => {
  it("round-trips an element via pathOf/elementAt", () => {
    const doc = docFrom(
      "<!doctype html><html><body><header><h1>Hi</h1></header><main><p>a</p><p id=t>b</p></main></body></html>",
    );
    const target = doc.getElementById("t")!;
    const path = pathOf(target);
    const resolved = elementAt(doc.documentElement, path);
    expect(resolved).toBe(target);
  });

  it("returns null for an out-of-range path", () => {
    const doc = docFrom("<!doctype html><html><body><p>x</p></body></html>");
    expect(elementAt(doc.documentElement, [0, 9])).toBeNull();
  });
});

describe("inline style helpers", () => {
  it("parses and serializes", () => {
    const m = parseInlineStyle("color: red; font-size: 14px");
    expect(m).toEqual({ color: "red", "font-size": "14px" });
    expect(serializeInlineStyle(m)).toBe("color: red; font-size: 14px");
  });

  it("merges a patch and removes on empty/null", () => {
    expect(mergeInlineStyle("color: red", { "font-weight": "700" })).toBe(
      "color: red; font-weight: 700",
    );
    expect(mergeInlineStyle("color: red; font-weight: 700", { "font-weight": null })).toBe(
      "color: red",
    );
    expect(mergeInlineStyle(null, { color: "blue" })).toBe("color: blue");
  });
});

describe("serializeForSave / stripEditorChrome", () => {
  it("strips injected style, data-xd-* attrs, and contenteditable", () => {
    const doc = docFrom(
      `<!doctype html><html><head><style id="${EDITOR_STYLE_ID}">.x{}</style><title>T</title></head>` +
        `<body><h1 data-xd-selected="1" contenteditable="true" style="color:red">Hi</h1></body></html>`,
    );
    const out = serializeForSave(doc);
    expect(out).toContain("<!doctype html>");
    expect(out).not.toContain(EDITOR_STYLE_ID);
    expect(out).not.toContain("data-xd-");
    expect(out).not.toContain("contenteditable");
    expect(out).toContain("color:red"); // genuine inline style preserved
    expect(out).toContain("<title>T</title>");
  });

  it("cleanOuterHTML strips chrome without mutating the live element", () => {
    const doc = docFrom(
      `<!doctype html><html><body><div data-xd-selected="1" contenteditable="true" style="color:red"><span>x</span></div></body></html>`,
    );
    const el = doc.querySelector("div")!;
    const out = cleanOuterHTML(el);
    expect(out).not.toContain("data-xd-");
    expect(out).not.toContain("contenteditable");
    expect(out).toContain("color:red");
    expect(out).toContain("<span>x</span>");
    expect(el.getAttribute("data-xd-selected")).toBe("1"); // live untouched
  });

  it("does not mutate the live document", () => {
    const doc = docFrom(
      `<!doctype html><html><body><h1 data-xd-selected="1">Hi</h1></body></html>`,
    );
    serializeForSave(doc);
    expect(doc.querySelector("h1")!.getAttribute("data-xd-selected")).toBe("1");
  });
});
