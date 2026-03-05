/**
 * Config-based redirects, rewrites, and headers for next.config.js.
 *
 * Pattern matching for redirect/rewrite rules with support for
 * dynamic params, catch-all, regex patterns, and has/missing conditions.
 */

type SafeRegExpFn = (pattern: string) => RegExp | null;

/**
 * Match a pathname against a config pattern (redirect/rewrite/header source).
 * Returns extracted params or null.
 */
export function matchConfigPattern(
  pathname: string,
  pattern: string,
  safeRegExp: SafeRegExpFn,
): Record<string, string> | null {
  if (
    pattern.includes("(") ||
    pattern.includes("\\") ||
    /:[\w-]+[*+][^/]/.test(pattern) ||
    /:[\w-]+\./.test(pattern)
  ) {
    try {
      const paramNames: string[] = [];
      const regexStr = pattern
        .replace(/\./g, "\\.")
        .replace(
          /:(\w[\w-]*)\*(?:\(([^)]+)\))?/g,
          (_, name, c) => {
            paramNames.push(name);
            return c ? "(" + c + ")" : "(.*)";
          },
        )
        .replace(
          /:(\w[\w-]*)\+(?:\(([^)]+)\))?/g,
          (_, name, c) => {
            paramNames.push(name);
            return c ? "(" + c + ")" : "(.+)";
          },
        )
        .replace(/:(\w[\w-]*)\(([^)]+)\)/g, (_, name, c) => {
          paramNames.push(name);
          return "(" + c + ")";
        })
        .replace(/:(\w[\w-]*)/g, (_, name) => {
          paramNames.push(name);
          return "([^/]+)";
        });
      const re = safeRegExp("^" + regexStr + "$");
      if (!re) return null;
      const match = re.exec(pathname);
      if (!match) return null;
      const params = Object.create(null);
      for (let i = 0; i < paramNames.length; i++)
        params[paramNames[i]] = match[i + 1] || "";
      return params;
    } catch {
      /* fall through */
    }
  }
  const catchAllMatch = pattern.match(/:(\w[\w-]*)(\*|\+)$/);
  if (catchAllMatch) {
    const prefix = pattern.slice(0, pattern.lastIndexOf(":"));
    const paramName = catchAllMatch[1];
    const isPlus = catchAllMatch[2] === "+";
    if (!pathname.startsWith(prefix.replace(/\/$/, ""))) return null;
    const rest = pathname.slice(prefix.replace(/\/$/, "").length);
    if (isPlus && (!rest || rest === "/")) return null;
    const restValue = rest.startsWith("/") ? rest.slice(1) : rest;
    return { [paramName]: restValue };
  }
  const parts = pattern.split("/");
  const pathParts = pathname.split("/");
  if (parts.length !== pathParts.length) return null;
  const params = Object.create(null);
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].startsWith(":")) params[parts[i].slice(1)] = pathParts[i];
    else if (parts[i] !== pathParts[i]) return null;
  }
  return params;
}

interface RequestContext {
  headers: Headers;
  cookies: Record<string, string>;
  query: Record<string, string>;
}

interface HasCondition {
  type: "header" | "cookie" | "query" | "host";
  key: string;
  value?: string;
}

/**
 * Check a single has/missing condition against the request context.
 */
export function checkSingleCondition(
  condition: HasCondition,
  ctx: RequestContext,
  safeRegExp: SafeRegExpFn,
): boolean {
  switch (condition.type) {
    case "header": {
      const v = ctx.headers.get(condition.key);
      if (v === null) return false;
      if (condition.value !== undefined) {
        const re = safeRegExp(condition.value);
        return re ? re.test(v) : v === condition.value;
      }
      return true;
    }
    case "cookie": {
      const v = ctx.cookies[condition.key];
      if (v === undefined) return false;
      if (condition.value !== undefined) {
        const re = safeRegExp(condition.value);
        return re ? re.test(v) : v === condition.value;
      }
      return true;
    }
    case "query": {
      const v = ctx.query[condition.key];
      if (v === undefined) return false;
      if (condition.value !== undefined) {
        const re = safeRegExp(condition.value);
        return re ? re.test(v) : v === condition.value;
      }
      return true;
    }
    case "host": {
      const host = ctx.headers.get("host") || "";
      if (condition.value !== undefined) {
        const re = safeRegExp(condition.value);
        return re ? re.test(host) : host === condition.value;
      }
      return host.length > 0;
    }
    default:
      return false;
  }
}

