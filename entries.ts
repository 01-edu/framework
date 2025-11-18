/**
 * Setup Entries, this is made for applications that want to be organized with
 * entries as a generic fact representing all of the app state and changes.
 * This takes inspiration from star schema and event sourcing.
 * Entries additionally share concepts with our context module to embed
 * structural request information like the session automatically per entry
 * @module
 */

import { assertEquals } from '@std/assert/equals'
import {
  createTable,
  db,
  type DBTypes,
  sql,
  type TableAPI,
  type TableProperties,
} from './db.ts'
import { getContext } from './context.ts'
import { now } from './time.ts'
import type { Expand } from './types.ts'

type EntryListenerGeneric<T extends TableProperties> = {
  controller: ReadableStreamDefaultController
} & { [K in keyof T]: DBTypes[T[K]['type']] }

type EntryProperties<T extends TableProperties> = Exclude<
  Expand<
    keyof (TableAPI<string, T & typeof commonEntryProperties>)['properties']
  >,
  'id' | 'archivedAt' | 'span' | 'trace'
>
type EntryTriggerGeneric<T extends TableProperties> = (
  entry: Parameters<
    (TableAPI<string, T & typeof commonEntryProperties>)['insert']
  >[0],
  sub: EntryListenerGeneric<T>,
) => boolean

type EntryField = { type: keyof DBTypes; description: string }
type EntryTypeDef<T extends TableProperties> = Expand<
  {
    data?: string
    fields?: Record<string, EntryField>
    trigger?: EntryTriggerGeneric<T>
  } & { [K in EntryProperties<T>]?: string }
>

const typeProperties = {
  typeId: { type: 'INTEGER', primary: true },
  typeName: { type: 'TEXT' },
} as const

const TypeInternal: TableAPI<'type', typeof typeProperties> = createTable(
  'type',
  typeProperties,
)

const commonEntryProperties = {
  id: { type: 'INTEGER', primary: true },
  type: { type: 'INTEGER', join: TypeInternal },

  // Lifetime
  createdAt: { type: 'REAL', default: now },
  archivedAt: { type: 'REAL', optional: true },

  // logging
  trace: { type: 'REAL', optional: true },
  span: { type: 'REAL', optional: true },
} as const

type EntryInsert<R extends TableProperties> = Required<
  Parameters<TableAPI<'entryInternal', R>['insert']>[0]
>

type EntryInsertParams<K extends string, R extends TableProperties> = Pick<
  EntryInsert<R>,
  Extract<keyof EntryInsert<R>, keyof ({ [K: string]: EntryTypeDef<R> })[K]>
>
type FieldParamsForEntry<T> = T extends { fields: Record<string, EntryField> }
  ? { [K in keyof T['fields']]: DBTypes[T['fields'][K]['type']] }
  : never

type InsertParams<K extends string, R extends TableProperties> =
  ({ [K: string]: EntryTypeDef<R> })[K] extends
    { fields: Record<string, EntryField> } ? Expand<
      & EntryInsertParams<K, R>
      & FieldParamsForEntry<({ [K: string]: EntryTypeDef<R> })[K]>
    >
    : EntryInsertParams<K, R>

export const initEntries = <
  const R extends TableProperties,
  const ET extends { [K: string]: EntryTypeDef<R> },
  const ID extends Record<keyof ET & string, number>, // this is an enum
