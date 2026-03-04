/**
 * openvite:og-assets — Copy @vercel/og assets to RSC output.
 *
 * @vercel/og uses readFileSync(new URL("./font.ttf", import.meta.url))
 * which breaks when bundled. This copies the required assets alongside
 * the bundle so they exist at runtime.
 */
import type { Plugin } from "vite";
import type { PluginContext } from "../core/plugin-context.js";
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";

export function ogAssetsPlugin(_ctx: PluginContext): Plugin {
  return {
    name: "openvite:og-assets",
    apply: "build",
    enforce: "post",
    writeBundle: {
      sequential: true,
      order: "post",
      async handler(options) {
        const envName = this.environment?.name;
        if (envName !== "rsc") return;

        const outDir = options.dir;
        if (!outDir) return;

        const indexPath = path.join(outDir, "index.js");
        if (!fs.existsSync(indexPath)) return;

        const content = fs.readFileSync(indexPath, "utf-8");
        const ogAssets = [
          "noto-sans-v27-latin-regular.ttf",
          "resvg.wasm",
        ];

        const referencedAssets = ogAssets.filter(asset => content.includes(asset));
        if (referencedAssets.length === 0) return;

        try {
          const require = createRequire(import.meta.url);
          const ogPkgPath = require.resolve("@vercel/og/package.json");
          const ogDistDir = path.join(path.dirname(ogPkgPath), "dist");

          for (const asset of referencedAssets) {
            const src = path.join(ogDistDir, asset);
            const dest = path.join(outDir, asset);
            if (fs.existsSync(src) && !fs.existsSync(dest)) {
              fs.copyFileSync(src, dest);
            }
          }
        } catch {
          // @vercel/og not installed — nothing to copy
        }
      },
    },
  };
}
