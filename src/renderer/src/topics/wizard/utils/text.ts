/** Text helpers shared by the wizard steps. */

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function namesAny(text: string, names: readonly string[]): boolean {
  return names.some((name) => {
    const trimmed = name.trim()
    if (trimmed.length < 2) return false
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(trimmed)}($|[^\\p{L}\\p{N}])`, 'iu').test(
      text
    )
  })
}
