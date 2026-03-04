/**
 * openvite:platform-build — Post-build hook that delegates to the platform adapter.
 *
 * After all environments are built, computes lazy chunks from the client
 * build manifest and delegates platform-specific work (e.g., injecting
 * globals into worker entries) to ctx.platform.onBuildComplete().
 */
import type { Plugin } from "vite";
import type { PluginContext } from "../core/plugin-context.js";
import path from "node:path";
import fs from "node:fs";

export function platformBuildPlugin(ctx: PluginContext): Plugin {
  return {
    name: "openvite:platform-build",
    apply: "build",
    enforce: "post",
    closeBundle: {
      sequential: true,
      order: "post",
      async handler() {
        const envName = this.environment?.name;
        if (!envName || !ctx.platform.needsClientManifest) return;
        if (envName !== "client") return;

        const envConfig = this.environment?.config;
        if (!envConfig) return;

        if (ctx.platform.onBuildComplete) {
          const buildRoot = envConfig.root ?? process.cwd();
          const distDir = path.resolve(buildRoot, "dist");
          if (!fs.existsSync(distDir)) return;

          await ctx.platform.onBuildComplete({
            root: buildRoot,
            distDir,
            hasAppDir: ctx.hasAppDir,
            envConfig,
          });
        }
      },
    },
  };
}
