/**
 * RSC Runtime — barrel exports.
 *
 * Pure utility modules extracted from the RSC virtual entry.
 * These run inside the Vite RSC environment at request time.
 */

export {
  readBodyWithLimit,
  readFormDataWithLimit,
  DEFAULT_MAX_ACTION_BODY_SIZE,
} from "./body-limit.js";

export {
  matchConfigPattern,
  checkSingleCondition,
  checkHasConditions,
  applyConfigRedirects,
  applyConfigRewrites,
  applyConfigHeaders,
} from "./config-rewrites.js";

export {
  makeThenableParams,
  errorDigest,
  sanitizeErrorForClient,
  rscOnError,
  isExternalUrl,
} from "./helpers.js";

export { proxyExternalRequest } from "./proxy.js";

export {
  isOriginAllowed,
  validateCsrfOrigin,
  parseCookies,
  sanitizeDestination,
} from "./request-context.js";

export {
  matchRoute,
  matchPattern,
  findIntercept,
  buildInterceptLookup,
} from "./route-matcher.js";
