import { build } from "esbuild";
import { existsSync, rmSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "src");
const DIST = path.join(ROOT, "dist");

// Collect all .ts/.tsx entry points (exclude .d.ts)
function collectEntryPoints(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...collectEntryPoints(full));
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts"))
      results.push(full);
  }
  return results;
}

// Resolve a binary from node_modules/.bin walking up the tree
function findBin(name: string): string {
  let dir = ROOT;
  while (true) {
    const candidate = path.join(dir, "node_modules", ".bin", name);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return name; // fallback to PATH
}

// Clean dist/ and .tsbuildinfo (tsgo is fast enough without incremental)
rmSync(DIST, { recursive: true, force: true });
rmSync(path.join(ROOT, ".tsbuildinfo"), { force: true });

const entryPoints = collectEntryPoints(SRC);

// Prefer tsgo (native TS compiler, ~3x faster) over tsc for declaration emit
const declBin = findBin("tsgo");
const useTsgo = declBin.includes("tsgo");

// Run in parallel: esbuild (JS) + tsgo/tsc (declarations only)
await Promise.all([
  // esbuild: transpile TS → JS + sourcemaps (~100-200ms)
  build({
    entryPoints,
    outdir: DIST,
    outbase: SRC,
    format: "esm",
    target: "es2022",
    platform: "node",
    sourcemap: true,
    jsx: "automatic",
  }),

  // tsgo/tsc: emit .d.ts only with incremental cache
  (async () => {
    const bin = useTsgo ? declBin : findBin("tsc");
    const proc = Bun.spawn([bin, "-p", "tsconfig.build.json"], {
      cwd: ROOT,
      stdio: ["ignore", "inherit", "inherit"],
    });
    const code = await proc.exited;
    if (code !== 0)
      throw new Error(`${useTsgo ? "tsgo" : "tsc"} exited with code ${code}`);
  })(),
]);
