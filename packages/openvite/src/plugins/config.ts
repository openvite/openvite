/**
 * openvite:config — Main configuration plugin.
 *
 * Resolves project structure (app/pages dirs), loads next.config.js,
 * sets up shim aliases, detects platform, and returns the Vite config.
 */
import type { Plugin, UserConfig, ViteDevServer } from "vite";
import { loadEnv } from "vite";
import type { MutablePluginContext } from "../core/plugin-context.js";
import type { OpenviteOptions } from "../core/types.js";
import {
  VIRTUAL_SERVER_ENTRY,
  RESOLVED_SERVER_ENTRY,
  VIRTUAL_CLIENT_ENTRY,
  RESOLVED_CLIENT_ENTRY,
  VIRTUAL_RSC_ENTRY,
  RESOLVED_RSC_ENTRY,
  VIRTUAL_APP_SSR_ENTRY,
  RESOLVED_APP_SSR_ENTRY,
  VIRTUAL_APP_BROWSER_ENTRY,
  RESOLVED_APP_BROWSER_ENTRY,
  clientOutputConfig,
  clientTreeshakeConfig,
  getNextPublicEnvDefines,
  getViteMajorVersion,
  resolvePostcssStringPlugins,
  hasMdxFiles,
  findFileWithExts,
} from "../core/types.js";
import {
  loadNextConfig,
  resolveNextConfig,
} from "../config/next-config.js";
import { findMiddlewareFile } from "../server/middleware.js";
import { findInstrumentationFile } from "../server/instrumentation.js";
import { detectPlatform } from "../platform/detect.js";
import { detectPackageManager } from "../utils/project.js";
import { generateRscEntry } from "../codegen/rsc-entry.js";
import { generateSsrEntry } from "../codegen/ssr-entry.js";
import { generateBrowserEntry } from "../codegen/browser-entry.js";
import {
  generateServerEntry as generatePagesServerEntry,
  generateClientEntry as generatePagesClientEntry,
} from "../codegen/pages-entry.js";
import { appRouter } from "../routing/app-router.js";
import { scanMetadataFiles } from "../server/metadata-routes.js";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Create the openvite:config plugin.
 *
 * This plugin populates the shared PluginContext during its config() hook
 * and handles virtual module resolution/loading.
 */
