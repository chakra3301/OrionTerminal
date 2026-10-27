import { afterEach, describe, expect, it } from "vitest";
import { editsText, installPageMenuGuard } from "./pageMenuGuard";

const rightClick = (target: Element, x = 0, y = 0) =>
  !target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y }));

describe("installPageMenuGuard", () => {
  let remove = () => {};
  afterEach(() => { remove(); document.body.innerHTML = ""; document.getSelection()?.removeAllRanges(); });

  it("keeps WebKit's page menu, with its Reload, off everything but text fields and selected text", () => {
    remove = installPageMenuGuard();
    document.body.innerHTML = `<div id="plain">Plain</div><input id="name"><input id="box" type="checkbox"><textarea id="note"></textarea>
      <div contenteditable="true"><p id="block">Block</p><span contenteditable="false" id="island">Island</span></div>`;
    const at = (id: string) => document.getElementById(id)!;
    expect(rightClick(at("plain"))).toBe(true);
    expect(rightClick(at("box"))).toBe(true);
    expect(rightClick(at("name"))).toBe(false);
    expect(rightClick(at("note"))).toBe(false);
    expect(rightClick(at("block"))).toBe(false);
    expect(rightClick(at("island"))).toBe(false);
  });

  it("keeps Copy and Look Up on selected text, whose menu has no Reload", () => {
    remove = installPageMenuGuard();
    document.body.innerHTML = `<p id="text">Selected words</p>`;
    const text = document.getElementById("text")!, range = document.createRange();
    range.selectNodeContents(text);
    document.getSelection()!.addRange(range);
    const rects = Range.prototype.getClientRects;
    Range.prototype.getClientRects = () => [{ left: 10, right: 90, top: 10, bottom: 30 }] as unknown as DOMRectList;
    try {
      expect(rightClick(text, 50, 20)).toBe(false);
      expect(rightClick(text, 50, 60)).toBe(true);
    } finally {
      Range.prototype.getClientRects = rects;
    }
  });

  it("leaves menus the apps open themselves alone", () => {
    remove = installPageMenuGuard();
    document.body.innerHTML = `<div id="own"></div>`;
    let opened = false;
    document.getElementById("own")!.addEventListener("contextmenu", event => { event.preventDefault(); opened = true; });
    expect(rightClick(document.getElementById("own")!)).toBe(true);
    expect(opened).toBe(true);
  });
});

describe("editsText", () => {
  it("counts typing fields, not checkboxes, sliders or buttons", () => {
    document.body.innerHTML = `<input id="number" type="number"><input id="range" type="range"><input id="button" type="button">`;
    expect(editsText(document.getElementById("number"))).toBe(true);
    expect(editsText(document.getElementById("range"))).toBe(false);
    expect(editsText(document.getElementById("button"))).toBe(false);
    expect(editsText(null)).toBe(false);
  });
});
