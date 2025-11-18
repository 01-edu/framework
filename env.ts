/**
 * Util to define event variable with default fallback.
 * Also define and share the expected `APP_ENV` required by our apps.
 * @module
 */

/**
 * Retrieves an environment variable by key.
 * Throws an error if the variable is not set and no fallback is provided.
 *
 * @param key - The name of the environment variable.
 * @param fallback - An optional default value to use if the variable is not set.
 * @returns The value of the environment variable.
 *
 * @example
 * ```ts
 * import { ENV } from './env.ts';
 *
 * const port = ENV('PORT', '8080');
 * ```
 */
export const ENV = (key: string, fallback?: string): string => {
  const value = Deno.env.get(key)
  if (value) return value
  if (fallback != null) return fallback
  throw Error(`${key}: field required in the env`)
}

/**
 * The possible application environments.
 */
export type AppEnvironments = 'dev' | 'prod' | 'test'

/**
 * The current application environment, determined by the `APP_ENV` environment variable.
 * Defaults to 'dev' if not set.
 *
 * @example
 * ```ts
 * import { APP_ENV } from './env.ts';
 *
 * if (APP_ENV === 'prod') {
 *   console.log('Running in production mode');
 * }
 * ```
 */
export const APP_ENV = ENV('APP_ENV', 'dev') as AppEnvironments
if (APP_ENV !== 'dev' && APP_ENV !== 'prod' && APP_ENV !== 'test') {
  throw Error(`APP_ENV: "${APP_ENV}" must be "dev", "test" or "prod"`)
}

/**
 * The git commit SHA of the current build, typically provided by a CI/CD system.
 */
export const CI_COMMIT_SHA: string = ENV('CI_COMMIT_SHA', '')
/**
 * An authentication token for a developer tool service.
 */
export const DEVTOOL_TOKEN: string = ENV('DEVTOOL_TOKEN', '')
/**
 * The URL for a developer tool service.
 */
export const DEVTOOL_URL: string = ENV('DEVTOOL_URL', '')
