/**
 * Route matching utilities for App Router.
 *
 * Pure functions for matching URL pathnames against route patterns
 * with support for dynamic segments, catch-all, and optional catch-all.
 */

/**
 * Match a URL against a list of routes.
 * Returns the first match with extracted params, or null.
 */
export function matchRoute(
  url: string,
  routes: { pattern: string }[],
): { route: any; params: Record<string, any> } | null {
  const pathname = url.split("?")[0];
  const normalizedUrl = pathname === "/" ? "/" : pathname.replace(/\/$/, "");
  // NOTE: Do NOT decodeURIComponent here. The caller is responsible for decoding
  // the pathname exactly once at the request entry point. Decoding again here
  // would cause inconsistent path matching between middleware and routing.
  for (const route of routes) {
    const params = matchPattern(normalizedUrl, route.pattern);
    if (params !== null) return { route, params };
  }
  return null;
}

/**
 * Match a URL against a single pattern.
 * Returns extracted params (null-prototype object) or null if no match.
 *
 * Supports:
 * - Static segments: /about
 * - Dynamic segments: /posts/:id
 * - Catch-all: /docs/:slug*
 * - Required catch-all: /docs/:slug+
 */
export function matchPattern(
  url: string,
  pattern: string,
): Record<string, any> | null {
  const urlParts = url.split("/").filter(Boolean);
  const patternParts = pattern.split("/").filter(Boolean);
  const params = Object.create(null);
  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i];
    if (pp.endsWith("+")) {
      const paramName = pp.slice(1, -1);
      const remaining = urlParts.slice(i);
      if (remaining.length === 0) return null;
      params[paramName] = remaining;
      return params;
    }
    if (pp.endsWith("*")) {
      const paramName = pp.slice(1, -1);
      params[paramName] = urlParts.slice(i);
      return params;
    }
    if (pp.startsWith(":")) {
      if (i >= urlParts.length) return null;
      params[pp.slice(1)] = urlParts[i];
      continue;
    }
    if (i >= urlParts.length || urlParts[i] !== pp) return null;
  }
  if (urlParts.length !== patternParts.length) return null;
  return params;
}

/**
 * Find an intercepting route match for a pathname.
 * Returns the match info or null.
 */
export function findIntercept(
  pathname: string,
  interceptLookup: Array<{
    sourceRouteIndex: number;
    slotName: string;
    targetPattern: string;
    page: any;
    params: any;
  }>,
): {
  sourceRouteIndex: number;
  slotName: string;
  targetPattern: string;
  page: any;
  params: any;
  matchedParams: Record<string, any>;
} | null {
  for (const entry of interceptLookup) {
    const params = matchPattern(pathname, entry.targetPattern);
    if (params !== null) {
      return { ...entry, matchedParams: params };
    }
  }
  return null;
}

/**
 * Build the intercept lookup table from routes.
 * Maps target URL patterns to { sourceRouteIndex, slotName, interceptPage, params }.
 */
export function buildInterceptLookup(
  routes: any[],
): Array<{
  sourceRouteIndex: number;
  slotName: string;
  targetPattern: string;
  page: any;
  params: any;
}> {
  const lookup: Array<{
    sourceRouteIndex: number;
    slotName: string;
    targetPattern: string;
    page: any;
    params: any;
  }> = [];
  for (let ri = 0; ri < routes.length; ri++) {
    const r = routes[ri];
    if (!r.slots) continue;
    for (const [slotName, slotMod] of Object.entries(r.slots) as any[]) {
      if (!slotMod.intercepts) continue;
      for (const intercept of slotMod.intercepts) {
        lookup.push({
          sourceRouteIndex: ri,
          slotName,
          targetPattern: intercept.targetPattern,
          page: intercept.page,
          params: intercept.params,
        });
      }
    }
  }
  return lookup;
}
