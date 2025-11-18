/**
 * Util to define event variable with default fallback.
 * Also define and share the expected `APP_ENV` required by our apps.
 * @module
 */

export const ENV = (key: string, fallback?: string): string => {
  const value = Deno.env.get(key)
  if (value) return value
  if (fallback != null) return fallback
  throw Error(`${key}: field required in the env`)
}

export type AppEnvironments = 'dev' | 'prod' | 'test'
export const APP_ENV = ENV('APP_ENV', 'dev') as AppEnvironments
if (APP_ENV !== 'dev' && APP_ENV !== 'prod' && APP_ENV !== 'test') {
  throw Error(`APP_ENV: "${APP_ENV}" must be "dev", "test" or "prod"`)
}

export const CI_COMMIT_SHA: string = ENV('CI_COMMIT_SHA', '')
export const DEVTOOL_TOKEN: string = ENV('DEVTOOL_TOKEN', '')
export const DEVTOOL_URL: string = ENV('DEVTOOL_URL', '')
