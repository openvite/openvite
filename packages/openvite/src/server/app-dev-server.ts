/**
 * App Router entry generators — re-exported from codegen/.
 *
 * This file is kept for backward compatibility; the actual
 * implementations now live in codegen/rsc-entry.ts, codegen/ssr-entry.ts,
 * and codegen/browser-entry.ts.
 */
export { generateRscEntry, type AppRouterConfig } from "../codegen/rsc-entry.js";
export { generateSsrEntry } from "../codegen/ssr-entry.js";
export { generateBrowserEntry } from "../codegen/browser-entry.js";
