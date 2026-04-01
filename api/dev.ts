import { APP_ENV, DEVTOOL_ACCESS_TOKEN } from './env.ts'
import { respond } from './response.ts'
import type { RequestContext } from '@01edu/types/context'
import { route } from './router.ts'
import { ARR, NUM, OBJ, optional, STR } from './validator.ts'
import type { Metric, Sql } from '@01edu/types/db'

/**
 * Authorizes access to developer routes.
 * Checks for `DEVTOOL_ACCESS_TOKEN` in the Authorization header.
 * In non-prod environments, access is allowed if no token is configured.
 *
 * @param ctx - The request context.
 * @throws {respond.UnauthorizedError} If access is denied.
 */
export const authorizeDevAccess = ({ req }: RequestContext) => {
  if (APP_ENV !== 'prod') return // always open for dev env
  const auth = req.headers.get('Authorization') || ''
  const bearer = auth.toLowerCase().startsWith('bearer ')
    ? auth.slice(7).trim()
    : ''
  if (bearer && bearer === DEVTOOL_ACCESS_TOKEN) return
  throw new respond.UnauthorizedError({ message: 'Unauthorized access' })
}

/**
 * Creates a route handler for executing arbitrary SQL queries.
 * Useful for debugging and development tools.
 *
 * @param sql - The SQL tag function to use for execution.
 * @returns A route handler configuration.
 */
export const createSqlDevRoute = (sql?: Sql) => {
  return route({
    authorize: authorizeDevAccess,
    fn: (_, { query, params }) => {
      try {
        if (!sql) {
          return respond.NotImplemented({
            message: 'Database not configured',
          })
        }
        return sql`${query}`.all(params)
      } catch (error) {
        throw new respond.BadRequestError({
          message: error instanceof Error ? error.message : 'Unexpected Error',
        })
      }
    },
    input: OBJ({
      query: STR('The SQL query to execute'),
      params: optional(OBJ({}, 'The parameters to bind to the query')),
    }),
    output: ARR(
      optional(OBJ({}, 'A single result row')),
      'List of results',
    ),
    description: 'Execute an SQL query',
  })
}

/**
 * Creates a route handler that exposes collected query metrics.
 *
 * @returns A route handler configuration.
 */
export const createQueryMetricsDevRoute = (metrics: Metric[]) =>
  route({
    authorize: authorizeDevAccess,
    fn: () => metrics,
    output: ARR(
      OBJ({
        query: STR('The SQL query text'),
        count: NUM('How many times the query has run'),
        duration: NUM('Total time spent running the query in milliseconds'),
        max: NUM('Longest single query execution in milliseconds'),
        explain: ARR(
          OBJ({
            id: NUM('Query plan node id'),
            parent: NUM('Parent query plan node id'),
            detail: STR('Human-readable query plan detail'),
          }),
          'SQLite EXPLAIN QUERY PLAN rows',
        ),
        status: OBJ({
          fullscanStep: NUM('Number of full table scan steps'),
          sort: NUM('Number of sort operations'),
          autoindex: NUM('Rows inserted into transient auto-indices'),
          vmStep: NUM('Number of virtual machine operations'),
          reprepare: NUM('Number of automatic statement reprepares'),
          run: NUM('Number of statement runs'),
          filterHit: NUM('Bloom filter bypass hits'),
          filterMiss: NUM('Bloom filter misses'),
        }, 'SQLite sqlite3_stmt_status counters'),
      }),
      'Collected query metrics',
    ),
    description: 'List collected SQL query metrics',
  })
