import { useEffect, useMemo, useState, type JSX } from 'react'
import type { PageDetail } from '@shared/ipc'
import { errorText } from '../../components/errorText'
import { closeDrawer } from '../../shell/drawers'
import {
  Drawer,
  DrawerFacts,
  DrawerField,
  DrawerFields,
  DrawerGrid,
  DrawerMain,
  DrawerRail,
  DrawerSection,
  UrlText
} from '../../ui'
import { notifyPagesChanged } from './changes'
import { createPagesDrawerClient, type PagesDrawerClient } from './client'
import type { MoveResult } from './MovePagesDrawer'
import { useDrawerValue, type PagesDrawerContext } from './params'

const MAX_LABEL = 120

/**
 * Rename a page (`rename-page`, `rename.id`): the label CiteFox shows instead
 * of the page's title, such as "Pricing" for "Opt-in blog 5". Empty goes back
 * to the title. `pages:update` with `label`; nothing is searched.
 */
export function RenamePageDrawer({
  context,
  client: given
}: {
  context: PagesDrawerContext
  client?: PagesDrawerClient
}): JSX.Element {
  const client = useMemo(() => given ?? createPagesDrawerClient(), [given])
  const { depth, projectId } = context
  const [pageId] = useDrawerValue(context, 'rename.id')
  const [page, setPage] = useState<PageDetail | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tries, setTries] = useState(0)

  useEffect(() => {
    if (!pageId) return
    let live = true
    client['pages:get']({ projectId, pageId }).then(
      (detail) => {
        if (live) {
          setPage(detail)
          setLoadError(null)
        }
      },
      (cause: unknown) => {
        if (live) setLoadError(errorText(cause, 'This page is not available any more.'))
      }
    )
    return () => {
      live = false
    }
  }, [client, projectId, pageId, tries])

  const current = page?.label ?? ''
  const value = draft ?? current
  const trimmed = value.trim()
  const changed = page !== null && trimmed !== current
  const shownName = page ? page.label || page.title || page.url || 'This page' : 'Rename page'

  async function save(): Promise<void> {
    if (!page || !changed) return
    setBusy(true)
    setError(null)
    try {
      await client['pages:update']({
        projectId,
        pageId: page.id,
        label: trimmed.length > 0 ? trimmed : null
      })
      notifyPagesChanged()
      closeDrawer(depth, {
        message:
          trimmed.length > 0
            ? `Renamed to “${trimmed}”.`
            : `“${shownName}” shows its page title again.`
      } satisfies MoveResult)
    } catch (cause) {
      setError(errorText(cause, 'Could not rename the page.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer
      id="rename-page"
      title="Rename page"
      trail={page ? [{ label: shownName }] : undefined}
      subtitle="The name CiteFox shows for this page. Its address and history stay."
      dirty={changed}
      busy={busy}
      closeDisabled={busy}
      loading={!page && !loadError && Boolean(pageId)}
      error={
        loadError || !pageId
          ? {
              message: loadError ?? 'This page is not available any more.',
              onRetry: () => setTries((value) => value + 1)
            }
          : undefined
      }
      onClose={() => closeDrawer(depth)}
      footer={{
        summary: error ? (
          <span role="alert" className="pd-error">
            {error}
          </span>
        ) : (
          'Uses no searches'
        ),
        primary: {
          label: 'Save name',
          disabled: !changed || busy,
          busy,
          onClick: () => void save(),
          testId: 'rename-page-save'
        }
      }}
    >
      {page ? (
        <DrawerGrid>
          <DrawerMain>
            <DrawerSection title="Name">
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  void save()
                }}
              >
                <DrawerFields>
                  <DrawerField
                    label="Page name"
                    hint={`Leave it empty to show the page title${page.title ? ` (“${page.title}”)` : ''}.`}
                    counter={`${trimmed.length} / ${MAX_LABEL}`}
                  >
                    {({ id, describedBy }) => (
                      <input
                        id={id}
                        aria-describedby={describedBy}
                        className="ui-input"
                        value={value}
                        maxLength={MAX_LABEL}
                        data-autofocus
                        onChange={(event) => setDraft(event.target.value)}
                      />
                    )}
                  </DrawerField>
                </DrawerFields>
              </form>
            </DrawerSection>
          </DrawerMain>
          <DrawerRail>
            <DrawerSection title="This page" className="pd-facts">
              <DrawerFacts
                items={[
                  {
                    label: 'Address',
                    value: page.url ? <UrlText url={page.url} /> : '—'
                  },
                  { label: 'Page title', value: page.title ?? 'Not read yet' },
                  { label: 'Shown now', value: shownName }
                ]}
              />
            </DrawerSection>
          </DrawerRail>
        </DrawerGrid>
      ) : null}
    </Drawer>
  )
}
