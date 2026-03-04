/**
 * PluginContext — shared state passed to every openvite Vite plugin.
 *
 * Created once in the orchestrator (core/plugin.ts) and threaded through
 * each plugin factory function so all plugins share the same resolved
 * configuration without relying on module-level mutable state.
 */
import type { ResolvedNextConfig } from "../config/next-config.js";
import type { PlatformAdapter } from "./platform.js";

export interface PluginContext {
  /** Vite project root (absolute path). */
  root: string;
  /** Absolute path to the pages/ directory. */
  pagesDir: string;
  /** Absolute path to the app/ directory. */
  appDir: string;
  /** Whether app/ directory exists and has route files. */
  hasAppDir: boolean;
  /** Whether pages/ directory exists and has route files. */
  hasPagesDir: boolean;
  /** Resolved next.config.js. */
  nextConfig: ResolvedNextConfig;
  /** Absolute path to middleware.ts/js, or null. */
  middlewarePath: string | null;
  /** Absolute path to instrumentation.ts/js, or null. */
  instrumentationPath: string | null;
  /** Platform adapter (node, cloudflare, nitro). */
  platform: PlatformAdapter;
  /** Absolute path to openvite's shims/ directory. */
  shimsDir: string;
  /** Map of next/* module specifiers to shim file paths. */
  nextShimMap: Record<string, string>;
  /** Resolved path to @vitejs/plugin-rsc, or null. */
  resolvedRscPath: string | null;
  /** Resolved path to @vitejs/plugin-rsc/transforms, or null. */
  resolvedRscTransformsPath: string | null;
}

/**
 * Mutable version used during the config() phase before all values are known.
 * Plugins that run during config() may read partially-initialized fields.
 */
export type MutablePluginContext = {
  -readonly [K in keyof PluginContext]: PluginContext[K];
};

/**
 * Create an empty (uninitialized) mutable context.
 * Fields are populated during the openvite:config plugin's config() hook.
 */
export function createPluginContext(): MutablePluginContext {
  return {
    root: "",
    pagesDir: "",
    appDir: "",
    hasAppDir: false,
    hasPagesDir: false,
    nextConfig: {} as ResolvedNextConfig,
    middlewarePath: null,
    instrumentationPath: null,
    platform: null as any, // set during config()
    shimsDir: "",
    nextShimMap: {},
    resolvedRscPath: null,
    resolvedRscTransformsPath: null,
  };
}
