/**
 * openvite:image-config — Write image config JSON for App Router prod server.
 *
 * The App Router RSC entry doesn't export openviteConfig, so we write a
 * separate JSON file at build time for prod-server.ts to read at startup.
 */
import type { Plugin } from "vite";
import type { PluginContext } from "../core/plugin-context.js";
import path from "node:path";
import fs from "node:fs";

export function imageConfigPlugin(ctx: PluginContext): Plugin {
  return {
    name: "openvite:image-config",
    apply: "build",
    enforce: "post",
    writeBundle: {
      sequential: true,
      order: "post",
      handler(options) {
        const envName = this.environment?.name;
        if (envName !== "rsc") return;

        const outDir = options.dir;
        if (!outDir) return;

        const imageConfig = {
          dangerouslyAllowSVG: ctx.nextConfig?.images?.dangerouslyAllowSVG,
          contentDispositionType: ctx.nextConfig?.images?.contentDispositionType,
          contentSecurityPolicy: ctx.nextConfig?.images?.contentSecurityPolicy,
        };

        fs.writeFileSync(
          path.join(outDir, "image-config.json"),
          JSON.stringify(imageConfig),
        );
      },
    },
  };
}
