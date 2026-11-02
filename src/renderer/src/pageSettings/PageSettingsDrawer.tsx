import { useEffect, useMemo, useState, type JSX } from 'react'
import { intervalDaysText, type IntervalDays, type SampleCount } from '@shared/domain'
import type { PageDetail } from '@shared/ipc'
import { errorText } from '../components/errorText'
import type { ShellClient } from '../projects/client'
import { openDrawer } from '../shell/drawers'
import { marketLabel } from '../shell/model'
import { pageHash } from '../shell/routes'
import {
  Button,
  Confirm,
  Drawer,
  DrawerField,
  DrawerFields,
  DrawerGrid,
  DrawerMain,
  DrawerRail,
  DrawerSection,
  showUndo
} from '../ui'
import {
  changesFor,
  formFromPage,
  INTERVAL_CHOICES,
  labelProblem,
  restorableStatus,
  SAMPLE_CHOICES,
  searchesLine,
  searchesPerCheck,
  urlProblem,
  type PageSettingsForm,
  type PageSettingsSection
} from './model'
import './page-settings.css'

export type PageSettingsClient = Pick<
  ShellClient,
  'updatePage' | 'removePage' | 'pinPage' | 'unpinPage' | 'listPrompts'
>

export interface PageSettingsDrawerProps {
  client: PageSettingsClient
  projectId: string
  page: PageDetail
  /** The section a header chip opened (`ps.section`). */
  section: PageSettingsSection | null
  onClose: () => void
  /** The page changed (saved, paused, pinned): reload the header and tabs. */
  onChanged: (page: PageDetail | null) => void
  /** The pin changed: reload the sidebar's pinned pages. */
  onPinsChanged: () => void
  /** Closes the drawer, then opens `hash` (a crumb-like jump). */
  navigate: (hash: string) => void
  /** Where Remove lands. */
  afterRemoveHash: string
}

const STATUS_WORDS: Record<string, string> = {
  setting_up: 'Setting up',
  tracked: 'Tracked',
  paused: 'Paused',
  not_tracked: 'Not tracked',
  removed: 'Removed'
}

/**
 * Page settings (deep audit page §2b): the page's label and URL, how often it is
 * checked and with how many samples, its default market, pause and pin, and
 * Remove (with Undo). Opened from the page header's chips, on the URL as
 * `drawer=page-settings&ps.section=<section>`.
 */
