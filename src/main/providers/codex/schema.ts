import { isRecord } from '../json-schema'

/**
 * `codex exec --output-schema` sends the schema to OpenAI in strict mode, which
 * refuses a schema unless every object has `additionalProperties: false` and lists
 * every property in `required` (live run, codex-cli 0.149: "'additionalProperties'
 * is required to be supplied and to be false when strict is true").
 * CiteFox's schemas are written for Claude, where optional fields are normal, so:
 * - every object gets `additionalProperties: false` and all its properties required;
 * - a property that was optional may also be `null`, and `stripOptionalNulls` drops
 *   those nulls again before the reply is checked against the original schema;
 * - keywords strict mode may refuse (lengths, formats, defaults) are left out here.
 *   The original schema still checks them on the reply.
 * Returns null when the schema cannot be made strict (the root is not an object, or
 * an object allows extra keys of its own shape); the call then puts the schema in
 * the prompt instead, and the reply is checked the same way.
 */
export function strictCodexSchema(schema: Record<string, unknown>): Record<string, unknown> | null {
  if (schema.type !== 'object' || !isRecord(schema.properties)) return null
  return strictNode(schema)
}

const KEPT_KEYWORDS = new Set([
  'type',
  'properties',
  'required',
  'items',
  'enum',
  'const',
  'anyOf',
  'description',
  'additionalProperties'
])

function strictNode(node: Record<string, unknown>): Record<string, unknown> | null {
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) {
    if (KEPT_KEYWORDS.has(key)) next[key] = value
  }
  if (Array.isArray(node.anyOf)) {
    const options: Record<string, unknown>[] = []
    for (const option of node.anyOf) {
      if (!isRecord(option)) return null
      const strict = strictNode(option)
      if (strict === null) return null
      options.push(strict)
    }
    next.anyOf = options
  }
  if (isRecord(node.items)) {
    const items = strictNode(node.items)
    if (items === null) return null
    next.items = items
  }
  const isObject = node.type === 'object' || isRecord(node.properties)
  if (!isObject) return next
  if (isRecord(node.additionalProperties)) return null
  const properties = isRecord(node.properties) ? node.properties : {}
  const required = new Set(
    Array.isArray(node.required)
      ? node.required.filter((key): key is string => typeof key === 'string')
      : []
  )
  const strictProperties: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(properties)) {
    if (!isRecord(value)) return null
    const strict = strictNode(value)
    if (strict === null) return null
    strictProperties[key] = required.has(key) ? strict : nullable(strict)
  }
  next.type = 'object'
  next.properties = strictProperties
  next.required = Object.keys(strictProperties)
  next.additionalProperties = false
  return next
}

/** The same schema, also allowing `null`. */
function nullable(node: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray(node.anyOf)) {
    return { ...node, anyOf: [...node.anyOf, { type: 'null' }] }
  }
  const next: Record<string, unknown> = { ...node }
  if (typeof node.type === 'string') next.type = [node.type, 'null']
  else if (Array.isArray(node.type) && !node.type.includes('null'))
    next.type = [...node.type, 'null']
  if (Array.isArray(node.enum) && !node.enum.includes(null)) next.enum = [...node.enum, null]
  if (node.type === undefined && node.enum === undefined) return { anyOf: [node, { type: 'null' }] }
  return next
}

/**
 * Drops `null` from properties the original schema made optional (and does not
 * allow to be null), all the way down, so the reply reads as if the model had left
 * them out. Everything else is returned as it was.
 */
export function stripOptionalNulls(value: unknown, schema: unknown): unknown {
  if (!isRecord(schema)) return value
  if (Array.isArray(value)) {
    return isRecord(schema.items)
      ? value.map((item) => stripOptionalNulls(item, schema.items))
      : value
  }
  if (!isRecord(value) || !isRecord(schema.properties)) return value
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((key): key is string => typeof key === 'string')
      : []
  )
  const next: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    const propertySchema = schema.properties[key]
    if (entry === null && !required.has(key) && !allowsNull(propertySchema)) continue
    next[key] = stripOptionalNulls(entry, propertySchema)
  }
  return next
}

function allowsNull(schema: unknown): boolean {
  if (!isRecord(schema)) return true
  if (schema.type === 'null') return true
  if (Array.isArray(schema.type) && schema.type.includes('null')) return true
  if (Array.isArray(schema.enum) && schema.enum.includes(null)) return true
  if (Array.isArray(schema.anyOf)) return schema.anyOf.some((option) => allowsNull(option))
  return schema.type === undefined && schema.enum === undefined && schema.anyOf === undefined
}

/** The schema as prompt text, for a call that cannot pass it as `--output-schema`. */
export function schemaPromptSuffix(schema: Record<string, unknown>): string {
  return `\n\nReply with JSON only, no other text, matching this JSON Schema:\n${JSON.stringify(schema)}`
}
