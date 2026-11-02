import { isAbsolute, relative, resolve } from 'node:path'
import { StorageError } from './errors'

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/
const MAX_SLUG_LENGTH = 64

/** Lowercase slug safe to use as a single path segment. */
export function isSafeProjectSlug(slug: string): boolean {
  if (slug.length === 0 || slug.length > MAX_SLUG_LENGTH) return false
  if (!SLUG.test(slug) || WINDOWS_RESERVED.test(slug)) return false
  if (/^[a-f0-9]{64}$/.test(slug)) return false
  return true
}

export function assertSafeProjectSlug(slug: string): void {
  if (!isSafeProjectSlug(slug)) throw new StorageError('Invalid project slug')
}

/**
 * A slug made from a project name or a domain label.
 * Returns null when the result is empty, reserved, or a 64-character hex key.
 */
export function slugFromLabel(label: string): string | null {
  const ascii = label.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  let slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (slug.length > MAX_SLUG_LENGTH) {
    slug = slug.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, '')
  }
  if (!isSafeProjectSlug(slug)) return null
  return slug
}

/** Relative path stored in `projects.db_path`. */
export function projectDatabaseRelativePath(slug: string): string {
  assertSafeProjectSlug(slug)
  return `projects/${slug}.sqlite`
}

/**
 * Absolute path of `projects/<slug>.sqlite`. The slug is one path segment, so
 * `..`, separators, and absolute paths cannot escape `projectsDirectory`.
 */
export function projectDatabasePath(projectsDirectory: string, slug: string): string {
  assertSafeProjectSlug(slug)
  const root = resolve(projectsDirectory)
  const filePath = resolve(root, `${slug}.sqlite`)
  const fromRoot = relative(root, filePath)
  if (fromRoot !== `${slug}.sqlite` || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new StorageError('Invalid project slug')
  }
  return filePath
}
