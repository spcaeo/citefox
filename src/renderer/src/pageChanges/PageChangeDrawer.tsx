import { useEffect, useMemo, useState, type JSX } from 'react'
import type { PageChange, PageDiffResult } from '@shared/ipc'
import { useAiContext } from '../assistant/context/useAiContext'
import { errorText } from '../components/errorText'
import { newFixValues, viewFixValues } from '../fixes/drawer/model'
import { todayInput } from '../progress/model'
import type { DrawerEntry } from '../shell/drawerUrl'
import { closeDrawer, openDrawer, setDrawerParams } from '../shell/drawers'
import {
  Drawer,
  DrawerFacts,
  DrawerGrid,
  DrawerSection,
  SegmentedControl,
  UrlText,
  type DrawerFooterSpec
} from '../ui'
import { formatDay, formatMoment } from '../utils/dates'
import { createPageChangesSource, type PageChangesSource } from './client'
import { DiffView } from './DiffView'
import { usePageChangeActions, usePageChanges } from './hooks'
import { changeDay, changeForVersions, changePath } from './model'
import './pageChanges.css'

/**
 * "See what changed" (window-wide drawer `page-change`): two reads of a page,
 * inline or side by side, with the change's decision in the footer: Log as fix
 * (live the day it changed), Not a fix (Undo), or the fix it is logged as.
 * `pc.id` opens a noticed change; `pc.page` + `pc.from` + `pc.to` any two versions.
 */
