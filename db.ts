/**
 * Create and interact with SQLite database tables.
 * You define the table's columns, and it automatically generates functions to
 * insert, update, find, and run custom SQL queries on that table,
 * reducing sql boilerplate.
 * @module
 */

import { assertEquals } from '@std/assert/equals'
import {
  type BindParameters,
  type BindValue,
  Database,
  type RestBindParameters,
} from '@db/sqlite'
import type { Expand, MatchKeys, UnionToIntersection } from './types.ts'
import { respond } from './response.ts'
import { APP_ENV, ENV } from './env.ts'

const dbPath = ENV('DATABASE_PATH', ':memory:')
export const db: Database = new Database(dbPath)

// MEMORY -> possible corruption on crash during COMMIT
db.exec('PRAGMA temp_store = memory')
db.exec('PRAGMA synchronous = NORMAL ') // OFF -> possible db corruption on power outage
db.exec("PRAGMA encoding = 'UTF-8'")
if (dbPath === 'prod') {
  db.exec('PRAGMA journal_mode = WAL') // OFF -> possible db corruption on ROLLBACK
  // PRAGMA busy_timeout = 5000 -- Timeout set for killing long duration queries
  // PRAGMA wal_autocheckpoint = 0 -- only activate this if high volume
}

export type DBTypes = {
  TEXT: string
  JSON: unknown
  BLOB: Uint8Array
  INTEGER: number
  REAL: number
}

type ColDef = {
  type: keyof DBTypes
  primary?: boolean
  optional?: boolean
  default?: () => unknown
  join?: Table
}

export type TableProperties = Record<string, ColDef>
type Table = { name: string; properties: TableProperties }
type PrimaryKeys<T> = MatchKeys<T, { primary: true }>
type OptionalKeys<T> = MatchKeys<T, { optional: true }>
type RequiredKeys<T> = Exclude<NonPrimaryKeys<T>, OptionalKeys<T>>
type NonPrimaryKeys<T> = Exclude<keyof T, PrimaryKeys<T>>
type InferInsertType<T extends Record<string, { type: keyof DBTypes }>> =
  Expand<
    & { [K in RequiredKeys<T>]: DBTypes[T[K]['type']] }
    & { [K in OptionalKeys<T>]?: DBTypes[T[K]['type']] | null }
  >

type SelectReturnType<T extends Record<string, ColDef>, K extends keyof T> = {
  [Column in K]: DBTypes[T[Column]['type']]
}

type FlattenProperties<T extends TableProperties> = Expand<
  UnionToIntersection<
    {
      [K in keyof T]: T[K] extends { join: Table }
        ? { [P in K]: T[K] } & FlattenProperties<T[K]['join']['properties']>
        : { [P in K]: T[K] }
    }[keyof T]
  >
>

export type Row<
  P extends TableProperties,
  K extends keyof FlattenProperties<P> = keyof FlattenProperties<P>,
> = Expand<SelectReturnType<FlattenProperties<P>, K>>

const isPrimary = ([_, def]: [string, ColDef]) => def.primary

export type TableAPI<N extends string, P extends TableProperties> = {
  name: N
  properties: P
  insert: (entries: InferInsertType<P>) => number
  update: (
    entries: Expand<
      & { [K in PrimaryKeys<P>]: DBTypes[P[K]['type']] }
      & Partial<InferInsertType<P>>
    >,
  ) => number
  exists: (id: number) => boolean
  get: (id: number) => Row<P, keyof FlattenProperties<P>> | undefined
  require: (id: number) => Row<P, keyof FlattenProperties<P>>
  assert: (id: number) => void
  sql: <
    K extends keyof FlattenProperties<P>,
    T extends BindParameters | BindValue | undefined,
  >(sqlArr: TemplateStringsArray, ...vars: unknown[]) => {
    get: (params?: T, ...args: RestBindParameters) => Row<P, K> | undefined
    all: (params?: T, ...args: RestBindParameters) => Row<P, K>[]
  }
}

