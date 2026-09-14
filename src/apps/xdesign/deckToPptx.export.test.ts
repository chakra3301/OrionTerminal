import { expect, it } from "vitest";
import JSZip from "jszip";
import { deckToPptxBase64 } from "./deckToPptx";

it("exports real editable slides with valid XML and no imported image/network relationships", async () => {
  const result = await deckToPptxBase64(`
    <section class="slide"><h1>Revenue &amp; Growth</h1>
      <ul><li>Editable bullet — 日本語</li><li>Margin &lt; 20%</li></ul>
      <img src="https://example.invalid/private.png"><script>throw new Error('must not execute')</script>
    </section>
    <section class="slide"><h2>Next steps</h2><p>Ship with care.</p></section>
  `, null, 'Review & "decisions"');
  const zip = await JSZip.loadAsync(result, { base64: true, checkCRC32: true });
  const paths = Object.keys(zip.files);
  expect(paths.filter(p => /^ppt\/slides\/slide\d+\.xml$/.test(p))).toHaveLength(2);
  expect(paths.filter(p => p.startsWith("ppt/media/") && !zip.files[p]!.dir)).toHaveLength(0);
  for (const path of paths.filter(p => /\.(xml|rels)$/.test(p))) {
    const xml = await zip.file(path)!.async("string");
    expect(new DOMParser().parseFromString(xml, "application/xml").querySelector("parsererror"), path).toBeNull();
    expect(xml).not.toContain("example.invalid");
    expect(xml).not.toContain('TargetMode="External"');
  }
  const slide = new DOMParser().parseFromString(await zip.file("ppt/slides/slide1.xml")!.async("string"), "application/xml");
  const text = [...slide.getElementsByTagNameNS("http://schemas.openxmlformats.org/drawingml/2006/main", "t")].map(n => n.textContent);
  expect(text).toContain("Revenue & Growth");
  expect(text).toContain("Editable bullet — 日本語");
  expect(text).toContain("Margin < 20%");
  expect(slide.getElementsByTagNameNS("http://schemas.openxmlformats.org/drawingml/2006/main", "buChar").length).toBeGreaterThan(0);
});
