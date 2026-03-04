/**
 * openvite:react-canary — Shim React canary/experimental APIs.
 *
 * Provides graceful no-op fallbacks for ViewTransition and addTransitionType
 * that exist in Next.js's bundled React canary but not in stable React 19.
 */
import type { Plugin } from "vite";
import type { PluginContext } from "../core/plugin-context.js";

export function reactCanaryPlugin(_ctx: PluginContext): Plugin {
  return {
    name: "openvite:react-canary",
    enforce: "pre",

    resolveId(id) {
      if (id === "virtual:openvite-react-canary") return "\0virtual:openvite-react-canary";
    },

    load(id) {
      if (id === "\0virtual:openvite-react-canary") {
        return [
          `export * from "react";`,
          `export { default } from "react";`,
          `import * as _React from "react";`,
          `export const ViewTransition = _React.ViewTransition || function ViewTransition({ children }) { return children; };`,
          `export const addTransitionType = _React.addTransitionType || function addTransitionType() {};`,
        ].join("\n");
      }
    },

    transform(code, id) {
      if (id.includes("node_modules")) return null;
      if (id.startsWith("\0")) return null;
      if (!/\.(tsx?|jsx?|mjs)$/.test(id)) return null;

      if (
        !(code.includes("ViewTransition") || code.includes("addTransitionType")) ||
        !/from\s+['"]react['"]/.test(code)
      ) {
        return null;
      }

      const canaryImportRegex = /import\s*\{[^}]*(ViewTransition|addTransitionType)[^}]*\}\s*from\s*['"]react['"]/;
      if (!canaryImportRegex.test(code)) return null;

      const result = code.replace(
        /from\s*['"]react['"]/g,
        'from "virtual:openvite-react-canary"',
      );
      if (result !== code) {
        return { code: result, map: null };
      }
      return null;
    },
  };
}
