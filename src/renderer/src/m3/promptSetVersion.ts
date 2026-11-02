/**
 * Local copy of App's `promptSetVersionLabel` (shell/model.ts on PR #97, not on main).
 * When that export lands, replace this function with:
 * `export { promptSetVersionLabel } from '../shell/model'`
 *
 * Saved prompt-set versions start at 1.
 * Null, missing, 0, and non-integers are not a version.
 */
export function promptSetVersionLabel(version: number | null | undefined): string {
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return 'version unknown'
  }
  return `v${version}`
}

/**
 * Trend-line group. Unknown values share null, so a missing version is not a
 * change to or from 0. The stored key is null, and null equals only null.
 * A saved version equals only that same integer.
 */
export function promptSetVersionGroup(version: number | null | undefined): number | null {
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return null
  return version
}

export function samePromptSetVersion(
  left: number | null | undefined,
  right: number | null | undefined
): boolean {
  return promptSetVersionGroup(left) === promptSetVersionGroup(right)
}

/** Missing stays null. Never coerce with `?? 0`. */
export function readPromptSetVersion(version: number | null | undefined): number | null {
  return typeof version === 'number' ? version : null
}
