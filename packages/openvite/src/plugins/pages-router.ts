/**
 * openvite:pages-router — HMR, file watching, and dev server middleware
 * for the Pages Router.
 */
import type { Plugin, ViteDevServer } from "vite";
import type { PluginContext } from "../core/plugin-context.js";
import type { RequestContext } from "../config/config-matchers.js";
import {
  VIRTUAL_RSC_ENTRY,
  RESOLVED_RSC_ENTRY,
} from "../core/types.js";
import { pagesRouter, apiRouter, invalidateRouteCache, matchRoute } from "../routing/pages-router.js";
import { invalidateAppRouteCache } from "../routing/app-router.js";
import { createSSRHandler } from "../server/dev-server.js";
import { handleApiRoute } from "../server/api-handler.js";
import { runMiddleware } from "../server/middleware.js";
import { validateDevRequest } from "../server/dev-origin-check.js";
import { normalizePath } from "../server/normalize-path.js";
import { runInstrumentation } from "../server/instrumentation.js";
import {
  isExternalUrl,
  parseCookies,
  matchHeaders,
  matchRedirect,
  matchRewrite,
} from "../config/config-matchers.js";
import type { NextRedirect, NextRewrite, NextHeader } from "../config/next-config.js";
import type { IncomingMessage, ServerResponse } from "node:http";

// ─── Redirect / Rewrite / Header helpers ────────────────────────────────────

function applyHeaders(
  pathname: string,
  res: ServerResponse,
  headers: NextHeader[],
  reqCtx: RequestContext,
) {
  const matched = matchHeaders(pathname, headers, reqCtx);
  for (const hdr of matched) {
    res.setHeader(hdr.key, hdr.value);
  }
}

function applyRedirects(
  pathname: string,
  res: ServerResponse,
  redirects: NextRedirect[],
  reqCtx: RequestContext,
): boolean {
  const dest = matchRedirect(pathname, redirects, reqCtx);
  if (dest) {
    res.writeHead(dest.permanent ? 308 : 307, {
      Location: dest.destination,
    });
    res.end();
    return true;
  }
  return false;
}

function applyRewrites(
  pathname: string,
  rewrites: NextRewrite[],
  reqCtx: RequestContext,
): string | null {
  return matchRewrite(pathname, rewrites, reqCtx);
}

async function proxyExternalRewriteNode(
  req: IncomingMessage,
  res: ServerResponse,
  externalUrl: string,
) {
  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value !== undefined) {
        headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }
    }
    headers.delete("host");

    const upstream = await fetch(externalUrl, {
      method: req.method,
      headers,
      redirect: "manual",
    });

    res.statusCode = upstream.status;
    for (const [key, value] of upstream.headers) {
      res.setHeader(key, value);
    }
    const body = await upstream.arrayBuffer();
    res.end(Buffer.from(body));
  } catch (err: any) {
    res.writeHead(502);
    res.end(`Bad Gateway: ${err.message}`);
  }
}

