/**
 * External request proxying for config rewrites.
 *
 * When a rewrite destination is an external URL, this module
 * proxies the request to the upstream server, stripping
 * credentials and hop-by-hop headers.
 */

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
]);

/**
 * Proxy a request to an external URL (for external rewrites).
 * Strips credentials, internal middleware headers, and hop-by-hop headers.
 */
export async function proxyExternalRequest(
  request: Request,
  externalUrl: string,
): Promise<Response> {
  const originalUrl = new URL(request.url);
  const targetUrl = new URL(externalUrl);

  // Merge query params from the original request
  for (const [key, value] of originalUrl.searchParams) {
    if (!targetUrl.searchParams.has(key)) {
      targetUrl.searchParams.set(key, value);
    }
  }

  const headers = new Headers(request.headers);
  headers.set("host", targetUrl.host);
  headers.delete("connection");
  // Strip credentials and internal headers to prevent leaking auth tokens,
  // session cookies, and middleware internals to third-party origins.
  headers.delete("cookie");
  headers.delete("authorization");
  headers.delete("x-api-key");
  headers.delete("proxy-authorization");
  for (const key of Array.from(headers.keys())) {
    if (key.startsWith("x-middleware-")) headers.delete(key);
  }

  const method = request.method;
  const hasBody = method !== "GET" && method !== "HEAD";
  const init: RequestInit & { duplex?: string } = {
    method,
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
  };
  if (hasBody && request.body) {
    init.body = request.body;
    init.duplex = "half";
  }

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl.href, init);
  } catch (e: any) {
    if (e && e.name === "TimeoutError") {
      return new Response("Gateway Timeout", { status: 504 });
    }
    console.error("[openvite] External rewrite proxy error:", e);
    return new Response("Bad Gateway", { status: 502 });
  }

  const respHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      respHeaders.append(key, value);
    }
  });

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}
