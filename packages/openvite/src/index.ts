/**
 * openvite — Run Next.js apps on Vite.
 *
 * This is the public entry point. It re-exports the plugin factory
 * (default export) and all public symbols from the modular internals.
 */

// ─── Default export: the Vite plugin factory ─────────────────────────────────
export { default } from "./core/plugin.js";

// ─── Public types ────────────────────────────────────────────────────────────
export type { OpenviteOptions } from "./core/types.js";

// ─── Build utilities (used by CLI, tests, and prod-server) ──────────────────
export {
  clientManualChunks,
  clientOutputConfig,
  clientTreeshakeConfig,
  computeLazyChunks,
  resolvePostcssStringPlugins as _resolvePostcssStringPlugins,
  matchConfigPattern,
} from "./core/types.js";

// ─── parseStaticObjectLiteral (exported for testing with parseAst bound) ────
import { parseStaticObjectLiteral as _parseStaticObjectLiteralRaw } from "./core/types.js";
import { parseAst } from "vite";

/**
 * Wrapper that binds Vite's parseAst so callers don't need to pass it.
 * Preserves the original export signature for backward compatibility.
 */
export function _parseStaticObjectLiteral(objectStr: string): Record<string, unknown> | null {
  return _parseStaticObjectLiteralRaw(objectStr, parseAst);
}

// ─── Static export ──────────────────────────────────────────────────────────
export { staticExportPages, staticExportApp } from "./build/static-export.js";
export type { StaticExportResult, StaticExportOptions, AppStaticExportOptions } from "./build/static-export.js";
