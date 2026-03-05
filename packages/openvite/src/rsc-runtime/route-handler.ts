// @ts-nocheck — this module runs inside the Vite RSC environment where
// openvite/* and next/* aliases are resolved at runtime, not by tsc.
/**
 * Route handler execution for route.ts API endpoints.
 *
 * Handles HTTP method dispatch, OPTIONS/HEAD auto-implementation,
 * cookie collection, redirect/notFound error handling, and error reporting.
 */
import {
  setHeadersContext,
  getAndClearPendingCookies,
  getDraftModeCookieHeader,
} from "next/headers";
import { reportRequestError } from "openvite/instrumentation";

/**
 * Execute a route.ts handler for the given request.
 * Returns a Response, or null if the route has no routeHandler.
 */
export async function executeRouteHandler(
  route: any,
  request: Request,
  params: Record<string, any>,
  cleanPathname: string,
  clearContext: () => void,
): Promise<Response | null> {
  if (!route.routeHandler) return null;

  const handler = route.routeHandler;
  const method = request.method.toUpperCase();

  const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"];
  const exportedMethods = HTTP_METHODS.filter((m) => typeof handler[m] === "function");
  if (exportedMethods.includes("GET") && !exportedMethods.includes("HEAD")) {
    exportedMethods.push("HEAD");
  }
  const hasDefault = typeof handler["default"] === "function";

  // OPTIONS auto-implementation
  if (method === "OPTIONS" && typeof handler["OPTIONS"] !== "function") {
    const allowMethods = hasDefault ? HTTP_METHODS : exportedMethods;
    if (!allowMethods.includes("OPTIONS")) allowMethods.push("OPTIONS");
    clearContext();
    return new Response(null, {
      status: 204,
      headers: { "Allow": allowMethods.join(", ") },
    });
  }

  // HEAD auto-implementation: run GET handler and strip body
  let handlerFn = handler[method] || handler["default"];
  let isAutoHead = false;
  if (method === "HEAD" && typeof handler["HEAD"] !== "function" && typeof handler["GET"] === "function") {
    handlerFn = handler["GET"];
    isAutoHead = true;
  }

  if (typeof handlerFn === "function") {
    try {
      const response = await handlerFn(request, { params });

      const pendingCookies = getAndClearPendingCookies();
      const draftCookie = getDraftModeCookieHeader();
      clearContext();

      if (pendingCookies.length > 0 || draftCookie) {
        const newHeaders = new Headers(response.headers);
        for (const cookie of pendingCookies) {
          newHeaders.append("Set-Cookie", cookie);
        }
        if (draftCookie) newHeaders.append("Set-Cookie", draftCookie);

        if (isAutoHead) {
          return new Response(null, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders,
          });
        }
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders,
        });
      }

      if (isAutoHead) {
        return new Response(null, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }
      return response;
    } catch (err: any) {
      getAndClearPendingCookies();

      if (err && typeof err === "object" && "digest" in err) {
        const digest = String(err.digest);
        if (digest.startsWith("NEXT_REDIRECT;")) {
          const parts = digest.split(";");
          const redirectUrl = decodeURIComponent(parts[2]);
          const statusCode = parts[3] ? parseInt(parts[3], 10) : 307;
          clearContext();
          return new Response(null, {
            status: statusCode,
            headers: { Location: new URL(redirectUrl, request.url).toString() },
          });
        }
        if (digest === "NEXT_NOT_FOUND" || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;")) {
          const statusCode = digest === "NEXT_NOT_FOUND" ? 404 : parseInt(digest.split(";")[1], 10);
          clearContext();
          return new Response(null, { status: statusCode });
        }
      }

      clearContext();
      console.error("[openvite] Route handler error:", err);
      reportRequestError(
        err instanceof Error ? err : new Error(String(err)),
        { path: cleanPathname, method: request.method, headers: Object.fromEntries(request.headers.entries()) },
        { routerKind: "App Router", routePath: route.pattern, routeType: "route" },
      ).catch((reportErr: any) => {
        console.error("[openvite] Failed to report route handler error:", reportErr);
      });
      return new Response(null, { status: 500 });
    }
  }

  clearContext();
  return new Response(null, {
    status: 405,
    headers: { Allow: exportedMethods.join(", ") },
  });
}
