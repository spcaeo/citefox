import { closeAllDrawers } from './drawers'
import { drawerStack, withDrawerOpened, withDrawersClosed } from './drawerUrl'

/**
 * The shell's own drawers, opened over any route (owner rule: every state has
 * a URL): `#/overview?drawer=add-questions` opens Overview with Add questions
 * over it, and Back closes it (shell/drawers). `new-topic` is New topic
 * (+ Add → Topic, the Topics screen, "New topic from these N" on Questions).
 * Old `?dialog=` links still open them. The build menu's small confirms keep
 * `?dialog=` (`buildMenu/dialogHash.ts`).
 */
export const SHELL_DIALOGS = ['add-questions', 'new-topic'] as const
/** A drawer's subject (`&target=<pageOrTopicId>`), such as the page Add questions adds to. */
export const SHELL_DIALOG_TARGET = 'target'
export type ShellDialog = (typeof SHELL_DIALOGS)[number]

function isShellDialog(value: string | undefined): value is ShellDialog {
  return SHELL_DIALOGS.some((item) => item === value)
}

/** The shell drawer on top in `hash`, or null. */
export function shellDialogFromHash(hash: string): ShellDialog | null {
  const stack = drawerStack(hash)
  const top = stack[stack.length - 1]?.id
  return isShellDialog(top) ? top : null
}

/** The subject Add questions was opened for (`&topic=`, `&page=` or the older `&target=`), or null. */
export function shellDialogTargetFromHash(hash: string): string | null {
  const params = drawerStack(hash).find((entry) => entry.id === 'add-questions')?.params
  return params?.topic ?? params?.page ?? params?.target ?? null
}

/**
 * `hash` with the shell drawer `dialog` opened over the route (or every drawer
 * closed when null); the route and its other values stay. An empty hash is
 * the landing route.
 */
export function withShellDialog(hash: string, dialog: ShellDialog | null): string {
  return dialog ? withDrawerOpened(hash, dialog) : withDrawersClosed(hash, 0)
}

/** Closes the shell drawers, going back through history when they were opened here. */
export function closeShellDialog(): void {
  closeAllDrawers()
}
