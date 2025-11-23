/**
 * High-performance, schema-based validation library.
 *
 * Uses pre-compiled functions (via `new Function`) for validation speeds
 * comparable to raw JavaScript, with full TypeScript inference.
 *
 * @module Validator
 *
 * @example
 * ```ts
 * import { OBJ, STR, NUM, ARR, optional, type Asserted } from '@01edu/validator'
 *
 * // 1. Define Schema
 * const User = OBJ({
 *   id: NUM('internal user database ID'),
 *   name: STR('user full name, may includes spaces'),
 *   tags: ARR(STR('tags descriptive labels'), 'list of tags associated to the user'),
 *   meta: optional(OBJ({
 *     active: NUM('treating 1/0 as boolean'),
 *   }))
 * })
 *
 * // 2. Infer Type
 * type User = Asserted<typeof User>
 * // { id: number; name: string; tags: string[]; meta?: { active: number } }
 *
 * // 3. Validate
 * const data = await req.json()
 * try {
 *   const user = User.assert(data) // Returns typed 'User' or throws
 * } catch (e) {
 *   const errors = User.report(data) // Returns array of failures
 *   console.log(errors)
 * }
 * ```
 */

type ValidatorFailure<T extends Def> = {
  type: T['type']
  path: (string | number)[]
  value: unknown
}

type Validator<T extends Def> = (
  value: unknown,
  path?: (string | number)[],
) => ValidatorFailure<T>[]

type DefArray<T extends Def> = {
  type: 'array'
  of: Def
  report: Validator<T>
  optional?: boolean
  description?: string
  assert: (value: unknown) => ReturnType<T['assert']>[]
}

type DefList<T extends readonly (string | number)[]> = {
  type: 'list'
  of: T
  report: Validator<DefList<T>>
  optional?: boolean
  description?: string
  assert: (value: unknown) => T[number]
}

type DefUnion<T extends readonly Def[]> = {
  type: 'union'
  of: T
  report: Validator<DefUnion<T>>
  optional?: boolean
  description?: string
  assert: (value: unknown) => ReturnType<T[number]['assert']>
}

type DefObject<T extends Record<string, Def>> = {
  type: 'object'
  properties: { [K in keyof T]: T[K] }
  report: Validator<T[keyof T]>
  optional?: boolean
  description?: string
  assert: (value: unknown) => { [K in keyof T]: ReturnType<T[K]['assert']> }
}

type DefString = {
  type: 'string'
  assert: AssertType<string>
  report: Validator<DefString>
  optional?: boolean
  description?: string
}

type DefNumber = {
  type: 'number'
  assert: AssertType<number>
  report: Validator<DefNumber>
  optional?: boolean
  description?: string
}

type DefBoolean = {
  type: 'boolean'
  assert: AssertType<boolean>
  report: Validator<DefBoolean>
  optional?: boolean
  description?: string
}

/**
 * The base type for all validator definitions.
 */
export type DefBase =
  | DefString
  | DefNumber
  | DefBoolean
  // deno-lint-ignore no-explicit-any
  | DefList<any>
  // deno-lint-ignore no-explicit-any
  | DefArray<any>
  // deno-lint-ignore no-explicit-any
  | DefUnion<any>
  // deno-lint-ignore no-explicit-any
  | DefObject<Record<string, any>>

type OptionalAssert<T extends Def['assert']> = (
  value: unknown,
) => ReturnType<T> | undefined | null

type Optional<T extends Def> = T & {
  assert: OptionalAssert<T['assert']>
}

type AssertType<T> = (value: unknown) => T

/**
 * A validator definition, which can be a base type, an array, an object, or a union.
 */
export type Def<T = unknown> = T extends DefBase ? DefArray<T>
  : T extends Record<string, DefBase> ? DefObject<T>
  : DefBase

/**
 * Infers the asserted type from a validator definition.
 *
 * @template T - The validator definition.
 * @example
 * ```ts
 * import { OBJ, STR, NUM, type Asserted } from './validator.ts';
 *
 * const User = OBJ({
 *   id: NUM(),
 *   name: STR(),
 * });
 *
 * type UserType = Asserted<typeof User>;
 * // { id: number; name: string; }
 * ```
 */
export type Asserted<T> = [T] extends [Def] ? ReturnType<T['assert']> : void

const reportObject = <T extends Record<string, Def>>(properties: T) => {
  const body = [
    'if (!o || typeof o !== "object") return [{ path: p, type: "object", value: o }]',
    'const failures = []',
    ...Object.entries(properties).map(([key, def], i) => {
      const k = JSON.stringify(key)
      const path = `[...p, ${k}]`
      if (def.type === 'object' || def.type === 'array') {
        const check = `
            const _${i} = v[${k}].report(o[${k}], ${path});
            _${i}.length && failures.push(..._${i})
          `
        return def.optional ? `if (o[${k}] !== undefined) {${check}}` : check
      }
      const opt = def.optional ? `o[${k}] === undefined || ` : ''
      return (`${opt}typeof o[${k}] === "${def.type}" || failures.push({ ${
        [`path: ${path}`, `type: "${def.type}"`, `value: o[${k}]`].join(', ')
      } })`)
    }),
    'return failures',
  ].join('\n')

  return new Function('v, o, p = []', body).bind(
    globalThis,
    properties,
  ) as DefObject<T>['report']
}