export function pagesRouterPlugin(ctx: PluginContext): Plugin {
  return {
    name: "openvite:pages-router",

    hotUpdate(options: { file: string; server: ViteDevServer; modules: any[] }) {
      if (!ctx.hasPagesDir || ctx.hasAppDir) return;
      const ext = /\.(tsx?|jsx?|mdx)$/;
      if (options.file.startsWith(ctx.pagesDir) && ext.test(options.file)) {
        options.server.environments.client.hot.send({ type: "full-reload" });
        return [];
      }
    },

    configureServer(server: ViteDevServer) {
      const pageExtensions = /\.(tsx?|jsx?|mdx)$/;

      function invalidateRscEntryModule() {
        const rscEnv = server.environments["rsc"];
        if (!rscEnv) return;
        const mod = rscEnv.moduleGraph.getModuleById(RESOLVED_RSC_ENTRY);
        if (mod) {
          rscEnv.moduleGraph.invalidateModule(mod);
          rscEnv.hot.send({ type: "full-reload" });
        }
      }

      server.watcher.on("add", (filePath: string) => {
        if (ctx.hasPagesDir && filePath.startsWith(ctx.pagesDir) && pageExtensions.test(filePath)) {
          invalidateRouteCache(ctx.pagesDir);
        }
        if (ctx.hasAppDir && filePath.startsWith(ctx.appDir) && pageExtensions.test(filePath)) {
          invalidateAppRouteCache();
          invalidateRscEntryModule();
        }
      });
      server.watcher.on("unlink", (filePath: string) => {
        if (ctx.hasPagesDir && filePath.startsWith(ctx.pagesDir) && pageExtensions.test(filePath)) {
          invalidateRouteCache(ctx.pagesDir);
        }
        if (ctx.hasAppDir && filePath.startsWith(ctx.appDir) && pageExtensions.test(filePath)) {
          invalidateAppRouteCache();
          invalidateRscEntryModule();
        }
      });

      if (ctx.instrumentationPath) {
        runInstrumentation(server, ctx.instrumentationPath).catch((err) => {
          console.error("[openvite] Instrumentation error:", err);
        });
      }

      return () => {
        server.middlewares.use(async (req, res, next) => {
          try {
            let url: string = req.url ?? "/";

            if (!ctx.hasPagesDir) return next();

            if (
              url.startsWith("/@") ||
              url.startsWith("/__vite") ||
              url.startsWith("/node_modules")
            ) {
              return next();
            }

            if (url.split("?")[0].endsWith(".rsc")) {
              return next();
            }

            const blockReason = validateDevRequest(
              {
                origin: req.headers.origin as string | undefined,
                host: req.headers.host,
                "x-forwarded-host": req.headers["x-forwarded-host"] as string | undefined,
                "sec-fetch-site": req.headers["sec-fetch-site"] as string | undefined,
                "sec-fetch-mode": req.headers["sec-fetch-mode"] as string | undefined,
              },
              ctx.nextConfig?.serverActionsAllowedOrigins,
            );
            if (blockReason) {
              console.warn(`[openvite] Blocked dev request: ${blockReason} (${url})`);
              res.writeHead(403, { "Content-Type": "text/plain" });
              res.end("Forbidden");
              return;
            }

            if (url.split("?")[0] === "/_openvite/image") {
              const imgParams = new URLSearchParams(url.split("?")[1] ?? "");
              const rawImgUrl = imgParams.get("url");
              const imgUrl = rawImgUrl?.replaceAll("\\", "/") ?? null;
              if (!imgUrl || !imgUrl.startsWith("/") || imgUrl.startsWith("//")) {
                res.writeHead(400);
                res.end(!rawImgUrl ? "Missing url parameter" : "Only relative URLs allowed");
                return;
              }
              const resolvedImg = new URL(imgUrl, `http://${req.headers.host || "localhost"}`);
              if (resolvedImg.origin !== `http://${req.headers.host || "localhost"}`) {
                res.writeHead(400);
                res.end("Only relative URLs allowed");
                return;
              }
              res.writeHead(302, { Location: imgUrl });
              res.end();
              return;
            }

            const rawPathname = url.split("?")[0];
            if (rawPathname.endsWith("/index.html")) {
              url = url.replace("/index.html", "/");
            } else if (rawPathname.endsWith(".html")) {
              url = url.replace(/\.html(?=\?|$)/, "");
            }

            let pathname = url.split("?")[0];
            if (pathname.includes(".") && !pathname.endsWith(".html")) {
              return next();
            }

            pathname = pathname.replaceAll("\\", "/");
            if (pathname.startsWith("//")) {
              res.writeHead(404);
              res.end("404 Not Found");
              return;
            }

            try {
              pathname = normalizePath(decodeURIComponent(pathname));
            } catch {
              res.writeHead(400);
              res.end("Bad Request");
              return;
            }

            const bp = ctx.nextConfig?.basePath ?? "";
            if (bp && pathname.startsWith(bp)) {
              const stripped = pathname.slice(bp.length) || "/";
              const qs = url.includes("?") ? url.slice(url.indexOf("?")) : "";
              url = stripped + qs;
              pathname = stripped;
            }

            if (ctx.nextConfig && pathname !== "/" && !pathname.startsWith("/api")) {
              const hasTrailing = pathname.endsWith("/");
              if (ctx.nextConfig.trailingSlash && !hasTrailing) {
                const qs = url.includes("?") ? url.slice(url.indexOf("?")) : "";
                const dest = bp + pathname + "/" + qs;
                res.writeHead(308, { Location: dest });
                res.end();
                return;
              } else if (!ctx.nextConfig.trailingSlash && hasTrailing) {
                const qs = url.includes("?") ? url.slice(url.indexOf("?")) : "";
                const dest = bp + pathname.replace(/\/+$/, "") + qs;
                res.writeHead(308, { Location: dest });
                res.end();
                return;
              }
            }

            if (ctx.middlewarePath) {
              const devTrustProxy = process.env.OPENVITE_TRUST_PROXY === "1" || (process.env.OPENVITE_TRUSTED_HOSTS ?? "").split(",").some(h => h.trim());
              const rawProto = devTrustProxy
                ? String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim()
                : "";
              const mwProto = rawProto === "https" || rawProto === "http" ? rawProto : "http";
              const origin = `${mwProto}://${req.headers.host || "localhost"}`;
              const middlewareRequest = new Request(new URL(url, origin), {
                method: req.method,
                headers: Object.fromEntries(
                  Object.entries(req.headers)
                    .filter(([, v]) => v !== undefined)
                    .map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : String(v)])
                ),
              });
              const result = await runMiddleware(server, ctx.middlewarePath, middlewareRequest);

              if (!result.continue) {
                if (result.redirectUrl) {
                  res.writeHead(result.redirectStatus ?? 307, {
                    Location: result.redirectUrl,
                  });
                  res.end();
                  return;
                }
                if (result.response) {
                  res.statusCode = result.response.status;
                  for (const [key, value] of result.response.headers) {
                    res.appendHeader(key, value);
                  }
                  const body = await result.response.text();
                  res.end(body);
                  return;
                }
              }

              if (result.responseHeaders) {
                for (const [key, value] of result.responseHeaders) {
                  res.appendHeader(key, value);
                }
              }

              if (result.rewriteUrl) {
                url = result.rewriteUrl;
              }
              if (result.rewriteStatus) {
                (req as any).__openviteRewriteStatus = result.rewriteStatus;
              }
            }

            const reqUrl = new URL(url, `http://${req.headers.host || "localhost"}`);
            const reqCtxHeaders = new Headers(
              Object.fromEntries(
                Object.entries(req.headers)
                  .filter(([, v]) => v !== undefined)
                  .map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : String(v)])
              ),
            );
            const reqCtx: RequestContext = {
              headers: reqCtxHeaders,
              cookies: parseCookies(reqCtxHeaders.get("cookie")),
              query: reqUrl.searchParams,
              host: reqCtxHeaders.get("host") ?? reqUrl.host,
            };

            if (ctx.nextConfig?.headers.length) {
              applyHeaders(pathname, res, ctx.nextConfig.headers, reqCtx);
            }

            if (ctx.nextConfig?.redirects.length) {
              const redirected = applyRedirects(
                pathname,
                res,
                ctx.nextConfig.redirects,
                reqCtx,
              );
              if (redirected) return;
            }

            let resolvedUrl = url;
            if (ctx.nextConfig?.rewrites.beforeFiles.length) {
              resolvedUrl =
                applyRewrites(pathname, ctx.nextConfig.rewrites.beforeFiles, reqCtx) ??
                url;
            }

            if (isExternalUrl(resolvedUrl)) {
              await proxyExternalRewriteNode(req, res, resolvedUrl);
              return;
            }

            const resolvedPathname = resolvedUrl.split("?")[0];
            if (
              resolvedPathname.startsWith("/api/") ||
              resolvedPathname === "/api"
            ) {
              const apiRoutes = await apiRouter(ctx.pagesDir);
              const handled = await handleApiRoute(
                server,
                req,
                res,
                resolvedUrl,
                apiRoutes,
              );
              if (handled) return;
              res.statusCode = 404;
              res.end("404 - API route not found");
              return;
            }

            const routes = await pagesRouter(ctx.pagesDir);

            if (ctx.nextConfig?.rewrites.afterFiles.length) {
              const afterRewrite = applyRewrites(
                resolvedUrl.split("?")[0],
                ctx.nextConfig.rewrites.afterFiles,
                reqCtx,
              );
              if (afterRewrite) resolvedUrl = afterRewrite;
            }

            if (isExternalUrl(resolvedUrl)) {
              await proxyExternalRewriteNode(req, res, resolvedUrl);
              return;
            }

            const handler = createSSRHandler(server, routes, ctx.pagesDir, ctx.nextConfig?.i18n);
            const mwStatus = (req as any).__openviteRewriteStatus as number | undefined;

            const match = matchRoute(resolvedUrl.split("?")[0], routes);
            if (match) {
              await handler(req, res, resolvedUrl, mwStatus);
              return;
            }

            if (ctx.nextConfig?.rewrites.fallback.length) {
              const fallbackRewrite = applyRewrites(
                resolvedUrl.split("?")[0],
                ctx.nextConfig.rewrites.fallback,
                reqCtx,
              );
              if (fallbackRewrite) {
                if (isExternalUrl(fallbackRewrite)) {
                  await proxyExternalRewriteNode(req, res, fallbackRewrite);
                  return;
                }
                await handler(req, res, fallbackRewrite, mwStatus);
                return;
              }
            }

            await handler(req, res, resolvedUrl, mwStatus);
          } catch (e) {
            next(e);
          }
        });
      };
    },
  };
}
