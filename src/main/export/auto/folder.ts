import { accessSync, constants, existsSync, statSync } from 'node:fs'
import { extname, isAbsolute, resolve } from 'node:path'
import { safeJoin } from '../atomic'

/** Electron `dialog.showOpenDialog` for one folder, or a test double. */
export type AutoExportFolderDialog = () => Promise<{ canceled: boolean; filePaths: string[] }>

/**
 * A folder is usable for automatic exports when it is an absolute, already
 * normalized path (no `..` or `.` segments, no NUL), exists, is a directory,
 * and this process can write into it. Only paths the native folder dialog
 * returned are ever stored; this check runs again before every write.
 */
export function usableExportFolder(folder: unknown): folder is string {
  if (typeof folder !== 'string' || folder.length === 0 || folder.length > 4096) return false
  if (folder.includes('\0') || !isAbsolute(folder)) return false
  if (folder.split(/[\\/]/).some((part) => part === '..' || part === '.')) return false
  // A trailing separator is the only difference from the resolved path allowed.
  const trimmed = folder.replace(/[\\/]+$/, '') || folder
  if (resolve(folder) !== folder && resolve(trimmed) !== trimmed) return false
  try {
    if (!statSync(folder).isDirectory()) return false
    accessSync(folder, constants.W_OK)
    return true
  } catch {
    return false
  }
}

/** Highest " (n)" suffix tried before giving up. */
const MAX_SUFFIX = 999

/**
 * A full path for `filename` in `folder` that does not exist yet, so an earlier
 * export is never replaced: `name.pdf`, then `name (2).pdf`, `name (3).pdf`…
 * Null when every name up to {@link MAX_SUFFIX} is taken. `filename` must be a
 * bare name (`safeJoin` refuses separators and traversal).
 */
export function freshExportPath(
  folder: string,
  filename: string,
  exists: (filePath: string) => boolean = existsSync
): string | null {
  const first = safeJoin(folder, filename)
  if (!exists(first)) return first
  const extension = extname(filename)
  const stem = extension.length > 0 ? filename.slice(0, -extension.length) : filename
  for (let n = 2; n <= MAX_SUFFIX; n += 1) {
    const candidate = safeJoin(folder, `${stem} (${n})${extension}`)
    if (!exists(candidate)) return candidate
  }
  return null
}
