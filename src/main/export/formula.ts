/**
 * Spreadsheet formula injection (OWASP).
 * A text cell whose first character is `=`, `+`, `-`, `@`, tab, or CR is prefixed
 * with a single quote so Excel and Sheets treat it as text.
 * Numeric, date, and boolean cells are written as themselves.
 * This applies only to text.
 */
const FORMULA_START = new Set(['=', '+', '-', '@', '\t', '\r'])

export function startsFormula(value: string): boolean {
  return value.length > 0 && FORMULA_START.has(value[0] ?? '')
}

export function neutralizeFormula(value: string): string {
  if (!startsFormula(value)) return value
  return `'${value}`
}
