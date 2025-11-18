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
 * import { server } from './server.ts'
 *
 * // Create the handler
 * const handler = server({
 *   log: console,
 *   routeHandler: () => new Response('Hello World!'),
 * })
 *
 * // Launch (Deno example)
 * Deno.serve(handler)
 */

import { getCookies, setCookie } from '@std/http/cookie'
import type { Log } from './log.ts'
import { type RequestContext, runContext } from './context.ts'
import { respond, ResponseError } from './response.ts'
import { now } from './time.ts'
import type { Awaitable } from './types.ts'

type Handler = (ctx: RequestContext) => Awaitable<Response>
export const server = (
  { routeHandler, log }: { routeHandler: Handler; log: Log },
) => {
  const handleRequest = async (ctx: RequestContext) => {
    const logProps: Record<string, unknown> = {}
    logProps.path = `${ctx.req.method}:${ctx.url.pathname}`
    log.info('in', logProps)
    try {
      const res = await routeHandler(ctx)
      logProps.status = res.status
      logProps.duration = now() - ctx.span!
      log.info('out', logProps)
      return res
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
      return response
    }
  }

  return async (req: Request) => {
    const url = new URL(req.url)
    const method = req.method
    if (method === 'OPTIONS') return respond.NoContent()

    // Build the request context
    const cookies = getCookies(req.headers)
    const ctx = {
      req,
      url,
      cookies,
      trace: cookies.trace ? Number(cookies.trace) : now(),
      span: now(),
      resource: undefined,
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
