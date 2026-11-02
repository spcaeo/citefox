import { useCallback, useState } from 'react'
import type { CitedSiteRow, CompetitorProductOption } from '@shared/ipc'
import { errorText } from '../../components/errorText'
import { notifyChanged } from '../../shell/changes'
import { showUndo } from '../../ui'
import type { CompetitorsSource } from '../source'

/** What "Add as competitor" needs of a row: Competitors' site rows and Citations' domain rows. */
export type AddableSite = Pick<CitedSiteRow, 'id' | 'name' | 'domain'>

export interface AddCompetitorState {
  /** The row id being saved, else null. */
  saving: string | null
  error: string | null
  notice: string | null
  add: (row: AddableSite) => Promise<boolean>
}

/**
 * "Add as competitor" for a site that is not saved yet, in one click
 * (`competitors:save`, direct): with a product picked it competes with that product,
 * else with the whole business. The toast's Undo puts the saved competitors back.
 * The matcher reads the saved rows, so the row turns into a competitor on the next load.
 */
export function useAddCompetitor(
  source: Pick<CompetitorsSource, 'competitors:save' | 'competitors:restore'>,
  projectId: string,
  product: CompetitorProductOption | null,
  onSaved: () => void
): AddCompetitorState {
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const add = useCallback(
    async (row: AddableSite): Promise<boolean> => {
      const domain = row.domain ?? row.name
      setSaving(row.id)
      setError(null)
      setNotice(null)
      try {
        const result = await source['competitors:save']({
          projectId,
          id: null,
          name: domain,
          domain: row.domain,
          aliases: [],
          tier: 'direct',
          ...(product === null ? {} : { productIds: [product.id] })
        })
        const message =
          product === null
            ? `${domain} is now a saved competitor.`
            : `${domain} is now a competitor of ${product.name}.`
        setNotice(message)
        showUndo({
          message,
          undo: async () => {
            await source['competitors:restore']({ projectId, undoToken: result.undoToken })
            setNotice(null)
            notifyChanged('competitors')
          }
        })
        notifyChanged('competitors')
        onSaved()
        return true
      } catch (cause) {
        setError(errorText(cause, 'Could not save the competitor.'))
        return false
      } finally {
        setSaving(null)
      }
    },
    [source, projectId, product, onSaved]
  )

  return { saving, error, notice, add }
}
