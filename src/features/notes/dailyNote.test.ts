import { describe, expect, it } from "vitest";
import { startOfDay, dailyTitle } from "./dailyNote";

describe("startOfDay", () => {
  it("zeroes the time component", () => {
    const noon = new Date(2026, 5, 13, 12, 30, 0).getTime();
    const midnight = new Date(2026, 5, 13, 0, 0, 0, 0).getTime();
    expect(startOfDay(noon)).toBe(midnight);
  });
  it("maps two times on the same day to the same key", () => {
    const a = new Date(2026, 5, 13, 8, 0).getTime();
    const b = new Date(2026, 5, 13, 23, 59).getTime();
    expect(startOfDay(a)).toBe(startOfDay(b));
  });
  it("maps different days to different keys", () => {
    const a = new Date(2026, 5, 13, 23, 59).getTime();
    const b = new Date(2026, 5, 14, 0, 1).getTime();
    expect(startOfDay(a)).not.toBe(startOfDay(b));
  });
});

describe("dailyTitle", () => {
  it("renders a full readable date", () => {
    const title = dailyTitle(new Date(2026, 5, 13));
    expect(title).toContain("2026");
    expect(title).toContain("June");
    expect(title).toContain("13");
  });
});
