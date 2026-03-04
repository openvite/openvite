/**
 * Core types, constants, and shared build configuration for openvite.
 *
 * Extracted from the monolithic index.ts to enable composition by
 * individual plugin modules and the orchestrator.
 */
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// ─── Public options ─────────────────────────────────────────────────────────

export interface OpenviteOptions {
  /**
   * Base directory containing the app/ and pages/ directories.
   * Can be an absolute path or a path relative to the Vite root.
   *
   * By default, openvite auto-detects: checks for app/ and pages/ at the
   * project root first, then falls back to src/app/ and src/pages/.
   */
  appDir?: string;
  /**
   * Auto-register @vitejs/plugin-rsc when an app/ directory is detected.
   * Set to `false` to disable auto-registration (e.g. if you configure
   * @vitejs/plugin-rsc manually with custom options).
   * @default true
   */
  rsc?: boolean;
}

// ─── Virtual module IDs ─────────────────────────────────────────────────────

/** Pages Router production build - server entry */
export const VIRTUAL_SERVER_ENTRY = "virtual:openvite-server-entry";
export const RESOLVED_SERVER_ENTRY = "\0" + VIRTUAL_SERVER_ENTRY;

/** Pages Router production build - client entry */
export const VIRTUAL_CLIENT_ENTRY = "virtual:openvite-client-entry";
export const RESOLVED_CLIENT_ENTRY = "\0" + VIRTUAL_CLIENT_ENTRY;

/** App Router entries */
export const VIRTUAL_RSC_ENTRY = "virtual:openvite-rsc-entry";
export const RESOLVED_RSC_ENTRY = "\0" + VIRTUAL_RSC_ENTRY;
export const VIRTUAL_APP_SSR_ENTRY = "virtual:openvite-app-ssr-entry";
export const RESOLVED_APP_SSR_ENTRY = "\0" + VIRTUAL_APP_SSR_ENTRY;
export const VIRTUAL_APP_BROWSER_ENTRY = "virtual:openvite-app-browser-entry";
export const RESOLVED_APP_BROWSER_ENTRY = "\0" + VIRTUAL_APP_BROWSER_ENTRY;

/** Image file extensions handled by the openvite:image-imports plugin. */
export const IMAGE_EXTS = "png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?";

// ─── Build chunk configuration ─────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Extract the npm package name from a module ID (file path).
 * Returns null if not in node_modules.
 *
 * Handles scoped packages (@org/pkg) and pnpm-style paths
 * (node_modules/.pnpm/pkg@ver/node_modules/pkg).
 */
function getPackageName(id: string): string | null {
  const nmIdx = id.lastIndexOf("node_modules/");
  if (nmIdx === -1) return null;
  const rest = id.slice(nmIdx + "node_modules/".length);
  if (rest.startsWith("@")) {
    // Scoped package: @org/pkg
    const parts = rest.split("/");
    return parts.length >= 2 ? parts[0] + "/" + parts[1] : null;
  }
  return rest.split("/")[0] || null;
}

/** Absolute path to openvite's shims directory, used by clientManualChunks. */
const _shimsDir = path.resolve(__dirname, "..", "shims").replace(/\\/g, "/") + "/";

/**
 * manualChunks function for client builds.
 *
 * Splits the client bundle into:
 * - "framework" — React, ReactDOM, and scheduler (loaded on every page)
 * - "openvite"    — openvite shims (router, head, link, etc.)
 */
export function clientManualChunks(id: string): string | undefined {
  if (id.includes("node_modules")) {
    const pkg = getPackageName(id);
    if (!pkg) return undefined;
    if (
      pkg === "react" ||
      pkg === "react-dom" ||
      pkg === "scheduler"
    ) {
      return "framework";
    }
    return undefined;
  }
  if (id.startsWith(_shimsDir)) {
    return "openvite";
  }
  return undefined;
}