/**
 * Check all has/missing conditions for a rule.
 */
export function checkHasConditions(
  has: HasCondition[] | undefined,
  missing: HasCondition[] | undefined,
  ctx: RequestContext,
  safeRegExp: SafeRegExpFn,
): boolean {
  if (has) {
    for (const c of has) {
      if (!checkSingleCondition(c, ctx, safeRegExp)) return false;
    }
  }
  if (missing) {
    for (const c of missing) {
      if (checkSingleCondition(c, ctx, safeRegExp)) return false;
    }
  }
  return true;
}

interface RedirectRule {
  source: string;
  destination: string;
  permanent?: boolean;
  has?: HasCondition[];
  missing?: HasCondition[];
}

interface RewriteRule {
  source: string;
  destination: string;
  has?: HasCondition[];
  missing?: HasCondition[];
}

interface HeaderRule {
  source: string;
  headers: Array<{ key: string; value: string }>;
  has?: HasCondition[];
  missing?: HasCondition[];
}

/**
 * Apply redirect rules from next.config.js.
 * Returns the first matching redirect or null.
 */
export function applyConfigRedirects(
  pathname: string,
  rules: RedirectRule[],
  ctx: RequestContext | null,
  safeRegExp: SafeRegExpFn,
  sanitizeDest: (dest: string) => string,
): { destination: string; permanent?: boolean } | null {
  for (const rule of rules) {
    const params = matchConfigPattern(pathname, rule.source, safeRegExp);
    if (params) {
      if (ctx && (rule.has || rule.missing)) {
        if (!checkHasConditions(rule.has, rule.missing, ctx, safeRegExp))
          continue;
      }
      let dest = rule.destination;
      for (const [key, value] of Object.entries(params)) {
        dest = dest.replace(":" + key + "*", value);
        dest = dest.replace(":" + key + "+", value);
        dest = dest.replace(":" + key, value);
      }
      dest = sanitizeDest(dest);
      return { destination: dest, permanent: rule.permanent };
    }
  }
  return null;
}

/**
 * Apply rewrite rules from next.config.js.
 * Returns the rewritten pathname or null.
 */
export function applyConfigRewrites(
  pathname: string,
  rules: RewriteRule[],
  ctx: RequestContext | null,
  safeRegExp: SafeRegExpFn,
  sanitizeDest: (dest: string) => string,
): string | null {
  for (const rule of rules) {
    const params = matchConfigPattern(pathname, rule.source, safeRegExp);
    if (params) {
      if (ctx && (rule.has || rule.missing)) {
        if (!checkHasConditions(rule.has, rule.missing, ctx, safeRegExp))
          continue;
      }
      let dest = rule.destination;
      for (const [key, value] of Object.entries(params)) {
        dest = dest.replace(":" + key + "*", value);
        dest = dest.replace(":" + key + "+", value);
        dest = dest.replace(":" + key, value);
      }
      dest = sanitizeDest(dest);
      return dest;
    }
  }
  return null;
}

/**
 * Apply header rules from next.config.js.
 * Returns matching headers to set.
 */
export function applyConfigHeaders(
  pathname: string,
  rules: HeaderRule[],
  ctx: RequestContext | null,
  safeRegExp: SafeRegExpFn,
): Array<{ key: string; value: string }> {
  const result: Array<{ key: string; value: string }> = [];
  for (const rule of rules) {
    const params = matchConfigPattern(pathname, rule.source, safeRegExp);
    if (params) {
      if (ctx && (rule.has || rule.missing)) {
        if (!checkHasConditions(rule.has, rule.missing, ctx, safeRegExp))
          continue;
      }
      for (const h of rule.headers) {
        let value = h.value;
        for (const [key, val] of Object.entries(params)) {
          value = value.replace(":" + key, val);
        }
        result.push({ key: h.key, value });
      }
    }
  }
  return result;
}
