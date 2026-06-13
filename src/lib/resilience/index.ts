/**
 * Vendored resilience primitives.
 *
 * Copied verbatim from cubiczan-resilience (typescript/src) because there is no
 * private npm registry to depend on. Source files: errors.ts, retry.ts,
 * timeout.ts, safeFetch.ts. Do not edit by hand — re-vendor from upstream if
 * the shared library changes.
 */
export { safeFetch } from './safeFetch.js';
export type { SafeFetchOptions, AllowlistHook } from './safeFetch.js';
export { retry, computeBackoff } from './retry.js';
export type { RetryOptions } from './retry.js';
export { withTimeout } from './timeout.js';
export { ResilienceError, isResilienceError } from './errors.js';
export type { ResilienceErrorKind, ResilienceErrorOptions } from './errors.js';