/**
 * Rollup output config with manualChunks for client code-splitting.
 */
export const clientOutputConfig = {
  manualChunks: clientManualChunks,
  experimentalMinChunkSize: 10_000,
};

/**
 * Rollup treeshake configuration for production client builds.
 */
export const clientTreeshakeConfig = {
  preset: "recommended" as const,
  moduleSideEffects: "no-external" as const,
};

/**
 * Compute the set of chunk filenames that are ONLY reachable through dynamic
 * imports (i.e. behind React.lazy(), next/dynamic, or manual import()).
 */
export function computeLazyChunks(
  buildManifest: Record<string, {
    file: string;
    isEntry?: boolean;
    isDynamicEntry?: boolean;
    imports?: string[];
    dynamicImports?: string[];
    css?: string[];
  }>
): string[] {
  const eagerFiles = new Set<string>();
  const visited = new Set<string>();
  const queue: string[] = [];

  for (const key of Object.keys(buildManifest)) {
    const chunk = buildManifest[key];
    if (chunk.isEntry) {
      queue.push(key);
    }
  }

  while (queue.length > 0) {
    const key = queue.shift()!;
    if (visited.has(key)) continue;
    visited.add(key);

    const chunk = buildManifest[key];
    if (!chunk) continue;

    eagerFiles.add(chunk.file);

    if (chunk.css) {
      for (const cssFile of chunk.css) {
        eagerFiles.add(cssFile);
      }
    }

    if (chunk.imports) {
      for (const imp of chunk.imports) {
        if (!visited.has(imp)) {
          queue.push(imp);
        }
      }
    }
  }

  const lazyChunks: string[] = [];
  const allFiles = new Set<string>();
  for (const key of Object.keys(buildManifest)) {
    const chunk = buildManifest[key];
    if (chunk.file && !allFiles.has(chunk.file)) {
      allFiles.add(chunk.file);
      if (!eagerFiles.has(chunk.file) && chunk.file.endsWith(".js")) {
        lazyChunks.push(chunk.file);
      }
    }
  }

  return lazyChunks;
}

// ─── Utility functions ──────────────────────────────────────────────────────

/**
 * Detect Vite major version at runtime by resolving from cwd.
 */
export function getViteMajorVersion(): number {
  try {
    const require = createRequire(path.join(process.cwd(), "package.json"));
    const vitePkg = require("vite/package.json");
    return parseInt(vitePkg.version, 10);
  } catch {
    return 7;
  }
}

/**
 * Collect all NEXT_PUBLIC_* env vars and create Vite define entries.
 */
export function getNextPublicEnvDefines(): Record<string, string> {
  const defines: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("NEXT_PUBLIC_") && value !== undefined) {
      defines[`process.env.${key}`] = JSON.stringify(value);
    }
  }
  return defines;
}

/** PostCSS config file names to search for, in priority order. */
export const POSTCSS_CONFIG_FILES = [
  "postcss.config.js",
  "postcss.config.cjs",
  "postcss.config.mjs",
  "postcss.config.ts",
  "postcss.config.cts",
  "postcss.config.mts",
  ".postcssrc",
  ".postcssrc.js",
  ".postcssrc.cjs",
  ".postcssrc.mjs",
  ".postcssrc.ts",
  ".postcssrc.cts",
  ".postcssrc.mts",
  ".postcssrc.json",
  ".postcssrc.yaml",
  ".postcssrc.yml",
];

/**
 * Resolve PostCSS string plugin names in a project's PostCSS config.
 */
