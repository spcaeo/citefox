import type { ProjectDetail } from '@shared/ipc'
import type { ProjectDrillActions } from './components/ProjectDrills'

/** What the Projects list, its row menu and its drills can do. */
export interface ProjectActions extends ProjectDrillActions {
  onOpen: (projectId: string) => Promise<void>
  onSettings: (projectId: string) => void
  onToggleStatus: (project: ProjectDetail) => Promise<void>
  onRestore: (project: ProjectDetail) => Promise<void>
}

/**
 * The row menu's edits (deep audit setup S5.3): Rename inline, Duplicate,
 * Export, Archive and Delete. Omitted (previews): the menu only navigates.
 */
export interface ProjectRowActions {
  /** Resolves true once saved, so the name field closes. */
  onRename: (project: ProjectDetail, name: string) => Promise<boolean>
  /** Duplicate, Export and Delete need the admin client; left out without it. */
  onDuplicate?: (project: ProjectDetail) => Promise<void>
  onExport?: (project: ProjectDetail) => Promise<void>
  onArchive: (project: ProjectDetail) => Promise<void>
  /** Opens the delete confirm. */
  onDelete?: (project: ProjectDetail) => void
}
