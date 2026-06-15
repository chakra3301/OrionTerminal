import { describe, it, expect } from "vitest";
import {
  parseUrl,
  isTerminal,
  nextQueued,
  phaseLabel,
} from "./websiteRip";
import type { WebsiteRipRow } from "./repolensWebsitesDb";

describe("parseUrl", () => {
  it("extracts hostname and normalizes a bare domain", () => {
    expect(parseUrl("example.com")).toEqual({
      url: "https://example.com",
      hostname: "example.com",
    });
  });
  it("keeps an explicit scheme and strips www", () => {
    expect(parseUrl("https://www.stripe.com/pricing")).toEqual({
      url: "https://www.stripe.com/pricing",
      hostname: "stripe.com",
    });
  });
  it("returns null for junk", () => {
    expect(parseUrl("not a url")).toBeNull();
    expect(parseUrl("")).toBeNull();
  });
});

describe("isTerminal", () => {
  it("is true for done/error/cancelled, false for active states", () => {
    expect(isTerminal("done")).toBe(true);
    expect(isTerminal("error")).toBe(true);
    expect(isTerminal("cancelled")).toBe(true);
    expect(isTerminal("running")).toBe(false);
    expect(isTerminal("queued")).toBe(false);
    expect(isTerminal("paused")).toBe(false);
  });
});

describe("nextQueued", () => {
  const row = (id: string, status: WebsiteRipRow["status"]): WebsiteRipRow => ({
    id, url: "https://x", hostname: "x", title: "", status, phase: "",
    project_path: "", thumbnail_path: null, log: "", session_id: null,
    error: null, model: "", design_json: null, design_at: null, created_at: 0, updated_at: 0,
  });
  it("returns null when a rip is already running", () => {
    expect(nextQueued([row("a", "running"), row("b", "queued")])).toBeNull();
  });
  it("returns the oldest queued id when nothing is running", () => {
    expect(nextQueued([row("a", "done"), row("b", "queued"), row("c", "queued")])).toBe("b");
  });
  it("returns null when nothing is queued", () => {
    expect(nextQueued([row("a", "done")])).toBeNull();
  });
});

describe("phaseLabel", () => {
  it("maps known phases to friendly labels and passes through unknown", () => {
    expect(phaseLabel("recon")).toBe("Recon");
    expect(phaseLabel("building")).toBe("Building");
    expect(phaseLabel("")).toBe("Working");
    expect(phaseLabel("foundation")).toBe("Foundation");
  });
});
