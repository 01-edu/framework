/**
 * Keep track of information for each web request, like the URL and session.
 * This lets you easily get the current request's details from anywhere.
 * @module
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { startTime } from './time.ts'

type Readonly<T> = {
  readonly [P in keyof T]:
    // deno-lint-ignore ban-types
    T[P] extends Function ? T[P]
      : T[P] extends object ? Readonly<T[P]>
      : T[P]
}

// Define the route structure with supported methods
// export type Session = { id: number; createdAt: number; userId: number }
export type RequestContext<T = undefined> = {
  readonly req: Readonly<Request>
  readonly url: Readonly<URL>
  readonly cookies: Readonly<Record<string, string>>
  readonly session: T | undefined
  readonly trace: number
  readonly span: number | undefined
  resource: string | undefined
}

// we set default values so we don't have to check everytime if they exists
export const makeContext = <T>(
  urlInit: string | URL,
  extra?: Partial<RequestContext<T>>,
): RequestContext<T> => {
  const url = new URL(urlInit, 'http://locahost')
  const req = new Request(url)
  return {
    trace: startTime,
    cookies: {},
    session: undefined,
    span: undefined,
    resource: undefined,
    url,
    req,
    ...extra,
  }
}

const defaultContext: RequestContext<undefined> = makeContext('/')
export const requestContext: AsyncLocalStorage<RequestContext> =
  new AsyncLocalStorage<RequestContext>()

export const getContext = (): RequestContext<unknown> =>
  requestContext.getStore() || defaultContext
