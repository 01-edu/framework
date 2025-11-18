/**
 * Keep track of information for each web request, like the URL and session.
 * This lets you easily get the current request's details from anywhere.
 * @module
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { startTime } from './time.ts'
import type { Readonly } from './types.ts'

// Define the route structure with supported methods
// export type Session = { id: number; createdAt: number; userId: number }
export type RequestContext = {
  readonly req: Readonly<Request>
  readonly url: Readonly<URL>
  readonly cookies: Readonly<Record<string, string>>
  readonly trace: number
  readonly span: number | undefined
  resource: string | undefined
}

export type GetContext = () => RequestContext
export type NewContext = (
  urlInit: string | URL,
  extra?: Partial<RequestContext>,
) => RequestContext

export type RunContext = <X = unknown>(
  store: RequestContext,
  cb: (store: RequestContext) => X,
) => X

// we set default values so we don't have to check everytime if they exists
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
    resource: undefined,
    url,
    req,
    ...extra,
  }
}

const defaultContext = newContext('/')
const requestContext = new AsyncLocalStorage<RequestContext>()
export const getContext: GetContext = () =>
  requestContext.getStore() || defaultContext

export const runContext: RunContext = (store, cb) =>
  requestContext.run(store, cb, store)
