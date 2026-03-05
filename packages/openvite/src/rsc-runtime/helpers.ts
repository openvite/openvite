/**
 * Shared helper utilities for the RSC runtime.
 *
 * Pure functions used across multiple runtime modules.
 */

/**
 * Normalize null-prototype objects from matchPattern() into thenable objects
 * that work both as Promises (for Next.js 15+ async params) and as plain
 * objects with synchronous property access (for pre-15 code like params.id).
 *
 * matchPattern() uses Object.create(null), producing objects without
 * Object.prototype. The RSC serializer rejects these. Spreading ({...obj})
 * restores a normal prototype. Object.assign onto the Promise preserves
 * synchronous property access (params.id, params.slug) that existing
 * components and test fixtures rely on.
 */
export function makeThenableParams(
  obj: Record<string, any>,
): Promise<Record<string, any>> & Record<string, any> {
  const plain = { ...obj };
  return Object.assign(Promise.resolve(plain), plain);
}

/**
 * djb2 hash — matches Next.js's stringHash for digest generation.
 * Produces a stable numeric string from error message + stack.
 */
export function errorDigest(str: string): string {
  let hash = 5381;
  for (let i = str.length - 1; i >= 0; i--) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString();
}

/**
 * Sanitize an error for client consumption. In production, replaces the error
 * with a generic Error that only carries a digest hash (matching Next.js
 * behavior). In development, returns the original error for debugging.
 * Navigation errors (redirect, notFound, etc.) are always passed through
 * unchanged since their digests are used for client-side routing.
 */
export function sanitizeErrorForClient(error: unknown): unknown {
  // Navigation errors must pass through with their digest intact
  if (error && typeof error === "object" && "digest" in error) {
    const digest = String((error as any).digest);
    if (
      digest.startsWith("NEXT_REDIRECT;") ||
      digest === "NEXT_NOT_FOUND" ||
      digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;")
    ) {
      return error;
    }
  }
  // In development, pass through the original error for debugging
  if (process.env.NODE_ENV !== "production") {
    return error;
  }
  // In production, create a sanitized error with only a digest hash
  const msg = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? (error.stack || "") : "";
  const sanitized = new Error(
    "An error occurred in the Server Components render. " +
    "The specific message is omitted in production builds to avoid leaking sensitive details. " +
    "A digest property is included on this error instance which may provide additional details about the nature of the error.",
  );
  (sanitized as any).digest = errorDigest(msg + stack);
  return sanitized;
}

/**
 * onError callback for renderToReadableStream — preserves the digest for
 * Next.js navigation errors (redirect, notFound, forbidden, unauthorized)
 * thrown during RSC streaming (e.g. inside Suspense boundaries).
 * For non-navigation errors in production, generates a digest hash so the
 * error can be correlated with server logs without leaking details.
 */
export function rscOnError(error: unknown): string | undefined {
  if (error && typeof error === "object" && "digest" in error) {
    return String((error as any).digest);
  }
  // In production, generate a digest hash for non-navigation errors
  if (process.env.NODE_ENV === "production" && error) {
    const msg = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? (error.stack || "") : "";
    return errorDigest(msg + stack);
  }
  return undefined;
}

/**
 * Check if a URL is external (has a protocol or starts with //).
 */
export function isExternalUrl(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//");
}
