/**
 * Server entrypoint wrapper.
 *
 * Wraps your router to handle the full request lifecycle:
 * - Logs incoming requests, response status, and duration.
 * - Global error barrier that catches crashes and returns 500s.
 * - Cookie parsing
 * - OTEL style trace IDs (via cookies) and initializes the `RequestContext`.
 * - Support for the `response` utility for simple error handling
 *
 * @module Server
 *
 * @example
 * ```ts
 * import { server } from '@01edu/server';
 * import { makeRouter, route } from '@01edu/router';
 * import { logger } from '@01edu/log';
 *
 * const log = await logger({});
 * const router = makeRouter(log, {
 *   'GET/': route({
 *     fn: () => new Response('Hello World!'),
 *   }),
 * });
 *
 * // Create the handler
 * const handler = server({
 *   log,
 *   routeHandler: router,
 * });
 *
 * // Launch (Deno example)
 * Deno.serve(handler);
 * ```
 */

import { getCookies, setCookie } from '@std/http/cookie'
import type { Log } from './log.ts'
import { type RequestContext, runContext } from './context.ts'
import { respond, ResponseError } from './response.ts'
import { now } from '@01edu/time'
import type { Awaitable } from '@01edu/types'
import { APP_ENV, DEVTOOL_URL } from './env.ts'

type Handler = (ctx: RequestContext) => Awaitable<Response>

const allowedOrigin = DEVTOOL_URL || ''
const addCorsHeaders = (res: Response, origin: string | null) => {
  if (APP_ENV !== 'dev') return res
  if (allowedOrigin && origin && new URL(origin).origin === new URL(allowedOrigin).origin) {
    res.headers.set('Access-Control-Allow-Origin', allowedOrigin)
    res.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    res.headers.set('Access-Control-Allow-Credentials', 'true')
  } else if (origin && (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1'))) {
     // Dev convenience for local devtools development
     res.headers.set('Access-Control-Allow-Origin', origin)
     res.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
     res.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type')
     res.headers.set('Access-Control-Allow-Credentials', 'true')
  }
  return res
}

/**
 * Creates a server request handler that wraps a route handler with logging, error handling, and context creation.
 *
 * @param options - The server configuration.
 * @param options.routeHandler - The router function to handle incoming requests.
 * @param options.log - A logger instance.
 * @returns An async function that takes a `Request` and returns a `Response`.
 */
export const server = (
  { routeHandler, log }: { routeHandler: Handler; log: Log },
): (req: Request, url?: URL) => Promise<Response> => {


  const handleRequest = async (ctx: RequestContext) => {
    const logProps: Record<string, unknown> = {}
    logProps.path = `${ctx.req.method}:${ctx.url.pathname}`
    log.info('in', logProps)
    try {
      const res = await routeHandler(ctx)
      logProps.status = res.status
      logProps.duration = now() - ctx.span!
      log.info('out', logProps)
      return addCorsHeaders(res, ctx.req.headers.get('Origin'))
    } catch (err) {
      let response: Response
      if (err instanceof ResponseError) {
        response = err.response
        logProps.status = response.status
      } else {
        logProps.status = 500
        logProps.stack = err
        response = respond.InternalServerError()
      }

      logProps.duration = now() - ctx.span!
      log.error('out', logProps)
      return addCorsHeaders(response, ctx.req.headers.get('Origin'))
    }
  }

  return async (req: Request, url = new URL(req.url)) => {
    const method = req.method
    const origin = req.headers.get('Origin')

    if (method === 'OPTIONS') {
        const res = respond.NoContent()
        return addCorsHeaders(res, origin)
    }

    // Build the request context
    const cookies = getCookies(req.headers)
    const ctx = {
      req,
      url,
      cookies,
      trace: cookies.trace ? Number(cookies.trace) : now(),
      span: now(),
    }

    const res = await runContext(ctx, handleRequest)
    if (!cookies.trace) {
      setCookie(res.headers, {
        name: 'trace',
        value: String(ctx.trace),
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'Lax',
      })
    }

    return res
  }
}
