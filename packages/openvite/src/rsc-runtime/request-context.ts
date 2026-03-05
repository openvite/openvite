/**
 * Request context building and validation for the RSC runtime.
 *
 * Handles CSRF validation, origin checks, cookie parsing,
 * and request context construction.
 */

/**
 * Check if an origin matches an allowed pattern.
 * Supports wildcard patterns like *.example.com.
 */
export function isOriginAllowed(origin: string, allowed: string[]): boolean {
  for (const pattern of allowed) {
    if (pattern.startsWith("*.")) {
      // Wildcard: *.example.com matches sub.example.com, a.b.example.com
      const suffix = pattern.slice(1); // ".example.com"
      if (origin === pattern.slice(2) || origin.endsWith(suffix)) return true;
    } else if (origin === pattern) {
      return true;
    }
  }
  return false;
}

/**
 * Validate CSRF origin for server actions.
 * Returns a 403 Response if the origin is invalid, or null if valid.
 */
export function validateCsrfOrigin(
  request: Request,
  allowedOrigins: string[],
): Response | null {
  const originHeader = request.headers.get("origin");
  // If there's no Origin header, allow the request — same-origin requests
  // from non-fetch navigations (e.g. SSR) may lack an Origin header.
  if (!originHeader || originHeader === "null") return null;

  let originHost: string;
  try {
    originHost = new URL(originHeader).host.toLowerCase();
  } catch {
    return new Response("Forbidden", {
      status: 403,
      headers: { "Content-Type": "text/plain" },
    });
  }

  // Only use the Host header for origin comparison — never trust
  // X-Forwarded-Host here, since it can be freely set by the client.
  const hostHeader = (request.headers.get("host") || "")
    .split(",")[0]
    .trim()
    .toLowerCase();

  if (!hostHeader) return null;

  // Same origin — allow
  if (originHost === hostHeader) return null;

  // Check allowedOrigins from next.config.js
  if (
    allowedOrigins.length > 0 &&
    isOriginAllowed(originHost, allowedOrigins)
  ) {
    return null;
  }

  console.warn(
    `[openvite] CSRF origin mismatch: origin "${originHost}" does not match host "${hostHeader}". Blocking server action request.`,
  );
  return new Response("Forbidden", {
    status: 403,
    headers: { "Content-Type": "text/plain" },
  });
}

/**
 * Parse a Cookie header string into a key-value object.
 */
export function parseCookies(
  cookieHeader: string | null,
): Record<string, string> {
  if (!cookieHeader) return {};
  const cookies: Record<string, string> = {};
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) cookies[key] = value;
  }
  return cookies;
}

/**
 * Sanitize a rewrite/redirect destination to prevent open redirects.
 * Strips protocol-relative URLs and ensures the destination is safe.
 */
export function sanitizeDestination(dest: string): string {
  // Collapse backslashes to forward slashes (spec-equivalent in URLs)
  let safe = dest.replace(/\\/g, "/");
  // Strip leading double slashes (protocol-relative) repeatedly
  while (safe.startsWith("//")) safe = safe.slice(1);
  return safe;
}
