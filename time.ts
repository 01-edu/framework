/**
 * Shared functions to manage time in seconds instead of milliseconds
 * @module
 */

/**
 * The timestamp (in seconds) when the current process started.
 *
 * @example
 * ```ts
 * import { startTime } from './time.ts';
 *
 * console.log(`Process started at: ${new Date(startTime * 1000)}`);
 * ```
 */
export const startTime = performance.timeOrigin / 1000
let lastTime = startTime
/**
 * Return the current timestamp in seconds since the epoch.
 * Uses the performance API for high precision timing.
 * Ensured to be unique per process.
 *
 * @example
 * ```ts
 * import { now } from './time.ts';
 *
 * const timestamp = now();
 * console.log(timestamp);
 * ```
 */
export const now = (): number => {
  const time = startTime + performance.now() / 1000
  if (time === lastTime) return now()
  lastTime = time
  return time
}

/** One second in seconds. */
export const SEC = 1
/** One minute in seconds. */
export const MIN = 60
/** One hour in seconds. */
export const HOUR = 60 * MIN
/** One day in seconds. */
export const DAY = 24 * HOUR
/** One week in seconds. */
export const WEEK = 7 * DAY
/** One year in seconds (accounting for leap years). */
export const YEAR = 365.2422 * DAY