export async function resolvePostcssStringPlugins(
  projectRoot: string,
): Promise<{ plugins: any[] } | undefined> {
  const { pathToFileURL } = await import("node:url");
  let configPath: string | null = null;
  for (const name of POSTCSS_CONFIG_FILES) {
    const candidate = path.join(projectRoot, name);
    if (fs.existsSync(candidate)) {
      configPath = candidate;
      break;
    }
  }
  if (!configPath) return undefined;

  let config: any;
  try {
    if (configPath.endsWith(".json") || configPath.endsWith(".yaml") || configPath.endsWith(".yml")) {
      return undefined;
    }
    if (configPath.endsWith(".postcssrc")) {
      const content = fs.readFileSync(configPath, "utf-8").trim();
      if (content.startsWith("{")) {
        return undefined;
      }
    }
    const mod = await import(pathToFileURL(configPath).href);
    config = mod.default ?? mod;
  } catch {
    return undefined;
  }

  if (!config || !Array.isArray(config.plugins)) return undefined;
  const hasStringPlugins = config.plugins.some(
    (p: any) =>
      typeof p === "string" ||
      (Array.isArray(p) && typeof p[0] === "string"),
  );
  if (!hasStringPlugins) return undefined;

  const req = createRequire(path.join(projectRoot, "package.json"));
  const resolved = await Promise.all(
    config.plugins.filter(Boolean).map(async (plugin: any) => {
      if (typeof plugin === "string") {
        const resolved = req.resolve(plugin);
        const mod = await import(pathToFileURL(resolved).href);
        const fn = mod.default ?? mod;
        return typeof fn === "function" ? fn() : fn;
      }
      if (Array.isArray(plugin) && typeof plugin[0] === "string") {
        const [name, options] = plugin;
        const resolved = req.resolve(name);
        const mod = await import(pathToFileURL(resolved).href);
        const fn = mod.default ?? mod;
        return typeof fn === "function" ? fn(options) : fn;
      }
      return plugin;
    }),
  );

  return { plugins: resolved };
}

/**
 * Safely parse a static JS object literal string into a plain object.
 * Uses Vite's parseAst (Rollup/acorn) so no code is ever evaluated.
 *
 * @param objectStr - The JS object literal string to parse.
 * @param parseAst  - Vite's parseAst function (passed to avoid import at module level).
 */
