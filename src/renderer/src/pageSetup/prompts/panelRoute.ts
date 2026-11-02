import type { LegacyPanel } from '../legacyPanel'

/**
 * The Prompts tab's drawers used to be side panels on `?filter=` (`edit:<id>`,
 * `rephrase:<id>`, `add`, `settings`). An old link opens the drawer instead.
 */
export function legacyPromptPanel(filter: string | null | undefined): LegacyPanel | null {
  if (!filter) return null
  if (filter === 'settings') return { key: 'filter', id: 'pt-settings' }
  if (filter === 'add') return { key: 'filter', id: 'pt-add' }
  const [kind, id] = filter.split(':')
  if (kind === 'edit' && id) return { key: 'filter', id: 'pt-edit', values: { 'pt.edit': id } }
  if (kind === 'rephrase' && id) {
    return { key: 'filter', id: 'pt-rephrase', values: { 'pt.rephrase': id } }
  }
  return null
}