const assertObject = <T extends Record<string, Def>>(properties: T) => {
  const body = [
    'if (!o || typeof o !== "object") throw Error("type assertion failed")',
    ...Object.entries(properties).map(([key, def]) => {
      const k = JSON.stringify(key)
      return `${
        def.optional ? `v[${k}] === undefined ||` : ''
      }v[${k}].assert(o[${k}])`
    }),
    'return o',
  ].join('\n')

  return new Function('v, o', body).bind(globalThis, properties) as DefObject<
    T
  >['assert']
}

const reportArray = (def: Def) => {
  const body = [
    'if (!Array.isArray(a)) return [{ path: p, type: "array", value: a }]',
    'const failures = []',
    'let i = -1; const max = a.length',
    'while (++i < max) {',
    '  const e = a[i]',
    def.type === 'object' || def.type === 'array'
      ? `const _ = v.report(e, [...p, i]); (_.length && failures.push(..._))`
      : `${
        def.optional ? 'e === undefined ||' : ''
      }typeof e === "${def.type}" || failures.push({ ${
        [
          `path: [...p, i]`,
          `type: "${def.type}"`,
          `value: e`,
        ].join(', ')
      } })`,
    '  if (failures.length > 9) return failures',
    '}',
    'return failures',
  ].join('\n')

  return new Function('v, a, p = []', body)
}

const assertArray = <T extends Def['assert']>(assert: T) => (a: unknown) => {
  if (!Array.isArray(a)) throw Error('type assertion failed')
  a.forEach(assert)
  return a as ReturnType<T>[]
}

const assertNumber = (value: unknown): number => {
  if (typeof value === 'number' && !isNaN(value)) return value
  throw Error(`type assertion failed`)
}

const assertString = (value: unknown): string => {
  if (typeof value === 'string') return value
  throw Error(`type assertion failed`)
}

const assertBoolean = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value
  throw Error(`type assertion failed`)
}

/**
 * Creates a number validator.
 * @param description - An optional description of the number.
 */
export const NUM = (description?: string): DefNumber => ({
  type: 'number',
  assert: assertNumber,
  description,
  report: (value: unknown) => [{ type: 'number', value, path: [] }],
})

/**
 * Creates a string validator.
 * @param description - An optional description of the string.
 */
export const STR = (description?: string): DefString => ({
  type: 'string',
  assert: assertString,
  description,
  report: (value: unknown) => [{ type: 'string', value, path: [] }],
})

/**
 * Creates a boolean validator.
 * @param description - An optional description of the boolean.
 */
export const BOOL = (description?: string): DefBoolean => ({
  type: 'boolean',
  assert: assertBoolean,
  description,
  report: (value: unknown) => [{ type: 'boolean', value, path: [] }],
})

/**
 * Makes a validator optional.
 * @param def - The validator to make optional.
 */
export const optional = <T extends Def>(def: T): Optional<T> => {
  const { assert, description, ...rest } = def
  const optionalAssert: OptionalAssert<typeof assert> = (value: unknown) =>
    value == null ? undefined : assert(value)
  return {
    ...rest,
    description,
    optional: true,
    assert: optionalAssert,
  } as Optional<T>
}

/**
 * Creates an object validator.
 * @param properties - An object of validators for the object's properties.
 * @param description - An optional description of the object.
 */
export const OBJ = <T extends Record<string, Def>>(
  properties: T,
  description?: string,
): DefObject<T> => {
  const report = reportObject(properties)
  const assert = assertObject(properties)
  return { type: 'object', properties, report, assert, description }
}

/**
 * Creates an array validator.
 * @param def - The validator for the array's elements.
 * @param description - An optional description of the array.
 */
export const ARR = <T extends Def>(
  def: T,
  description?: string,
): DefArray<T> => ({
  type: 'array',
  of: def,
  report: reportArray(def).bind(globalThis, def),
  assert: assertArray(def.assert) as DefArray<T>['assert'],
  description,
})

/**
 * Creates a validator for a list of predefined values.
 * @param possibleValues - An array of allowed string or number values.
 * @param description - An optional description of the list.
 */
export const LIST = <const T extends readonly (string | number)[]>(
  possibleValues: T,
  description?: string,
): DefList<T> => ({
  type: 'list',
  of: possibleValues,
  report: (value: unknown, path: (string | number)[] = []) => {
    if (possibleValues.includes(value as T[number])) return []
    return [{
      path,
      type: 'list',
      value,
      expected: possibleValues,
    }]
  },
  assert: (value: unknown): T[number] => {
    if (possibleValues.includes(value as T[number])) {
      return value as T[number]
    }
    throw Error(
      `Invalid value. Expected one of: ${possibleValues.join(', ')}`,
    )
  },
  description,
})

/**
 * Creates a validator for a union of types.
 * @param types - The validators to include in the union.
 */
export const UNION = <T extends readonly Def[]>(...types: T): DefUnion<T> => ({
  type: 'union',
  of: types,
  report: (value: unknown, path: (string | number)[] = []) => {
    const failures: ValidatorFailure<DefUnion<T>>[] = []
    for (const type of types) {
      const result = type.report(value, path)
      if (result.length === 0) return []
      failures.push(...result)
    }
    return failures
  },
  assert: (value: unknown): ReturnType<T[number]['assert']> => {
    for (const type of types) {
      try {
        return type.assert(value)
      } catch {
        // Ignore
      }
    }
    throw Error(
      `Invalid value. Expected one of: ${types.map((t) => t.type).join(', ')}`,
    )
  },
})
