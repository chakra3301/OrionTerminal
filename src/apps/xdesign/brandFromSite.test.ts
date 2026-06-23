import { describe, expect, it } from "vitest";
import {
  toHex,
  extractColorsRanked,
  extractThemeColor,
  extractSiteName,
  extractFonts,
  hostOf,
  seedFromSite,
  brandFromSite,
} from "./brandFromSite";

describe("toHex", () => {
  it("normalizes shorthand, full hex, and rgb()", () => {
    expect(toHex("#abc")).toBe("#aabbcc");
    expect(toHex("#1677FF")).toBe("#1677ff");
    expect(toHex("rgb(22, 119, 255)")).toBe("#1677ff");
    expect(toHex("rgba(22,119,255,0.9)")).toBe("#1677ff");
  });
  it("drops faint alpha and junk", () => {
    expect(toHex("rgba(0,0,0,0.2)")).toBeNull();
    expect(toHex("transparent")).toBeNull();
  });
});

describe("extractColorsRanked", () => {
  it("ranks by frequency", () => {
    const html = `<style>a{color:#1677ff}b{color:#1677ff}c{color:#ff0000}</style>`;
    const ranked = extractColorsRanked(html);
    expect(ranked[0]).toBe("#1677ff");
    expect(ranked).toContain("#ff0000");
  });
});

describe("extractThemeColor / name / fonts / host", () => {
  it("reads theme-color meta", () => {
    expect(extractThemeColor(`<meta name="theme-color" content="#0070f3">`)).toBe("#0070f3");
  });
  it("prefers og:site_name then cleans the <title>", () => {
    expect(extractSiteName(`<meta property="og:site_name" content="Acme">`, "https://x.com")).toBe("Acme");
    expect(extractSiteName(`<title>Stripe | Payments</title>`, "https://stripe.com")).toBe("Stripe");
    expect(extractSiteName(`<html></html>`, "https://www.vercel.com/x")).toBe("Vercel");
  });
  it("pulls Google Fonts families + skips generic stacks", () => {
    const html = `<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=Lora">
      <style>body{font-family:-apple-system,sans-serif}</style>`;
    const f = extractFonts(html);
    expect(f.display).toBe("Inter");
    expect(f.body).toBe("Lora");
  });
  it("hostOf strips scheme + www and capitalizes", () => {
    expect(hostOf("https://www.linear.app/features")).toBe("Linear");
  });
});

describe("seedFromSite / brandFromSite", () => {
  const dark = `<meta name="theme-color" content="#5e6ad2">
    <style>body{background:#08090a;color:#f7f8f8}.a{color:#5e6ad2}</style>
    <title>Linear — The issue tracker</title>`;

  it("derives a dark seed with the themed primary", () => {
    const s = seedFromSite(dark);
    expect(s.mode).toBe("dark");
    expect(s.primary).toBe("#5e6ad2");
    expect(s.bg).toBe("#08090a");
  });

  it("builds a coherent named-token brand", () => {
    const ds = brandFromSite(dark, "https://linear.app", "ds-x");
    expect(ds.id).toBe("ds-x");
    expect(ds.name).toBe("Linear");
    expect(ds.builtin).toBe(false);
    expect(ds.colors.find((c) => c.name === "accent")?.value).toBe("#5e6ad2");
    expect(ds.colors.find((c) => c.name === "bg")?.value).toBe("#08090a");
    expect(ds.typography.length).toBeGreaterThan(3);
    expect(ds.spacing?.length).toBeGreaterThan(0);
  });

  it("falls back gracefully on a bare page", () => {
    const ds = brandFromSite(`<html><body>hi</body></html>`, "https://x.io", "ds-y");
    expect(ds.name).toBe("X");
    expect(ds.colors.length).toBeGreaterThan(0);
  });
});
