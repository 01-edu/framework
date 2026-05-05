import type { BindParameters, BindValue, Database as DB } from '@db/sqlite'

/**
 * Forwared DB type from jsr:@db/sqlite
 */
export type Database = DB

/**
 * Tagged-template helper used to build a SQL statement and execute it later.
 *
 * Interpolated `vars` are inserted in the query text. Runtime bind parameters are
 * provided when calling one of the returned methods (`get`, `all`, `run`, `value`).
 *
 * @template T Result row shape returned by `get` and `all`.
 * @template P Bind parameter format accepted by `@db/sqlite`.
 */
export type Sql = <
  T extends { [k in string]: unknown } | undefined,
  P extends BindValue | BindParameters | undefined,
>(sqlArr: TemplateStringsArray, ...vars: unknown[]) => {
  /** Returns the first matching row, or `undefined` if the query returns no rows. */
  get: (params?: P) => T | undefined
  /** Returns all matching rows. */
  all: (params?: P) => T[]
  /** Executes the statement and returns the number of affected rows. */
  run: (params?: P) => number
  /** Returns the selected row values as an array, or `undefined` when no row is found. */
  value: (params?: P) => T[keyof T][] | undefined
}

/**
 * Row shape returned by SQLite `EXPLAIN QUERY PLAN`.
 *
 * @see https://sqlite.org/eqp.html
 */
export type ExplainRow = {
  /** Node id in the query plan tree. */
  id: number
  /** Parent node id (`0` for top-level nodes). */
  parent: number
  /** Human-readable description of the query plan step. */
  detail: string
}

/**
 * Counter values associated with the SQLite sqlite3_stmt_status() interface
 *
 * @see https://sqlite.org/c3ref/c_stmtstatus_counter.html
 */
export type StatementStatus = {
  /** This is the number of times that SQLite has stepped forward in a table as part of a full table scan. Large numbers for this counter may indicate opportunities for performance improvement through careful use of indices. */
  fullscanStep: number
  /** This is the number of sort operations that have occurred. A non-zero value in this counter may indicate an opportunity to improve performance through careful use of indices. */
  sort: number
  /** This is the number of rows inserted into transient indices that were created automatically in order to help joins run faster. A non-zero value in this counter may indicate an opportunity to improve performance by adding permanent indices that do not need to be reinitialized each time the statement is run. */
  autoindex: number
  /** This is the number of virtual machine operations executed by the prepared statement if that number is less than or equal to 2147483647. The number of virtual machine operations can be used as a proxy for the total work done by the prepared statement. If the number of virtual machine operations exceeds 2147483647 then the value returned by this statement status code is undefined. */
  vmStep: number
  /** This is the number of times that the prepare statement has been automatically regenerated due to schema changes or changes to bound parameters that might affect the query plan. */
  reprepare: number
  /** This is the number of times that the prepared statement has been run. A single "run" for the purposes of this counter is one or more calls to sqlite3_step() followed by a call to sqlite3_reset(). The counter is incremented on the first sqlite3_step() call of each cycle. */
  run: number
  /** This is the number of times that a join step was bypassed because a Bloom filter returned not-found. */
  filterHit: number
  /** The corresponding SQLITE_STMTSTATUS_FILTER_MISS value is the number of times that the Bloom filter returned a find, and thus the join step had to be processed as normal. */
  filterMiss: number
  /** This is the approximate number of bytes of heap memory used to store the prepared statement. This value is not a counter. */
  memused: number
}

/**
 * Aggregated metrics for one tracked SQL query shape.
 */
export type Metric = {
  /** Longest single execution time in milliseconds. */
  max: number
  /** SQL query text used as the metric key. */
  query: string
  /** Number of times the statement has been executed. */
  count: number
  /** Total accumulated execution time in milliseconds. */
  duration: number
  /** Query plan details captured for this statement. */
  explain: ExplainRow[]
  /** Sqlite Statement Status counters from sqlite3_stmt_status(). */
  status: StatementStatus
}
