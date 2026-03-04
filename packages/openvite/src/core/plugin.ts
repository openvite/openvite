/**
 * Plugin orchestrator — composes all openvite plugins into a single Plugin[].
 *
 * This is the main entry point that replaces the monolithic index.ts.
 * Creates a shared PluginContext and passes it to each plugin factory.
 */
import type { Plugin } from "vite";
import type { OpenviteOptions } from "./types.js";
import { VIRTUAL_RSC_ENTRY, VIRTUAL_APP_SSR_ENTRY, VIRTUAL_APP_BROWSER_ENTRY } from "./types.js";
import { createPluginContext } from "./plugin-context.js";
import { configPlugin } from "../plugins/config.js";
import { reactCanaryPlugin } from "../plugins/react-canary.js";
import { pagesRouterPlugin } from "../plugins/pages-router.js";
import { imageImportsPlugin } from "../plugins/image-imports.js";
import { googleFontsPlugin } from "../plugins/google-fonts.js";
import { localFontsPlugin } from "../plugins/local-fonts.js";
import { useCachePlugin } from "../plugins/use-cache.js";
import { ogAssetsPlugin } from "../plugins/og-assets.js";
import { imageConfigPlugin } from "../plugins/image-config.js";
import { platformBuildPlugin } from "../plugins/platform-build.js";
import tsconfigPaths from "vite-tsconfig-paths";
import commonjs from "vite-plugin-commonjs";
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { detectPackageManager } from "../utils/project.js";

export default function openvite(options: OpenviteOptions = {}): Plugin[] {
  const ctx = createPluginContext();

  // ── Early RSC detection ────────────────────────────────────────────────
  const autoRsc = options.rsc !== false;
  const earlyBaseDir = options.appDir ?? process.cwd();
  const earlyAppDirExists =
    fs.existsSync(path.join(earlyBaseDir, "app")) ||
    fs.existsSync(path.join(earlyBaseDir, "src", "app"));

  const earlyRequire = createRequire(path.join(earlyBaseDir, "package.json"));
  let resolvedRscPath: string | null = null;
  let resolvedRscTransformsPath: string | null = null;
  try {
    resolvedRscPath = earlyRequire.resolve("@vitejs/plugin-rsc");
    resolvedRscTransformsPath = earlyRequire.resolve("@vitejs/plugin-rsc/transforms");
  } catch {
    // @vitejs/plugin-rsc not installed
  }
  ctx.resolvedRscPath = resolvedRscPath;
  ctx.resolvedRscTransformsPath = resolvedRscTransformsPath;

  let rscPluginPromise: Promise<Plugin[]> | null = null;
  if (earlyAppDirExists && autoRsc) {
    if (!resolvedRscPath) {
      throw new Error(
        "openvite: App Router detected but @vitejs/plugin-rsc is not installed.\n" +
        "Run: " + detectPackageManager(process.cwd()) + " @vitejs/plugin-rsc",
      );
    }
    const rscImport = import(pathToFileURL(resolvedRscPath).href);
    rscPluginPromise = rscImport
      .then((mod) => {
        const rsc = mod.default;
        return rsc({
          entries: {
            rsc: VIRTUAL_RSC_ENTRY,
            ssr: VIRTUAL_APP_SSR_ENTRY,
            client: VIRTUAL_APP_BROWSER_ENTRY,
          },
        });
      });
  }

  // ── Compose plugins ─────────────────────────────────────────────────────
  const plugins: (Plugin | Promise<Plugin[]>)[] = [
    tsconfigPaths(),
    commonjs(),
    configPlugin(ctx, options, rscPluginPromise),
    reactCanaryPlugin(ctx),
    pagesRouterPlugin(ctx),
    imageImportsPlugin(ctx),
    googleFontsPlugin(ctx),
    localFontsPlugin(ctx),
    useCachePlugin(ctx),
    ogAssetsPlugin(ctx),
    imageConfigPlugin(ctx),
    platformBuildPlugin(ctx),
  ];

  if (rscPluginPromise) {
    plugins.push(rscPluginPromise);
  }

  return plugins as Plugin[];
}
