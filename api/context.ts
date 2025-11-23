/**
 * Keep track of information for each web request, like the URL and session.
 * This lets you easily get the current request's details from anywhere.
 * @module
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { startTime } from '@01edu/time'
import type { Readonly } from '@01edu/types'

// Define the route structure with supported methods
// export type Session = { id: number; createdAt: number; userId: number }
/**
 * Represents the context for a single HTTP request.
 * It holds all relevant information for the request lifecycle.
 */
export type RequestContext = {
  /** The original, immutable Request object. */
  readonly req: Readonly<Request>
  /** The parsed URL of the request. */
  readonly url: Readonly<URL>
  /** A key-value store of cookies sent with the request. */
  readonly cookies: Readonly<Record<string, string>>
  /** A unique identifier for tracing the request through the system. */
  readonly trace: number
  /** An optional identifier for a specific span within a trace, for more granular performance monitoring. */
  readonly span: number | undefined
}

/**
 * A function that returns the current request's context.
 *
 * @example
 * ```ts
 * import { getContext } from '@01edu/context';
 *
 * const context = getContext();
 * console.log(context.url.pathname);
 * ```
 */
export type GetContext = () => RequestContext
/**
 * A function that creates a new request context. Useful for testing or running background jobs.
 *
 * @example
 * ```ts
 * import { newContext } from '@01edu/context';
 *
 * const context = newContext('/users/123');
 * console.log(context.url.pathname);
 * ```
 */
export type NewContext = (
  urlInit: string | URL,
  extra?: Partial<RequestContext>,
) => RequestContext

/**
 * A function that runs a callback within a specific request context.
 * This is the foundation of how the context is managed across asynchronous operations.
 *
 * @example
 * ```ts
 * import { runContext, newContext } from '@01edu/context';
 *
 * const context = newContext('/');
 * runContext(context, () => {
 *   // all code here will have access to `context` via `getContext()`
 * });
 * ```
 */
export type RunContext = <X = unknown>(
  store: RequestContext,
  cb: (store: RequestContext) => X,
) => X

// we set default values so we don't have to check everytime if they exists
/**
 * Creates a new request context. Useful for testing or running background jobs.
 *
 * @param urlInit - The URL for the new context.
 * @param extra - Optional additional properties to add to the context.
 * @returns A new request context object.
 *
 * @example
 * ```ts
 * import { newContext } from '@01edu/context';
 *
 * const context = newContext('/users/123');
 * console.log(context.url.pathname);
 * // => "/users/123"
 * ```
 */
export const newContext: NewContext = (
  urlInit: string | URL,
  extra?: Partial<RequestContext>,
) => {
  const url = new URL(urlInit, 'http://locahost')
  const req = new Request(url)
  return {
    trace: startTime,
    cookies: {},
    span: undefined,
    url,
    req,
    ...extra,
  }
}

const defaultContext = newContext('/')
const requestContext = new AsyncLocalStorage<RequestContext>()
/**
 * Returns the current request's context.
 * If no context is found, it returns a default context.
 *
 * @returns The current request context.
 *
 * @example
 * ```ts
 * import { getContext } from '@01edu/context';
 *
 * function logPath() {
 *   const { url } = getContext();
 *   console.log(url.pathname);
 * }
 * ```
 */
export const getContext: GetContext = () =>
  requestContext.getStore() || defaultContext

/**
 * Runs a callback within a specific request context, making it available via `getContext`.
 * This is essential for ensuring that context is not lost in asynchronous operations.
 *
 * @param store - The request context to run the callback in.
 * @param cb - The callback to execute.
 * @returns The return value of the callback.
 *
 * @example
 * ```ts
 * import { runContext, newContext, getContext } from '@01edu/context';
 *
 * const context = newContext('/about');
 *
 * runContext(context, () => {
 *   const currentContext = getContext();
 *   console.log(currentContext.url.pathname); // => "/about"
 * });
 * ```
 */
export const runContext: RunContext = (store, cb) =>
  requestContext.run(store, cb, store)