export function parseStaticObjectLiteral(
  objectStr: string,
  parseAst: (code: string) => any,
): Record<string, unknown> | null {
  let ast: any;
  try {
    ast = parseAst(`(${objectStr})`);
  } catch {
    return null;
  }

  const body = ast.body;
  if (body.length !== 1 || body[0].type !== "ExpressionStatement") return null;

  const expr = body[0].expression;
  if (expr.type !== "ObjectExpression") return null;

  const result = extractStaticValue(expr);
  return result === undefined ? null : (result as Record<string, unknown>);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractStaticValue(node: any): unknown {
  switch (node.type) {
    case "Literal":
      return node.value;

    case "UnaryExpression":
      if (node.operator === "-" && node.argument?.type === "Literal" && typeof node.argument.value === "number") {
        return -node.argument.value;
      }
      return undefined;

    case "ArrayExpression": {
      const arr: unknown[] = [];
      for (const elem of node.elements) {
        if (!elem) return undefined;
        const val = extractStaticValue(elem);
        if (val === undefined) return undefined;
        arr.push(val);
      }
      return arr;
    }

    case "ObjectExpression": {
      const obj: Record<string, unknown> = {};
      for (const prop of node.properties) {
        if (prop.type !== "Property") return undefined;
        if (prop.computed) return undefined;

        let key: string;
        if (prop.key.type === "Identifier") {
          key = prop.key.name;
        } else if (prop.key.type === "Literal" && typeof prop.key.value === "string") {
          key = prop.key.value;
        } else {
          return undefined;
        }

        const val = extractStaticValue(prop.value);
        if (val === undefined) return undefined;
        obj[key] = val;
      }
      return obj;
    }

    default:
      return undefined;
  }
}

/**
 * Match a Next.js config pattern against a pathname.
 * Supports :param, :param*, :param+, and inline regex groups.
 */
export function matchConfigPattern(
  pathname: string,
  pattern: string,
): Record<string, string> | null {
  if (
    pattern.includes("(") ||
    pattern.includes("\\") ||
    /:[\w-]+[*+][^/]/.test(pattern) ||
    /:[\w-]+\./.test(pattern)
  ) {
    try {
      const paramNames: string[] = [];
      let regexStr = "";
      const tokenRe = /:([\w-]+)|[.]|[^:.]+/g;
      let tok: RegExpExecArray | null;
      while ((tok = tokenRe.exec(pattern)) !== null) {
        if (tok[1] !== undefined) {
          const name = tok[1];
          const rest = pattern.slice(tokenRe.lastIndex);
          if (rest.startsWith("*") || rest.startsWith("+")) {
            const quantifier = rest[0];
            tokenRe.lastIndex += 1;
            const constraint = extractConstraint(pattern, tokenRe);
            paramNames.push(name);
            if (constraint !== null) {
              regexStr += `(${constraint})`;
            } else {
              regexStr += quantifier === "*" ? "(.*)" : "(.+)";
            }
          } else {
            const constraint = extractConstraint(pattern, tokenRe);
            paramNames.push(name);
            regexStr += constraint !== null ? `(${constraint})` : "([^/]+)";
          }
        } else if (tok[0] === ".") {
          regexStr += "\\.";
        } else {
          regexStr += tok[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        }
      }
      const re = new RegExp(`^${regexStr}$`);
      const m = pathname.match(re);
      if (!m) return null;
      const params: Record<string, string> = {};
      paramNames.forEach((name, i) => {
        params[name] = m[i + 1] ?? "";
      });
      return params;
    } catch {
      return null;
    }
  }

  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);
  const params: Record<string, string> = {};

  let pi = 0;
  for (let i = 0; i < patternParts.length; i++) {
    const part = patternParts[i];
    if (part.startsWith(":")) {
      const name = part.replace(/^:/, "").replace(/[*+]$/, "");
      if (part.endsWith("*")) {
        params[name] = pathParts.slice(pi).join("/");
        return params;
      }
      if (part.endsWith("+")) {
        if (pi >= pathParts.length) return null;
        params[name] = pathParts.slice(pi).join("/");
        return params;
      }
      if (pi >= pathParts.length) return null;
      params[name] = pathParts[pi];
      pi++;
    } else {
      if (pi >= pathParts.length || pathParts[pi] !== part) return null;
      pi++;
    }
  }

  if (pi !== pathParts.length) return null;
  return params;
}

function extractConstraint(str: string, re: RegExp): string | null {
  if (str[re.lastIndex] !== "(") return null;
  const start = re.lastIndex + 1;
  let depth = 1;
  let i = start;
  while (i < str.length && depth > 0) {
    if (str[i] === "(") depth++;
    else if (str[i] === ")") depth--;
    i++;
  }
  if (depth !== 0) return null;
  re.lastIndex = i;
  return str.slice(start, i - 1);
}

/**
 * Check if a directory tree contains any .mdx files.
 */
export function hasMdxFiles(root: string, appDir: string | null, pagesDir: string | null): boolean {
  const dirs: string[] = [];
  if (appDir) dirs.push(appDir);
  if (pagesDir) dirs.push(pagesDir);
  if (dirs.length === 0) dirs.push(root);
  return dirs.some((d) => scanDirForMdx(d));
}

function scanDirForMdx(dir: string): boolean {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (scanDirForMdx(full)) return true;
      } else if (entry.isFile() && entry.name.endsWith(".mdx")) {
        return true;
      }
    }
  } catch {
    // ignore unreadable dirs
  }
  return false;
}

/**
 * Find a file with any of the standard extensions (.tsx, .ts, .jsx, .js).
 */
export function findFileWithExts(dir: string, name: string): string | null {
  for (const ext of [".tsx", ".ts", ".jsx", ".js"]) {
    const p = path.join(dir, name + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
