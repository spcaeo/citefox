/** Subset of JSON Schema used by LLM-4. Returns the first problem, or null when the value matches. */
export function schemaError(value: unknown, schema: unknown, path = '$'): string | null {
  if (!isRecord(schema)) return `${path} schema is not an object`
  if (Array.isArray(schema.enum)) {
    const allowed = schema.enum.some((item) => sameJson(item, value))
    if (!allowed) return `${path} is not one of the allowed values`
  }
  if (typeof schema.type === 'string') {
    const typeError = checkType(value, schema.type, path)
    if (typeError !== null) return typeError
  }
  if (schema.type === 'object' || (isRecord(schema.properties) && isRecord(value))) {
    if (!isRecord(value)) return `${path} is not an object`
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (typeof key !== 'string') continue
        if (value[key] === undefined) return `${path}.${key} is required`
      }
    }
    if (isRecord(schema.properties)) {
      for (const key of Object.keys(schema.properties)) {
        if (value[key] === undefined) continue
        const nested = schemaError(value[key], schema.properties[key], `${path}.${key}`)
        if (nested !== null) return nested
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(value)) {
          if (!(key in schema.properties)) return `${path}.${key} is not allowed`
        }
      }
    }
  }
  if (schema.type === 'array' && Array.isArray(value) && schema.items !== undefined) {
    for (let index = 0; index < value.length; index += 1) {
      const nested = schemaError(value[index], schema.items, `${path}[${index}]`)
      if (nested !== null) return nested
    }
  }
  return null
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function checkType(value: unknown, type: string, path: string): string | null {
  if (type === 'object') return isRecord(value) ? null : `${path} is not an object`
  if (type === 'array') return Array.isArray(value) ? null : `${path} is not an array`
  if (type === 'string') return typeof value === 'string' ? null : `${path} is not a string`
  if (type === 'boolean') return typeof value === 'boolean' ? null : `${path} is not a boolean`
  if (type === 'null') return value === null ? null : `${path} is not null`
  if (type === 'integer') {
    return typeof value === 'number' && Number.isInteger(value) ? null : `${path} is not an integer`
  }
  if (type === 'number') return typeof value === 'number' ? null : `${path} is not a number`
  return null
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
