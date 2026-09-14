import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

export function parsePackageTree(text) {
  const packages = new Set();
  for (const line of text.split("\n")) {
    const match = /^([A-Za-z0-9_-]+) v([^\s]+)/.exec(line);
    if (match) packages.add(`${match[1]}@${match[2]}`);
  }
  if (![...packages].some(name => name.startsWith("orion-terminal@"))) {
    throw new Error("Cargo did not produce an Orion dependency tree");
  }
  return packages;
}

export function classifyNativeAudit(report, packages) {
  const settings = report.settings;
  if (report.error || !settings || !Array.isArray(settings.ignore) || settings.ignore.length ||
      settings.severity != null || settings.target_arch?.length || settings.target_os?.length ||
      !["unmaintained", "unsound", "notice"].every(kind => settings.informational_warnings?.includes(kind))) {
    throw new Error("Native audit requires an unfiltered report with no ignored advisories");
  }
  if (!Array.isArray(report.vulnerabilities?.list) || report.vulnerabilities.count !== report.vulnerabilities.list.length) {
    throw new Error("Incomplete Cargo audit report");
  }
  const blocking = [], maintenance = [], notSelected = [];
  function add(finding, kind) {
    const { name, version } = finding.package ?? {};
    const id = finding.advisory?.id;
    if (typeof name !== "string" || typeof version !== "string" || typeof id !== "string") {
      throw new Error("Unrecognized Cargo advisory entry");
    }
    const item = { id, name, version, kind };
    if (!packages.has(`${name}@${version}`)) notSelected.push(item);
    else if (kind === "unmaintained" || kind === "notice") maintenance.push(item);
    else blocking.push(item);
  }
  for (const finding of report.vulnerabilities.list) add(finding, "vulnerability");
  for (const [kind, findings] of Object.entries(report.warnings ?? {})) {
    if (!Array.isArray(findings)) throw new Error("Unrecognized Cargo warning list");
    for (const finding of findings) add(finding, kind);
  }
  return { blocking, maintenance, notSelected };
}

function run(args) {
  const result = spawnSync("cargo", args, {
    cwd: fileURLToPath(new URL("../src-tauri/", import.meta.url)),
    encoding: "utf8", timeout: 120000, maxBuffer: 20000000,
  });
  if (result.error || result.status === null) throw new Error(`cargo ${args[0]} failed or timed out`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [flag, target, ...extra] = process.argv.slice(2);
    if (flag !== "--target" || !/^[A-Za-z0-9_-]{3,100}$/.test(target ?? "") || extra.length) {
      throw new Error("Usage: npm run audit:native:target -- --target aarch64-apple-darwin");
    }
    // cargo metadata over-approximates optional sqlx backends; cargo tree selects
    // the actual feature graph. Keep build dependencies, exclude test-only edges.
    const tree = run(["tree", "--locked", "--color", "never", "--target", target,
      "--features", "tauri/custom-protocol", "--edges", "normal,build", "--prefix", "none", "--format", "{p}"]);
    if (tree.status !== 0) throw new Error("Cargo target dependency resolution failed");
    const packages = parsePackageTree(tree.stdout);
    const audit = run(["audit", "--json"]);
    if (![0, 1].includes(audit.status)) throw new Error("Cargo audit failed before analysis");
    const result = classifyNativeAudit(JSON.parse(audit.stdout), packages);
    console.log(JSON.stringify({
      target, features: ["tauri/custom-protocol"], edges: "normal,build", selectedPackages: packages.size,
      scope: "Known target-graph advisories only; not an application security or release sign-off.",
      ...result,
    }, null, 2));
    process.exitCode = result.blocking.length ? 1 : 0;
  } catch (error) {
    console.error(error instanceof SyntaxError ? "Cargo audit did not return a valid report" : error.message);
    process.exitCode = 2;
  }
}