export function configPlugin(
  ctx: MutablePluginContext,
  options: OpenviteOptions,
  rscPluginPromise: Promise<Plugin[]> | null,
): Plugin {
  return {
    name: "openvite:config",
    enforce: "pre",

    async config(config, env) {
      ctx.root = config.root ?? process.cwd();

      const mode = env?.mode ?? "development";
      const envDir = config.envDir ?? ctx.root;
      const dotenvVars = loadEnv(mode, envDir, "");
      for (const [key, value] of Object.entries(dotenvVars)) {
        if (process.env[key] === undefined) {
          process.env[key] = value;
        }
      }

      let baseDir: string;
      if (options.appDir) {
        baseDir = path.isAbsolute(options.appDir)
          ? options.appDir
          : path.resolve(ctx.root, options.appDir);
      } else {
        const hasRootApp = fs.existsSync(path.join(ctx.root, "app"));
        const hasRootPages = fs.existsSync(path.join(ctx.root, "pages"));
        const hasSrcApp = fs.existsSync(path.join(ctx.root, "src", "app"));
        const hasSrcPages = fs.existsSync(path.join(ctx.root, "src", "pages"));

        if (hasRootApp || hasRootPages) {
          baseDir = ctx.root;
        } else if (hasSrcApp || hasSrcPages) {
          baseDir = path.join(ctx.root, "src");
        } else {
          baseDir = ctx.root;
        }
      }

      ctx.pagesDir = path.join(baseDir, "pages");
      ctx.appDir = path.join(baseDir, "app");
      ctx.hasPagesDir = fs.existsSync(ctx.pagesDir);
      ctx.hasAppDir = fs.existsSync(ctx.appDir);
      ctx.middlewarePath = findMiddlewareFile(ctx.root);
      ctx.instrumentationPath = findInstrumentationFile(ctx.root);
      ctx.shimsDir = path.resolve(__dirname, "..", "shims");

      const rawConfig = await loadNextConfig(ctx.root);
      ctx.nextConfig = await resolveNextConfig(rawConfig);

      // Detect platform adapter
      const pluginsFlat: any[] = [];
      function flattenPlugins(arr: any[]) {
        for (const p of arr) {
          if (Array.isArray(p)) flattenPlugins(p);
          else if (p) pluginsFlat.push(p);
        }
      }
      flattenPlugins(config.plugins as any[] ?? []);
      ctx.platform = detectPlatform(pluginsFlat);

      const defines = getNextPublicEnvDefines();
      for (const [key, value] of Object.entries(ctx.nextConfig.env)) {
        defines[`process.env.${key}`] = JSON.stringify(value);
      }
      defines["process.env.__NEXT_ROUTER_BASEPATH"] = JSON.stringify(
        ctx.nextConfig.basePath,
      );
      defines["process.env.__OPENVITE_IMAGE_REMOTE_PATTERNS"] = JSON.stringify(
        JSON.stringify(ctx.nextConfig.images?.remotePatterns ?? []),
      );
      defines["process.env.__OPENVITE_IMAGE_DOMAINS"] = JSON.stringify(
        JSON.stringify(ctx.nextConfig.images?.domains ?? []),
      );
      {
        const deviceSizes = ctx.nextConfig.images?.deviceSizes ?? [640, 750, 828, 1080, 1200, 1920, 2048, 3840];
        const imageSizes = ctx.nextConfig.images?.imageSizes ?? [16, 32, 48, 64, 96, 128, 256, 384];
        defines["process.env.__OPENVITE_IMAGE_DEVICE_SIZES"] = JSON.stringify(
          JSON.stringify(deviceSizes),
        );
        defines["process.env.__OPENVITE_IMAGE_SIZES"] = JSON.stringify(
          JSON.stringify(imageSizes),
        );
      }
      defines["process.env.__OPENVITE_IMAGE_DANGEROUSLY_ALLOW_SVG"] = JSON.stringify(
        String(ctx.nextConfig.images?.dangerouslyAllowSVG ?? false),
      );
      defines["process.env.__OPENVITE_DRAFT_SECRET"] = JSON.stringify(
        crypto.randomUUID(),
      );

      // Build shim alias map
      ctx.nextShimMap = {
        "next/link": path.join(ctx.shimsDir, "link"),
        "next/head": path.join(ctx.shimsDir, "head"),
        "next/router": path.join(ctx.shimsDir, "router"),
        "next/compat/router": path.join(ctx.shimsDir, "compat-router"),
        "next/image": path.join(ctx.shimsDir, "image"),
        "next/legacy/image": path.join(ctx.shimsDir, "legacy-image"),
        "next/dynamic": path.join(ctx.shimsDir, "dynamic"),
        "next/app": path.join(ctx.shimsDir, "app"),
        "next/document": path.join(ctx.shimsDir, "document"),
        "next/config": path.join(ctx.shimsDir, "config"),
        "next/script": path.join(ctx.shimsDir, "script"),
        "next/server": path.join(ctx.shimsDir, "server"),
        "next/navigation": path.join(ctx.shimsDir, "navigation"),
        "next/headers": path.join(ctx.shimsDir, "headers"),
        "next/font/google": path.join(ctx.shimsDir, "font-google"),
        "next/font/local": path.join(ctx.shimsDir, "font-local"),
        "next/cache": path.join(ctx.shimsDir, "cache"),
        "next/form": path.join(ctx.shimsDir, "form"),
        "next/og": path.join(ctx.shimsDir, "og"),
        "next/web-vitals": path.join(ctx.shimsDir, "web-vitals"),
        "next/amp": path.join(ctx.shimsDir, "amp"),
        "next/error": path.join(ctx.shimsDir, "error"),
        "next/constants": path.join(ctx.shimsDir, "constants"),
        "next/dist/shared/lib/app-router-context.shared-runtime": path.join(ctx.shimsDir, "internal", "app-router-context"),
        "next/dist/shared/lib/app-router-context": path.join(ctx.shimsDir, "internal", "app-router-context"),
        "next/dist/shared/lib/router-context.shared-runtime": path.join(ctx.shimsDir, "internal", "router-context"),
        "next/dist/shared/lib/utils": path.join(ctx.shimsDir, "internal", "utils"),
        "next/dist/server/api-utils": path.join(ctx.shimsDir, "internal", "api-utils"),
        "next/dist/server/web/spec-extension/cookies": path.join(ctx.shimsDir, "internal", "cookies"),
        "next/dist/compiled/@edge-runtime/cookies": path.join(ctx.shimsDir, "internal", "cookies"),
        "next/dist/server/app-render/work-unit-async-storage.external": path.join(ctx.shimsDir, "internal", "work-unit-async-storage"),
        "next/dist/client/components/work-unit-async-storage.external": path.join(ctx.shimsDir, "internal", "work-unit-async-storage"),
        "next/dist/client/components/request-async-storage.external": path.join(ctx.shimsDir, "internal", "work-unit-async-storage"),
        "next/dist/client/components/request-async-storage": path.join(ctx.shimsDir, "internal", "work-unit-async-storage"),
        "next/dist/client/components/navigation": path.join(ctx.shimsDir, "navigation"),
        "next/dist/server/config-shared": path.join(ctx.shimsDir, "internal", "utils"),
        ...Object.fromEntries(
          Object.entries({
            "next/link": path.join(ctx.shimsDir, "link"),
            "next/head": path.join(ctx.shimsDir, "head"),
            "next/router": path.join(ctx.shimsDir, "router"),
            "next/image": path.join(ctx.shimsDir, "image"),
            "next/dynamic": path.join(ctx.shimsDir, "dynamic"),
            "next/script": path.join(ctx.shimsDir, "script"),
            "next/server": path.join(ctx.shimsDir, "server"),
            "next/navigation": path.join(ctx.shimsDir, "navigation"),
            "next/headers": path.join(ctx.shimsDir, "headers"),
            "next/cache": path.join(ctx.shimsDir, "cache"),
            "next/form": path.join(ctx.shimsDir, "form"),
          }).map(([k, v]) => [k + ".js", v + ".js"]),
        ),
        "server-only": path.join(ctx.shimsDir, "server-only"),
        "client-only": path.join(ctx.shimsDir, "client-only"),
        "openvite/error-boundary": path.join(ctx.shimsDir, "error-boundary"),
        "openvite/layout-segment-context": path.join(ctx.shimsDir, "layout-segment-context"),
        "openvite/metadata": path.join(ctx.shimsDir, "metadata"),
        "openvite/fetch-cache": path.join(ctx.shimsDir, "fetch-cache"),
        "openvite/cache-runtime": path.join(ctx.shimsDir, "cache-runtime"),
        "openvite/navigation-state": path.join(ctx.shimsDir, "navigation-state"),
        "openvite/router-state": path.join(ctx.shimsDir, "router-state"),
        "openvite/head-state": path.join(ctx.shimsDir, "head-state"),
        "openvite/instrumentation": path.resolve(__dirname, "..", "server", "instrumentation"),
        "openvite/html": path.resolve(__dirname, "..", "server", "html"),
      };

      // Resolve PostCSS
      let postcssOverride: { plugins: any[] } | undefined;
      if (!config.css?.postcss || typeof config.css.postcss === "string") {
        postcssOverride = await resolvePostcssStringPlugins(ctx.root);
      }

      // Auto-inject MDX plugin
      const hasMdxPlugin = pluginsFlat.some(
        (p: any) => p && typeof p === "object" && typeof p.name === "string" &&
          (p.name === "@mdx-js/rollup" || p.name === "mdx"),
      );
      const mdxPlugins: any[] = [];
      if (!hasMdxPlugin && hasMdxFiles(ctx.root, ctx.hasAppDir ? ctx.appDir : null, ctx.hasPagesDir ? ctx.pagesDir : null)) {
        try {
          const mdxRollup = await import("@mdx-js/rollup");
          const mdxPlugin = mdxRollup.default ?? mdxRollup;
          const mdxOpts: Record<string, unknown> = {};
          if (ctx.nextConfig.mdx) {
            if (ctx.nextConfig.mdx.remarkPlugins) mdxOpts.remarkPlugins = ctx.nextConfig.mdx.remarkPlugins;
            if (ctx.nextConfig.mdx.rehypePlugins) mdxOpts.rehypePlugins = ctx.nextConfig.mdx.rehypePlugins;
            if (ctx.nextConfig.mdx.recmaPlugins) mdxOpts.recmaPlugins = ctx.nextConfig.mdx.recmaPlugins;
          }
          mdxPlugins.push(mdxPlugin(mdxOpts));
          if (ctx.nextConfig.mdx) {
            console.log("[openvite] Auto-injected @mdx-js/rollup with remark/rehype plugins from next.config");
          } else {
            console.log("[openvite] Auto-injected @mdx-js/rollup for MDX support");
          }
        } catch {
          console.warn(
            "[openvite] MDX files detected but @mdx-js/rollup is not installed. " +
            "Install it with: " + detectPackageManager(process.cwd()) + " @mdx-js/rollup"
          );
        }
      }

      const isSSR = !!config.build?.ssr;
      const isMultiEnv = ctx.hasAppDir || ctx.platform.bundlesAllDeps;

      const viteConfig: UserConfig = {
        appType: "custom",
        build: {
          rollupOptions: {
            onwarn: (() => {
              const userOnwarn = config.build?.rollupOptions?.onwarn;
              return (warning: any, defaultHandler: any) => {
                if (
                  warning.code === "MODULE_LEVEL_DIRECTIVE" &&
                  (warning.message?.includes('"use client"') ||
                    warning.message?.includes('"use server"'))
                ) {
                  return;
                }
                if (userOnwarn) {
                  userOnwarn(warning, defaultHandler);
                } else {
                  defaultHandler(warning);
                }
              };
            })(),
            ...(!isSSR && !isMultiEnv ? { treeshake: clientTreeshakeConfig } : {}),
            ...(!isSSR && !isMultiEnv ? { output: clientOutputConfig } : {}),
          },
        },
        server: {
          cors: {
            preflightContinue: true,
            origin: /^https?:\/\/(?:(?:[^:]+\.)?localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/,
          },
        },
        ...(ctx.platform.bundlesAllDeps ? {} : {
          ssr: {
            external: ["react", "react-dom", "react-dom/server"],
          },
        }),
        resolve: {
          alias: ctx.nextShimMap,
          dedupe: [
            "react",
            "react-dom",
            "react/jsx-runtime",
            "react/jsx-dev-runtime",
          ],
        },
        optimizeDeps: {
          exclude: ["openvite"],
        },
        ...(getViteMajorVersion() >= 8
          ? { oxc: { jsx: { runtime: "automatic" } } }
          : { esbuild: { jsx: "automatic" } }),
        define: defines,
        ...(ctx.nextConfig.basePath ? { base: ctx.nextConfig.basePath + "/" } : {}),
        ...(postcssOverride ? { css: { postcss: postcssOverride } } : {}),
      };

      // Configure RSC environments for App Router
      if (ctx.hasAppDir) {
        const relAppDir = path.relative(ctx.root, ctx.appDir);
        const appEntries = [
          `${relAppDir}/**/*.{tsx,ts,jsx,js}`,
        ];

        const userNoExternal = config.ssr?.noExternal;
        const rscResolve: Record<string, any> = {};
        const externals = ctx.platform.rscExternals();
        if (externals.length) {
          rscResolve.external = externals;
        }
        if (userNoExternal) {
          rscResolve.noExternal = userNoExternal;
        }

        viteConfig.environments = {
          rsc: {
            ...(Object.keys(rscResolve).length > 0 ? { resolve: rscResolve } : {}),
            optimizeDeps: {
              exclude: ["openvite"],
              entries: appEntries,
            },
            build: {
              outDir: "dist/server",
              rollupOptions: {
                input: { index: VIRTUAL_RSC_ENTRY },
              },
            },
          },
          ssr: {
            optimizeDeps: {
              exclude: ["openvite"],
              entries: appEntries,
            },
            build: {
              outDir: "dist/server/ssr",
              rollupOptions: {
                input: { index: VIRTUAL_APP_SSR_ENTRY },
              },
            },
          },
          client: {
            optimizeDeps: {
              exclude: ["openvite"],
              include: [
                "react",
                "react-dom",
                "react-dom/client",
                "react/jsx-runtime",
                "react/jsx-dev-runtime",
              ],
            },
            build: {
              ...(ctx.platform.needsClientManifest ? { manifest: true } : {}),
              rollupOptions: {
                input: { index: VIRTUAL_APP_BROWSER_ENTRY },
                output: clientOutputConfig,
                treeshake: clientTreeshakeConfig,
              },
            },
          },
        };
      } else if (ctx.platform.needsClientManifest) {
        viteConfig.environments = {
          client: {
            build: {
              manifest: true,
              ssrManifest: true,
              rollupOptions: {
                input: { index: VIRTUAL_CLIENT_ENTRY },
                output: clientOutputConfig,
                treeshake: clientTreeshakeConfig,
              },
            },
          },
        };
      }

      if (mdxPlugins.length > 0) {
        viteConfig.plugins = mdxPlugins;
      }

      return viteConfig;
    },

    configResolved(config) {
      if (rscPluginPromise) {
        const rscRootPlugins = config.plugins.filter(
          (p: any) => p && p.name === "rsc",
        );
        if (rscRootPlugins.length > 1) {
          throw new Error(
            "[openvite] Duplicate @vitejs/plugin-rsc detected.\n" +
            "         openvite auto-registers @vitejs/plugin-rsc when app/ is detected.\n" +
            "         Your config also registers it manually, which doubles build time.\n\n" +
            "         Fix: remove the explicit rsc() call from your plugins array.\n" +
            "         Or: pass rsc: false to openvite() if you want to configure rsc() yourself.",
          );
        }
      }
    },

    resolveId: {
      filter: {
        id: /(?:next\/|virtual:openvite-)/,
      },
      handler(id) {
        const cleanId = id.startsWith("\0") ? id.slice(1) : id;

        if (cleanId.startsWith("next/") && cleanId.endsWith(".js")) {
          const withoutExt = cleanId.slice(0, -3);
          if (ctx.nextShimMap[withoutExt]) {
            const shimPath = ctx.nextShimMap[withoutExt];
            return shimPath.endsWith(".js") ? shimPath : shimPath + ".js";
          }
        }

        if (cleanId === VIRTUAL_SERVER_ENTRY) return RESOLVED_SERVER_ENTRY;
        if (cleanId === VIRTUAL_CLIENT_ENTRY) return RESOLVED_CLIENT_ENTRY;
        if (cleanId.endsWith("/" + VIRTUAL_SERVER_ENTRY) || cleanId.endsWith("\\" + VIRTUAL_SERVER_ENTRY)) {
          return RESOLVED_SERVER_ENTRY;
        }
        if (cleanId.endsWith("/" + VIRTUAL_CLIENT_ENTRY) || cleanId.endsWith("\\" + VIRTUAL_CLIENT_ENTRY)) {
          return RESOLVED_CLIENT_ENTRY;
        }
        if (cleanId === VIRTUAL_RSC_ENTRY) return RESOLVED_RSC_ENTRY;
        if (cleanId === VIRTUAL_APP_SSR_ENTRY) return RESOLVED_APP_SSR_ENTRY;
        if (cleanId === VIRTUAL_APP_BROWSER_ENTRY) return RESOLVED_APP_BROWSER_ENTRY;
        if (cleanId.endsWith("/" + VIRTUAL_RSC_ENTRY) || cleanId.endsWith("\\" + VIRTUAL_RSC_ENTRY)) {
          return RESOLVED_RSC_ENTRY;
        }
        if (cleanId.endsWith("/" + VIRTUAL_APP_SSR_ENTRY) || cleanId.endsWith("\\" + VIRTUAL_APP_SSR_ENTRY)) {
          return RESOLVED_APP_SSR_ENTRY;
        }
        if (cleanId.endsWith("/" + VIRTUAL_APP_BROWSER_ENTRY) || cleanId.endsWith("\\" + VIRTUAL_APP_BROWSER_ENTRY)) {
          return RESOLVED_APP_BROWSER_ENTRY;
        }
      },
    },

    async load(id) {
      if (id === RESOLVED_SERVER_ENTRY) {
        return await generatePagesServerEntry(ctx);
      }
      if (id === RESOLVED_CLIENT_ENTRY) {
        return await generatePagesClientEntry(ctx);
      }
      if (id === RESOLVED_RSC_ENTRY && ctx.hasAppDir) {
        const routes = await appRouter(ctx.appDir);
        const metaRoutes = scanMetadataFiles(ctx.appDir);
        const globalErrorPath = findFileWithExts(ctx.appDir, "global-error");
        return generateRscEntry(ctx.appDir, routes, ctx.middlewarePath, metaRoutes, globalErrorPath, ctx.nextConfig?.basePath, ctx.nextConfig?.trailingSlash, {
          redirects: ctx.nextConfig?.redirects,
          rewrites: ctx.nextConfig?.rewrites,
          headers: ctx.nextConfig?.headers,
          allowedOrigins: ctx.nextConfig?.serverActionsAllowedOrigins,
          allowedDevOrigins: ctx.nextConfig?.serverActionsAllowedOrigins,
        });
      }
      if (id === RESOLVED_APP_SSR_ENTRY && ctx.hasAppDir) {
        return generateSsrEntry();
      }
      if (id === RESOLVED_APP_BROWSER_ENTRY && ctx.hasAppDir) {
        return generateBrowserEntry();
      }
    },
  };
}
