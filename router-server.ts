/**
 * Type-safe HTTP Router module.
 *
 * Provides a mechanism to define HTTP routes with built-in support for:
 * - Input validation (via `input/output` schemas).
 * - Request Authorization (via `authorize` hooks).
 * - Automatic Response formatting.
 * - Export types for typed API client
 *
 * @module
 */

import { respond, ResponseError } from './response.ts'
import type { Def } from './validator.ts'
import type { Log } from './log.ts'
import type { RequestContext } from './context.ts'
import type { Awaitable, IsUnknown, Nullish } from './types.ts'

// Supported HTTP methods
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
export type RoutePattern = `${HttpMethod}/${string}`

type RequestHandler = (
  ctx: RequestContext & { session: unknown },
) => Awaitable<Response>
type Respond<T> = Awaitable<T | Response>
type Asserted<T> = [T] extends [Def] ? ReturnType<T['assert']> : void

type Authorized<Session> = IsUnknown<Session> extends true ? RequestContext
  : RequestContext & { session: Session }

type Handler<Session, In extends Def | undefined, Out extends Def | undefined> =
  {
    input?: In
    output?: Out
    description?: string
    authorize?: (ctx: RequestContext, input: Asserted<In>) => Awaitable<Session>
    fn: (
      ctx: Authorized<Session>,
      input: Asserted<In>,
    ) => Respond<Asserted<Out>>
  }

export declare const route: <
  Session,
  In extends Def | undefined,
  Out extends Def | undefined,
>(
  h: Handler<Session, In, Out>,
) => Handler<Session, In, Out>

const getPayloadParams = (ctx: RequestContext) =>
  Object.fromEntries(ctx.url.searchParams)
const getPayloadBody = async (ctx: RequestContext) => {
  try {
    return await ctx.req.json()
  } catch {
    return {}
  }
}

type Route = Record<HttpMethod, RequestHandler>
type SimpleHandler = (ctx: RequestContext, payload: unknown) => Respond<Nullish>

const sensitiveData = (
  logPayload: unknown,
  sensitiveKeys: string[],
): Record<string, unknown> | undefined => {
  if (typeof logPayload !== 'object' || !logPayload) return
  let redactedPayload: Record<string, unknown> | undefined
  for (const key of sensitiveKeys) {
    if (key in logPayload) {
      redactedPayload || (redactedPayload = { ...logPayload })
      redactedPayload[key] = undefined
    }
  }
  return redactedPayload || (logPayload as Record<string, unknown>)
}

export const makeRouter = <
  T extends Record<
    RoutePattern,
    // deno-lint-ignore no-explicit-any
    Handler<any, Def | undefined, Def | undefined>
  >,
>(
  log: Log,
  defs: T,
  sensitiveKeys = [
    'password',
    'confPassword',
    'currentPassword',
    'newPassword',
  ],
): (ctx: RequestContext) => Awaitable<Response> => {
  const routeMaps: Record<string, Route> = Object.create(null)

  for (const key in defs) {
    const slashIndex = key.indexOf('/')
    const method = key.slice(0, slashIndex) as HttpMethod
    const url = key.slice(slashIndex)
    if (!routeMaps[url]) {
      routeMaps[url] = Object.create(null) as Route
      routeMaps[`${url}/`] = routeMaps[url]
    }
    const { fn, input, authorize } = defs[key] as Handler<unknown, Def, Def>
    const handler = async (
      ctx: RequestContext & { session: unknown },
      payload?: unknown,
    ) => {
      try {
        ctx.session = await authorize?.(ctx, payload)
      } catch (err) {
        if (err instanceof ResponseError) throw err
        const message = err instanceof Error ? err.message : 'Unauthorized'
        return respond.Unauthorized({ message })
      }
      const result = await (fn as SimpleHandler)(ctx, payload)
      if (result == null) return respond.NoContent()
      return result instanceof Response ? result : respond.OK(result)
    }
    if (input) {
      const getPayload = method === 'GET' ? getPayloadParams : getPayloadBody
      const assert = input.assert
      const report = input.report || (() => [`Expect a ${input?.type}`])
      routeMaps[url][method] = async (
        ctx: RequestContext & { session: unknown },
      ) => {
        const payload = await getPayload(ctx)
        let asserted
        try {
          asserted = assert(payload)
        } catch {
          const message = 'Input validation failed'
          const failures = report(payload)
          return respond.BadRequest({ message, failures })
        }
        try {
          ctx.session = await authorize?.(ctx, payload)
        } catch (err) {
          if (err instanceof ResponseError) throw err
          const message = err instanceof Error ? err.message : 'Unauthorized'
          return respond.Unauthorized({ message })
        }

        log.info('in-params', sensitiveData(asserted, sensitiveKeys))
        return handler(ctx, asserted)
      }
    } else {
      routeMaps[url][method] = handler
    }
  }

  return (ctx: RequestContext) => {
    const route = routeMaps[ctx.url.pathname]
    if (!route) return respond.NotFound()
    const handler = route[ctx.req.method as HttpMethod]
    if (!handler) return respond.MethodNotAllowed()
    return handler(ctx as RequestContext & { session: unknown })
  }
}
