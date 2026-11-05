import { readdirSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Components that set the image lock themselves grey the workspace or leave it locked; the runtime
// decides which work is quiet (see docs/architecture/xdesign/photoshop-parity.md, section 1).
it("leaves the image lock to the runtime", () => {
  const dir = "src/apps/xdesign/photo";
  for (const file of readdirSync(dir).filter(name => /\.tsx?$/.test(name) && !name.includes(".test.") && name !== "runtime.ts")) {
    const source = readFileSync(`${dir}/${file}`, "utf8");
    expect(source, file).not.toMatch(/usePhotoWorkspace\.setState\(\s*(?:\(?\s*\w*\s*\)?\s*=>\s*\(?)?\{[^}]*\b(?:busy|quiet)\s*:/);
  }
});