export function PageChangeDrawer({
  projectId,
  entry,
  depth,
  source
}: {
  projectId: string
  entry: DrawerEntry
  depth: number
  source?: PageChangesSource
}): JSX.Element {
  const client = useMemo(() => source ?? createPageChangesSource(), [source])
  const params = entry.params
  const view = params['pc.view'] === 'side' ? 'side' : 'inline'
  const all = params['pc.all'] === '1'
  const { list, error: listError } = usePageChanges(projectId, client)
  const actions = usePageChangeActions(projectId, client)
  const changeId = params['pc.id'] ?? null
  const byId = changeId === null ? null : (list?.changes.find((c) => c.id === changeId) ?? null)
  const target =
    changeId !== null
      ? byId && { pageId: byId.pageId, from: byId.fromSnapshotId, to: byId.toSnapshotId }
      : params['pc.page'] && params['pc.from'] && params['pc.to']
        ? { pageId: params['pc.page'], from: params['pc.from'], to: params['pc.to'] }
        : null
  const change: PageChange | null =
    byId ?? changeForVersions(list, target?.pageId ?? null, target?.to ?? null)
  const [diff, setDiff] = useState<PageDiffResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const key = target ? `${target.pageId}|${target.from}|${target.to}` : null

  useEffect(() => {
    if (target === null) return undefined
    let live = true
    void Promise.resolve()
      .then(() =>
        client['pageChanges:diff']({
          projectId,
          pageId: target.pageId,
          fromSnapshotId: target.from,
          toSnapshotId: target.to
        })
      )
      .then(
        (next) => {
          if (live) {
            setDiff(next)
            setError(null)
          }
        },
        (cause: unknown) => {
          if (live) setError(errorText(cause, 'Could not compare the two reads.'))
        }
      )
    return () => {
      live = false
    }
    // `key` stands for the target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, projectId, key])

  useAiContext({
    screen: 'drawer.page-change',
    screenLabel: 'What changed on the page',
    ...(target ? { pageId: target.pageId } : {}),
    facts: diff ? [diff.sentence] : [],
    numbers: diff
      ? [
          { label: 'New sections', value: String(diff.counts.sectionsAdded) },
          { label: 'Headings changed', value: String(diff.counts.headingsChanged) }
        ]
      : []
  })

  const close = (): void => closeDrawer(depth)
  const missing =
    (changeId !== null && list !== null && byId === null) || (changeId === null && target === null)
  if (missing || listError) {
    return (
      <Drawer
        id="page-change"
        title="What changed"
        depth={depth}
        onClose={close}
        error={{
          message:
            listError ?? 'That change is not in this project any more, or is not available to you.'
        }}
      />
    )
  }
  const shown =
    diff && key === `${diff.pageId}|${diff.from.snapshotId}|${diff.to.snapshotId}` ? diff : null

  const run = (work: () => Promise<void>): void => {
    setBusy(true)
    work().then(
      () => setBusy(false),
      (cause: unknown) => {
        setBusy(false)
        setError(errorText(cause, 'Could not save that. Try again.'))
      }
    )
  }

  return (
    <Drawer
      id="page-change"
      title="What changed"
      depth={depth}
      testId="page-change-drawer"
      subtitle={
        shown ? (
          <span className="pc-sub">
            <UrlText url={shown.url} label={changePath(shown)} icon={false} />
            <span>
              Read {formatMoment(shown.from.readAt)} → {formatMoment(shown.to.readAt)}
            </span>
          </span>
        ) : (
          'Two reads of this page, compared.'
        )
      }
      headerExtra={
        <div className="pc-controls">
          <SegmentedControl
            label="Layout"
            size="sm"
            value={view}
            options={[
              { value: 'inline', label: 'Inline' },
              { value: 'side', label: 'Side by side' }
            ]}
            onChange={(next) =>
              setDrawerParams(depth, { 'pc.view': next === 'side' ? 'side' : null })
            }
          />
          <SegmentedControl
            label="How much of the page"
            size="sm"
            value={all ? 'all' : 'changes'}
            options={[
              { value: 'changes', label: 'Changes only' },
              { value: 'all', label: 'Whole page' }
            ]}
            onChange={(next) => setDrawerParams(depth, { 'pc.all': next === 'all' ? '1' : null })}
          />
        </div>
      }
      loading={shown === null && error === null}
      error={shown === null && error ? { message: error } : undefined}
      busy={busy}
      onClose={close}
      footer={footerFor(change, shown, busy, {
        logAsFix: () => {
          if (change) actions.logAsFix(change, shown?.fixText)
          else if (shown) {
            openDrawer(
              'fix',
              newFixValues({
                pageId: shown.pageId,
                text: shown.fixText,
                liveOn: todayInput(new Date(shown.to.readAt))
              })
            )
          }
        },
        notAFix: () => {
          if (change) run(() => actions.notAFix(change))
        },
        undo: () => {
          if (change) run(() => actions.restore(change))
        }
      })}
    >
      {shown ? (
        <DrawerGrid>
          <DrawerSection title="Summary" span={12}>
            <p className="pc-sentence">{shown.sentence}</p>
            <DrawerFacts
              label="The two reads"
              items={[
                {
                  label: 'Page says updated',
                  value: `${formatDay(shown.from.modifiedAt)} → ${formatDay(shown.to.modifiedAt)}`
                },
                {
                  label: 'Words',
                  value: (
                    <span className="num">
                      {shown.from.wordCount.toLocaleString('en-US')} →{' '}
                      {shown.to.wordCount.toLocaleString('en-US')}
                    </span>
                  )
                },
                ...(change ? [{ label: 'Went live', value: formatMoment(change.changedAt) }] : [])
              ]}
            />
            {error ? (
              <p className="pc-banner-error" role="alert">
                {error}
              </p>
            ) : null}
          </DrawerSection>
          <DrawerSection
            title="The page"
            description="Struck red: removed. Highlighted: new."
            span={12}
          >
            <DiffView
              items={shown.items}
              view={view}
              all={all}
              fromLabel={`Before · ${formatMoment(shown.from.readAt)}`}
              toLabel={`After · ${formatMoment(shown.to.readAt)}`}
              onShowAll={() => setDrawerParams(depth, { 'pc.all': '1' })}
            />
          </DrawerSection>
        </DrawerGrid>
      ) : null}
    </Drawer>
  )
}

function footerFor(
  change: PageChange | null,
  diff: PageDiffResult | null,
  busy: boolean,
  on: { logAsFix: () => void; notAFix: () => void; undo: () => void }
): DrawerFooterSpec {
  if (change?.state === 'linked' && change.fixId) {
    const fixId = change.fixId
    return {
      summary: `Logged as fix ${change.fixNumber ?? ''}`.trim(),
      cancel: 'Close',
      secondary: {
        label: `Open fix ${change.fixNumber ?? ''}`.trim(),
        onClick: () => openDrawer('fix', viewFixValues(fixId))
      }
    }
  }
  if (change?.state === 'dismissed') {
    return {
      summary: 'Marked as not a fix.',
      cancel: 'Close',
      secondary: { label: 'Undo', onClick: on.undo, busy }
    }
  }
  if (change) {
    return {
      summary: 'Is this a fix?',
      cancel: 'Close',
      secondary: { label: 'Not a fix', onClick: on.notAFix, busy, testId: 'page-change-not-fix' },
      primary: { label: `Log as fix, live ${changeDay(change)}`, onClick: on.logAsFix }
    }
  }
  if (diff === null) return { cancel: 'Close' }
  return {
    cancel: 'Close',
    secondary: {
      label: `Log as fix, live ${formatMoment(diff.to.readAt)}`,
      onClick: on.logAsFix
    }
  }
}