>(relations: R, entryTypes: ET, entryIds: ID): {
  type: ID
  insertListeners: Set<EntryListenerGeneric<R>>
  view: { [K in (keyof ET & string)]: `entry_${Lowercase<K>}` }
  archive: (id: number) => void
  insert: {
    [K in (keyof ET & string)]: (params: InsertParams<K, R>) => number
  }
} => {
  type EntryTrigger = EntryTriggerGeneric<R>
  type EntryListener = EntryListenerGeneric<R>
  type EntryName = keyof ET & string

  const EntryInternal = createTable('entryInternal', {
    ...relations,
    ...commonEntryProperties,
  })

  db.exec(`
    CREATE VIEW IF NOT EXISTS entry AS
    SELECT *
    FROM entryInternal
    WHERE archivedAt IS NULL;
  `)

  const insertListeners = new Set<EntryListener>()

  const internalInsertEntry =
    (shouldTrigger: EntryTrigger) =>
    (entry: Parameters<typeof EntryInternal.insert>[0]) => {
      const entryId = EntryInternal.insert(entry)
      let payload

      for (const sub of insertListeners) {
        if (!shouldTrigger(entry, sub)) continue
        payload ||
          (payload = new TextEncoder().encode(
            `data: [${(entry as unknown as { createdAt: number }).createdAt},${
              (entry as unknown as { type: ET[EntryName] }).type
            },${entryId}]\n\n`,
          ))

        try {
          sub.controller.enqueue(payload)
        } catch {
          insertListeners.delete(sub)
        }
      }
      return entryId
    }

  const fieldTables: Record<string, unknown> = {}
  const entryNames = Object.keys(entryTypes) as EntryName[]
  const insert = Object.fromEntries(
    entryNames.map((k) => {
      const type = entryIds[k]
      const trigger = (entryTypes[k] as { trigger?: EntryTrigger }).trigger
      const insertEntry = trigger
        ? internalInsertEntry(trigger)
        : EntryInternal.insert
      const fieldEntry = Object.entries(
        (entryTypes[k] as { fields?: Record<string, EntryField> }).fields || {},
      ) as [string, EntryField][]

      const fields: typeof fieldTables = {}
      for (const [name, { type }] of fieldEntry) {
        if (name in fieldTables) {
          // TODO: ensure they share the same type !
          // maybe we should append the type
          // or have one per type, but then how to name the field ?
          fields[name] = fieldTables[name]
        } else {
          const tableName = `entry${name[0].toUpperCase()}${name.slice(1)}`
          const table = createTable(tableName, {
            fieldId: { type: 'INTEGER', primary: true },
            entryId: { type: 'INTEGER', join: EntryInternal },
            [name]: { type },
          })

          fieldTables[name] = table
          fields[name] = table
        }
      }

      return [
        k,
        Object.keys(fields).length
          ? (params: EntryInsertParams<typeof k, R>) => {
            const { trace, span } = getContext()
            const fieldsParams: {
              table: TableAPI<string, TableProperties>
              value: unknown
              name: string
            }[] = []
            const entryParams: Record<string, unknown> = {
              type,
              createdAt: now(),
              trace,
              span,
            }
            for (const [name, value] of Object.entries(params)) {
              const table = fields[name] as TableAPI<string, TableProperties>
              if (table) {
                fieldsParams.push({ table, value, name })
              } else {
                entryParams[name] = value
              }
            }

            const entryId = insertEntry(
              entryParams as Parameters<typeof insertEntry>[0],
            )
            for (const { table, value, name } of fieldsParams) {
              table.insert({ entryId, [name]: value })
            }

            return entryId
          }
          : (params: EntryInsertParams<typeof k, R>) => {
            const { trace, span } = getContext()
            return insertEntry(
              { trace, span, ...params, type, createdAt: now() } as Record<
                string,
                unknown
              > as Parameters<typeof insertEntry>[0],
            )
          },
      ]
    }),
  ) as unknown as {
    [K in EntryName]: (params: InsertParams<K, R>) => number
  }

  const getTypeName = TypeInternal.sql<'typeName', number>`
    SELECT typeName FROM type
    WHERE typeId = ?
  `.get

  // Check that the types we have match the type name we have
  // and insert missing types
  for (
    const typeName of entryNames.sort((a, b) => entryIds[a] - entryIds[b])
  ) {
    const id = entryIds[typeName] as number
    const match = getTypeName(id)
    if (!match) {
      const insertedId = TypeInternal.insert({ typeName })
      assertEquals(insertedId, id, `Unexpected EntryType ${typeName} id`)
    } else if (match) {
      assertEquals(match.typeName, typeName, `Unexpected EntryType ${id} name`)
    }
  }

  // Generate basic indexes for relations
  for (const rel of Object.keys(relations)) {
    sql`
      CREATE INDEX IF NOT EXISTS idx_entry_${rel}
      ON entryInternal(${rel}) WHERE ${rel} IS NOT NULL
    `.run()

    sql`
      CREATE INDEX IF NOT EXISTS idx_entry_${rel}_type
      ON entryInternal(${rel}, type) WHERE ${rel} IS NOT NULL
    `.run()
  }

  const view = Object.fromEntries(
    entryNames.map((entryTypeName) => {
      const type = entryIds[entryTypeName]
      const viewName = `entry_${entryTypeName.toLowerCase()}`

      sql`CREATE VIEW IF NOT EXISTS "${viewName}" AS
        SELECT *
        FROM entry
        WHERE type = ${type}
      `.run()

      return [entryTypeName, viewName]
    }),
  ) as { [K in EntryName]: `entry_${Lowercase<K>}` }

  // TODO: find a way to return this so we can import it in the api

  // type EntryRow = Row<typeof EntryInternal.properties>
  // type HasTrigger<T> = {
  // [K in keyof T]: T[K] extends { trigger: EntryTrigger } ? K : never
  // }[keyof T]
  // type EntryWithTrigger = HasTrigger<ET>

  const archive = sql<undefined, number>`
    UPDATE entryInternal
    SET archivedAt = unixepoch('now','subsec')
    WHERE id = ? AND archivedAt IS NULL;
  `.run as (id: number) => void

  return {
    ...EntryInternal,
    type: entryIds,
    view,
    insert,
    archive,
    insertListeners,
  }
}
