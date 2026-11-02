import { showUndo } from '../../ui'
import { WIDGET_INFO } from './catalog'
import { removeWidget, type WidgetSpec } from './model'
import { boardInMemory, ipcBoardStore, pinWidget, saveBoard, type BoardStore } from './store'

/**
 * Pin to Summary from anywhere: adds a widget for this thing to the project's Summary
 * and says so in the window's toast, with Undo. `name` is what is pinned in a few words
 * ("this topic’s trend", "zapier.com").
 */
export async function pinToSummary(
  projectId: string,
  spec: WidgetSpec,
  name: string,
  store?: BoardStore | null
): Promise<void> {
  const where = store === undefined ? ipcBoardStore() : store
  const result = await pinWidget(projectId, spec, where)
  if (result === 'exists') {
    showUndo({ message: `${capital(name)} is on your Summary already.`, testId: 'summary-pin' })
    return
  }
  if (result === 'full') {
    showUndo({
      message: 'Your Summary is full. Remove a widget there first.',
      testId: 'summary-pin'
    })
    return
  }
  const added = boardInMemory(projectId)?.widgets.at(-1) ?? null
  showUndo({
    message: `Pinned ${name} to Summary.`,
    effect: `It shows as a ${WIDGET_INFO[spec.kind].title} widget at the end.`,
    testId: 'summary-pin',
    undo: async () => {
      const now = boardInMemory(projectId)
      if (now === undefined || added === null) return
      await saveBoard(projectId, removeWidget(now, added.id).board, where)
    }
  })
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
