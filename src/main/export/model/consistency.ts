import type { ReportModel } from './types'

/**
 * NFR-14 for a report model: every `{ n, drill }` in the model has a drill list of
 * exactly `n` row ids, and every listed id is a row. Returns one line per problem.
 */
export function drillIssues(model: ReportModel): string[] {
  const issues: string[] = []
  const rowIds = new Set(model.rows.map((row) => row.id))
  for (const [token, ids] of Object.entries(model.drills)) {
    for (const id of ids) {
      if (!rowIds.has(id)) issues.push(`${token}: unknown row ${id}`)
    }
  }
  const visit = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        visit(item, `${path}[${index}]`)
      })
      return
    }
    if (typeof value !== 'object' || value === null) return
    const record = value as Record<string, unknown>
    if (typeof record.n === 'number' && 'drill' in record && Object.keys(record).length === 2) {
      const drill = record.drill
      if (drill === null) return
      if (typeof drill !== 'string') {
        issues.push(`${path}: drill is not a string`)
        return
      }
      const list = model.drills[drill]
      if (list === undefined) issues.push(`${path}: drill ${drill} is missing`)
      else if (list.length !== record.n) {
        issues.push(`${path}: shows ${record.n} but ${drill} lists ${list.length}`)
      }
      return
    }
    for (const [key, child] of Object.entries(record)) {
      if (path === '' && (key === 'drills' || key === 'rows' || key === 'references')) continue
      visit(child, path === '' ? key : `${path}.${key}`)
    }
  }
  visit(model, '')
  return issues
}

/** Every `{ n, drill }` count with a drill, for tests that click through them. */
export function drillCounts(model: ReportModel): { path: string; n: number; drill: string }[] {
  const found: { path: string; n: number; drill: string }[] = []
  const visit = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        visit(item, `${path}[${index}]`)
      })
      return
    }
    if (typeof value !== 'object' || value === null) return
    const record = value as Record<string, unknown>
    if (typeof record.n === 'number' && typeof record.drill === 'string') {
      found.push({ path, n: record.n, drill: record.drill })
      return
    }
    for (const [key, child] of Object.entries(record)) {
      if (path === '' && (key === 'drills' || key === 'rows' || key === 'references')) continue
      visit(child, path === '' ? key : `${path}.${key}`)
    }
  }
  visit(model, '')
  return found
}
