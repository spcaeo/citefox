/** Closed-list guard used by the `is*` helpers in this folder. Not re-exported. */
export function isOneOf<T extends string>(values: readonly T[], value: string): value is T {
  return values.some((item) => item === value)
}
