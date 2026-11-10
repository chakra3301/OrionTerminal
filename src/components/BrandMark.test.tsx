import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrandMark } from "./BrandMark";

const svgOf = (markup: string) => {
  const host = document.createElement("div");
  host.innerHTML = markup;
  return host.querySelector("svg")!;
};

describe("BrandMark", () => {
  it("draws the chamfered ring with a square hole and the two corner squares", () => {
    const svg = svgOf(renderToStaticMarkup(<BrandMark />));
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("Orion Studio");
    expect(svg.getAttribute("viewBox")).toBe("-118 -66 236 132");
    expect(svg.getAttribute("fill")).toBe("currentColor");
    const [ring, ...squares] = [...svg.querySelectorAll("path")];
    expect(ring!.getAttribute("fill-rule")).toBe("evenodd");
    expect(ring!.getAttribute("d")).toBe("M-55-56H55L81-30V30L55 56H-55L-81 30V-30ZM-45.5-28V28H45.5V-28Z");
    expect(squares.map(square => square.getAttribute("d"))).toEqual(["M-118-66h33v33h-33Z", "M85 33h33v33h-33Z"]);
  });

  it("is hidden from assistive tech when a label sits beside it", () => {
    const svg = svgOf(renderToStaticMarkup(<BrandMark decorative className="x" />));
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("role")).toBeNull();
    expect(svg.getAttribute("class")).toBe("x");
  });
});