export const createTable = <N extends string, P extends TableProperties>(
  name: N,
  properties: P,
): TableAPI<N, P> => {
  type FlatProps = FlattenProperties<P>
  const keys = Object.keys(properties)
    .filter((k: keyof P) => !properties[k].primary)

  db.exec(`
    CREATE TABLE IF NOT EXISTS ${name} (${
    [
      ...Object.entries(properties).map(
        ([key, def]) =>
          `  ${key} ${def.type}${
            (def.primary && ' PRIMARY KEY AUTOINCREMENT NOT NULL') ||
            (!def.optional && ' NOT NULL') ||
            ''
          }`,
      ),
      ...Object.entries(properties)
        .filter(([_, def]) => def.join)
        .map(
          ([key, def]) =>
            `  FOREIGN KEY (${key}) REFERENCES ${def.join!.name}(${
              Object.entries(def.join!.properties).find(isPrimary)?.[0]
            })`,
        ),
    ].join(',\n')
  })`)

  const columns = db.sql<ColDef>`
    SELECT
      name,
      type,
      json(CASE WHEN pk = 1 THEN 'true' ELSE 'false' END) as "primary",
      json(CASE WHEN "notnull" = 1 THEN 'false' ELSE 'true' END) as "optional"
    FROM pragma_table_info(${name})
  `

  assertEquals(
    columns,
    Object.entries(properties).map(
      ([name, { join: _, default: __, optional, primary, type }]) => ({
        name,
        type,
        primary: Boolean(primary),
        optional: Boolean(optional),
      }),
    ),
    'Database expected schema and current schema missmatch, maybe you need a migration ?',
  )

  const insertStmt = db.prepare(`
    INSERT INTO ${name} (${keys.join(', ')})
    VALUES (${keys.map((k) => `:${k}`).join(', ')})
  `)

  const insert = (entries: InferInsertType<P>) => {
    insertStmt.run(entries)
    return db.lastInsertRowId
  }

  // Add dynamic update functionality
  const primaryKey = Object.keys(properties)
    .find((k: keyof P) => properties[k].primary)

  const updateStmt = db.prepare(`
    UPDATE ${name} SET
    ${keys.map((k) => `${k} = COALESCE(:${k}, ${k})`).join(', ')}
    WHERE ${primaryKey} = :${primaryKey}
  `)

  const update = (
    entries: Expand<
      & { [K in PrimaryKeys<P>]: DBTypes[P[K]['type']] }
      & Partial<InferInsertType<P>>
    >,
  ) => {
    // Make sure the primary key field exists in the entries
    if (!entries[primaryKey as keyof typeof entries]) {
      throw Error(`Primary key ${primaryKey} must be provided for update`)
    }
    return updateStmt.run(entries)
  }

  const existsStmt = db.prepare(`
    SELECT EXISTS (SELECT 1 FROM ${name} WHERE ${primaryKey} = ?)
  `)

  const notFound = { message: `${name} not found` }
  const exists = (id: number) => existsStmt.value(id)?.[0] === 1
  const assert = (id: number) => {
    if (exists(id)) return
    throw new respond.NotFoundError(notFound)
  }

  const getByIdStmt = db.prepare(
    `SELECT * FROM ${name} WHERE ${primaryKey} = ? LIMIT 1`.trim(),
  )

  const get = (id: number): Row<P, keyof FlatProps> | undefined =>
    getByIdStmt.get(id)

  const require = (id: number) => {
    const match = getByIdStmt.get(id)
    if (!match) throw new respond.NotFoundError(notFound)
    return match as Row<P, keyof FlatProps>
  }

  const sql = <
    K extends keyof FlatProps,
    T extends BindParameters | BindValue | undefined,
  >(sqlArr: TemplateStringsArray, ...vars: unknown[]) => {
    const query = String.raw(sqlArr, ...vars)
    const stmt = db.prepare(query)
    return {
      get: stmt.get.bind(stmt) as (
        params?: T,
        ...args: RestBindParameters
      ) => Row<P, K> | undefined,
      all: stmt.all.bind(stmt) as (
        params?: T,
        ...args: RestBindParameters
      ) => Row<P, K>[],
    }
  }

  return { name, insert, update, exists, get, require, assert, sql, properties }
}

export const sql = <
  T extends { [k in string]: unknown } | undefined,
  P extends BindValue | BindParameters | undefined,
>(sqlArr: TemplateStringsArray, ...vars: unknown[]): {
  get: (params?: P) => T | undefined
  all: (params?: P) => T[]
  run: (params?: P) => void
  value: (params?: P) => T[keyof T][] | undefined
} => {
  const query = String.raw(sqlArr, ...vars)
  const stmt = db.prepare(query)
  return {
    get: stmt.get.bind(stmt) as (params?: P) => T | undefined,
    all: stmt.all.bind(stmt) as (params?: P) => T[],
    run: stmt.run.bind(stmt),
    value: stmt.value.bind(stmt),
  }
}

export const makeRestorePoint = (): () => void => {
  if (APP_ENV === 'prod') {
    return () => {
      throw Error('attempt to reset the database in prod env')
    }
  }
  const emptyDb = new Database(':memory:')
  db.backup(emptyDb)
  return () => emptyDb.backup(db)
}

export const sqlCheck = <T extends BindValue | BindParameters>(
  query: TemplateStringsArray,
  ...args: unknown[]
): (params: T) => boolean => {
  const { value } = sql`SELECT EXISTS(SELECT 1 ${String.raw(query, ...args)})`
  return ((params: T) => value(params)?.[0] === 1)
}