export function PageSettingsDrawer({
  client,
  projectId,
  page,
  section,
  onClose,
  onChanged,
  onPinsChanged,
  navigate,
  afterRemoveHash
}: PageSettingsDrawerProps): JSX.Element {
  const isTopic = page.kind === 'topic'
  const noun = isTopic ? 'topic' : 'page'
  const [form, setForm] = useState<PageSettingsForm>(() => formFromPage(page))
  const [busy, setBusy] = useState<'save' | 'status' | 'pin' | 'remove' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [questions, setQuestions] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.resolve()
      .then(() => client.listPrompts({ projectId, pageId: page.id }))
      .then(
        (set) => {
          if (!cancelled) setQuestions(set.prompts.filter((prompt) => prompt.enabled).length)
        },
        () => {
          if (!cancelled) setQuestions(null)
        }
      )
    return () => {
      cancelled = true
    }
  }, [client, projectId, page.id])

  const request = useMemo(() => changesFor(page, form, projectId), [page, form, projectId])
  const dirty = request !== null
  const urlError = urlProblem(form.url, isTopic)
  const labelError = labelProblem(form.label)
  const invalid = urlError !== null || labelError !== null
  const range = searchesPerCheck(questions ?? page.promptCount, form.samples, page.markets.length)
  const name = page.label ?? page.title ?? page.url ?? 'this page'

  function patch(next: Partial<PageSettingsForm>): void {
    setForm((current) => ({ ...current, ...next }))
    setError(null)
  }

  async function save(): Promise<void> {
    if (request === null || invalid) return
    setBusy('save')
    setError(null)
    try {
      const saved = await client.updatePage(request)
      onChanged(saved)
      showUndo({
        message: `Saved the ${noun} settings.`,
        effect: request.url !== undefined ? 'Past results stay with this page.' : null
      })
      onClose()
    } catch (cause) {
      setError(errorText(cause, `Could not save the ${noun} settings.`))
    } finally {
      setBusy(null)
    }
  }

  async function setPaused(paused: boolean): Promise<void> {
    setBusy('status')
    setError(null)
    const before = page.status === 'paused' ? 'paused' : 'tracked'
    try {
      const saved = await client.updatePage({
        projectId,
        pageId: page.id,
        status: paused ? 'paused' : 'tracked'
      })
      onChanged(saved)
      showUndo({
        message: paused ? `Paused checks of ${name}.` : `Resumed checks of ${name}.`,
        undo: async () => {
          onChanged(await client.updatePage({ projectId, pageId: page.id, status: before }))
        }
      })
    } catch (cause) {
      setError(errorText(cause, 'Could not change the status.'))
    } finally {
      setBusy(null)
    }
  }

  async function togglePin(): Promise<void> {
    setBusy('pin')
    setError(null)
    try {
      if (page.pinned) await client.unpinPage({ projectId, pageId: page.id })
      else await client.pinPage({ projectId, pageId: page.id })
      onChanged({ ...page, pinned: !page.pinned })
      onPinsChanged()
    } catch (cause) {
      setError(errorText(cause, 'Could not change the pin.'))
    } finally {
      setBusy(null)
    }
  }

  async function remove(): Promise<void> {
    setBusy('remove')
    const back = restorableStatus(page.status)
    try {
      await client.removePage({ projectId, pageId: page.id })
      setConfirmRemove(false)
      onPinsChanged()
      navigate(afterRemoveHash)
      showUndo({
        message: `Removed ${name}.`,
        effect: 'Its past checks stay in History.',
        ...(back
          ? {
              undo: async () => {
                await client.updatePage({ projectId, pageId: page.id, status: back })
                onPinsChanged()
                navigate(pageHash(page.id, 'results'))
              }
            }
          : {})
      })
    } catch (cause) {
      setConfirmRemove(false)
      setError(errorText(cause, `Could not remove this ${noun}.`))
    } finally {
      setBusy(null)
    }
  }

  const paused = page.status === 'paused'
  const focus = (target: PageSettingsSection): { 'data-autofocus'?: true } =>
    section === target ? { 'data-autofocus': true } : {}

  return (
    <>
      <Drawer
        id="page-settings"
        title={isTopic ? 'Topic settings' : 'Page settings'}
        subtitle={`${name} · how it is checked, where, and what it is called`}
        status={STATUS_WORDS[page.status]}
        dirty={dirty}
        busy={busy !== null}
        closeDisabled={busy === 'save' || busy === 'remove'}
        onClose={onClose}
        testId="page-settings-drawer"
        footer={{
          summary: error ? (
            <span className="pset-error" role="alert">
              {error}
            </span>
          ) : (
            <span>
              {dirty ? 'Unsaved changes · ' : ''}
              {searchesLine(range, form.intervalDays)}
            </span>
          ),
          danger: {
            label: `Remove ${noun}`,
            icon: 'trash',
            onClick: () => setConfirmRemove(true),
            disabled: busy !== null || page.status === 'removed'
          },
          primary: {
            label: 'Save settings',
            onClick: () => void save(),
            busy: busy === 'save',
            disabled: !dirty || invalid || busy !== null
          }
        }}
      >
        <DrawerGrid>
          <DrawerMain>
            <DrawerSection
              title="Name and address"
              description="The label shows in the sidebar and lists. Past results stay with this page when the address changes."
              testId="pset-identity"
            >
              <DrawerFields columns={isTopic ? 1 : 2}>
                <DrawerField
                  label="Label"
                  hint={`Optional. Empty uses the ${isTopic ? 'name' : 'page title'}.`}
                  error={labelError}
                  counter={`${form.label.trim().length} / 80`}
                >
                  {({ id, describedBy }) => (
                    <input
                      id={id}
                      aria-describedby={describedBy}
                      className="ui-input"
                      value={form.label}
                      placeholder={page.title ?? ''}
                      onChange={(event) => patch({ label: event.target.value })}
                      {...focus('identity')}
                    />
                  )}
                </DrawerField>
                {isTopic ? null : (
                  <DrawerField
                    label="Page address"
                    hint="After a redirect, paste the new address."
                    error={urlError}
                  >
                    {({ id, describedBy }) => (
                      <input
                        id={id}
                        aria-describedby={describedBy}
                        aria-invalid={urlError !== null || undefined}
                        className="ui-input mono"
                        type="url"
                        value={form.url}
                        onChange={(event) => patch({ url: event.target.value })}
                      />
                    )}
                  </DrawerField>
                )}
              </DrawerFields>
            </DrawerSection>
            <DrawerSection
              title="Schedule"
              description="How often CiteFox checks every question, and how many times each search runs."
              testId="pset-schedule"
            >
              <DrawerFields columns={2}>
                <DrawerField label="Check every" hint="Each market has its own next check.">
                  {({ id, describedBy }) => (
                    <select
                      id={id}
                      aria-describedby={describedBy}
                      className="ui-input"
                      value={form.intervalDays}
                      onChange={(event) =>
                        patch({ intervalDays: Number(event.target.value) as IntervalDays })
                      }
                      {...focus('schedule')}
                    >
                      {INTERVAL_CHOICES.map((days) => (
                        <option key={days} value={days}>
                          {intervalDaysText(days)}
                        </option>
                      ))}
                    </select>
                  )}
                </DrawerField>
                <DrawerField
                  label="Samples per question"
                  hint="More samples smooth out Google's changes and cost more."
                >
                  {({ id, describedBy }) => (
                    <select
                      id={id}
                      aria-describedby={describedBy}
                      className="ui-input"
                      value={form.samples}
                      onChange={(event) =>
                        patch({ samples: Number(event.target.value) as SampleCount })
                      }
                    >
                      {SAMPLE_CHOICES.map((count) => (
                        <option key={count} value={count}>
                          {count === 1 ? '1 sample' : `${count} samples`}
                        </option>
                      ))}
                    </select>
                  )}
                </DrawerField>
              </DrawerFields>
              <p className="pset-cost num" data-testid="pset-cost">
                {questions === null ? `${page.promptCount} questions` : `${questions} questions`} ×{' '}
                {form.samples} × {page.markets.length}{' '}
                {page.markets.length === 1 ? 'market' : 'markets'} ·{' '}
                {searchesLine(range, form.intervalDays)}
              </p>
            </DrawerSection>
            <DrawerSection
              title="Default market"
              count={page.markets.length}
              description="The market this page opens in, and the one its score uses."
              actions={
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => navigate(pageHash(page.id, 'markets'))}
                >
                  Manage markets
                </Button>
              }
              testId="pset-markets"
            >
              <fieldset className="pset-markets">
                <legend className="sr-only">Default market</legend>
                {page.markets.map((market, index) => (
                  <label key={market.id} className="pset-market">
                    <input
                      type="radio"
                      name="pset-default-market"
                      value={market.id}
                      checked={form.defaultMarketId === market.id}
                      onChange={() => patch({ defaultMarketId: market.id })}
                      {...(index === 0 ? focus('markets') : {})}
                    />
                    <span>
                      {marketLabel(market)}
                      {market.device === 'mobile' ? ' · Mobile' : ''}
                    </span>
                    {page.defaultMarketId === market.id ? (
                      <span className="pset-tag">default now</span>
                    ) : null}
                  </label>
                ))}
              </fieldset>
              <Button
                size="sm"
                variant="text"
                icon="plus"
                onClick={() =>
                  openDrawer(
                    'add-market',
                    { 'am.page': page.id },
                    { onResult: () => onChanged(null) }
                  )
                }
              >
                Add a market to this {noun}
              </Button>
            </DrawerSection>
          </DrawerMain>
          <DrawerRail label={`${isTopic ? 'Topic' : 'Page'} status`}>
            <DrawerSection
              title="Checks"
              description={
                paused
                  ? 'Paused: no scheduled checks run. Check now still works.'
                  : 'Checks run on the schedule.'
              }
              testId="pset-status"
            >
              <Button
                variant="secondary"
                icon={paused ? 'play' : 'pause'}
                busy={busy === 'status'}
                disabled={busy !== null || page.status === 'removed'}
                onClick={() => void setPaused(!paused)}
                {...focus('status')}
              >
                {paused ? 'Resume checks' : 'Pause checks'}
              </Button>
            </DrawerSection>
            {isTopic ? null : (
              <DrawerSection
                title="Sidebar"
                description={
                  page.pinned ? 'Pinned under Pages in the sidebar.' : 'Not pinned in the sidebar.'
                }
              >
                <Button
                  variant="secondary"
                  busy={busy === 'pin'}
                  disabled={busy !== null || page.status === 'removed'}
                  onClick={() => void togglePin()}
                >
                  {page.pinned ? 'Unpin from sidebar' : 'Pin to sidebar'}
                </Button>
              </DrawerSection>
            )}
            <DrawerSection title="What stays">
              <p className="pset-note">
                Changes apply from the next check. Past checks, results and History stay as they
                are.
              </p>
            </DrawerSection>
          </DrawerRail>
        </DrawerGrid>
      </Drawer>
      {confirmRemove ? (
        <Confirm
          title={`Remove ${name}?`}
          body={`It stops being checked and leaves the ${isTopic ? 'Topics' : 'All pages'} list. Its past checks stay in History, and Undo brings it back.`}
          confirmLabel={`Remove ${noun}`}
          busy={busy === 'remove'}
          onConfirm={() => void remove()}
          onCancel={() => setConfirmRemove(false)}
          testId="pset-confirm-remove"
        />
      ) : null}
    </>
  )
}
