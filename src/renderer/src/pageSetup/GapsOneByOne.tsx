import { useEffect, useState, type JSX } from 'react'
import type { CoverageFinding } from '@shared/domain'
import type { GapStatus } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import type { AssistClient } from '../assist/client'
import { DrillLink, type DrillScope } from '../drill'
import { planFixHash } from '../progress/model'
import { readHash } from '../shell/routes'
import {
  IconButton,
  Button,
  Chip,
  COPIED_MS,
  EmptyState,
  ListGrid,
  SectionHead,
  UiIcon,
  useAssistMenu
} from '../ui'
import { GAP_STATUS_LABEL, GAP_STATUS_TONE, statusVerb } from './gaps/status'
import { gapTarget } from './gapsDrills'
import { findingSourceLabel, gapItemId } from './gapsFilter'
import { actionsLabel, coverageLabel } from './labels'
import type { GapListRow } from './model'
import { copyText } from './text'

/**
 * One by one: each prompt's current content, what to update and the draft
 * FAQ, with a link to the prompt's AI Overview. The open item has its one AI
 * menu, with Draft the fix.
 */
export function GapsOneByOne({
  rows,
  openId,
  onToggle,
  scope,
  projectId,
  pageId,
  marketId,
  assistClient,
  onSetStatus,
  onEditDraft,
  onPlanFix,
  onCopyJsonLd
}: {
  rows: readonly GapListRow[]
  openId: string | null
  onToggle: (rowId: string) => void
  scope: DrillScope
  projectId: string
  pageId: string
  marketId: string
  assistClient?: AssistClient | undefined
  onSetStatus: (row: GapListRow, status: GapStatus) => void
  /** Opens the FAQ draft drawer. Absent: drafts cannot be edited here. */
  onEditDraft?: ((row: GapListRow) => void) | undefined
  onPlanFix: (row: GapListRow) => void
  onCopyJsonLd: (row: GapListRow) => Promise<boolean>
}): JSX.Element {
  const [copiedId, setCopiedId] = useState<string | null>(null)
  useEffect(() => {
    if (copiedId === null) return
    const timer = window.setTimeout(() => setCopiedId(null), COPIED_MS)
    return () => window.clearTimeout(timer)
  }, [copiedId])
  return (
    <section className="gp-one" aria-labelledby="one-h">
      <SectionHead
        id="one-h"
        title="Each question against the page"
        description="What’s on the page now, what to update, and a draft FAQ where one helps. Drafts never name prices you haven’t confirmed."
      />
      {rows.length === 0 ? (
        <div className="ui-panel">
          <EmptyState icon="search" title="No questions match this search and these filters" />
        </div>
      ) : (
        <div className="ui-panel gp-acc-list">
          {rows.map((row) => {
            const target = gapTarget(scope, row.promptId)
            const open = openId === row.id
            return (
              <article key={row.id} className="ps-acc gp-acc" id={gapItemId(row.id)}>
                <h3 className="gp-acc-h">
                  <button
                    type="button"
                    className="ps-acc-btn gp-acc-btn"
                    aria-expanded={open}
                    onClick={() => onToggle(row.id)}
                  >
                    <span className="gp-q num">{row.position}</span>
                    <span className="gp-acc-label">{row.label}</span>
                    <span className={`gp-level gp-level-${row.coverage} gp-level-sm`}>
                      {coverageLabel(row.coverage)}
                    </span>
                    <span className="gp-tag">{actionsLabel(row.actions)}</span>
                    {row.status !== 'open' ? (
                      <Chip tone={GAP_STATUS_TONE[row.status]} size="sm">
                        {GAP_STATUS_LABEL[row.status]}
                      </Chip>
                    ) : null}
                    <span className={open ? 'gp-caret open' : 'gp-caret'} aria-hidden="true">
                      <UiIcon name="chevron-down" size={16} />
                    </span>
                  </button>
                </h3>
                {open ? (
                  <div className="gp-acc-body">
                    <p className="gp-quote-line">&quot;{row.text}&quot;</p>
                    {target ? (
                      <p>
                        <DrillLink target={target} className="gx-link">
                          See this question&apos;s AI Overview
                        </DrillLink>
                      </p>
                    ) : null}
                    <div className="gp-acc-cols">
                      <div>
                        <p className="gp-key">What&apos;s there now</p>
                        <p>{row.currentContent}</p>
                      </div>
                      <div>
                        <p className="gp-key">What to update</p>
                        {row.whatToUpdate.trim().length === 0 ? (
                          <p className="gp-muted">Nothing to change. The page answers this.</p>
                        ) : (
                          <ul className="gp-list">
                            {row.whatToUpdate
                              .split('\n')
                              .filter((line) => line.trim())
                              .map((line) => (
                                <li key={line}>{line}</li>
                              ))}
                          </ul>
                        )}
                      </div>
                    </div>
                    <div>
                      <p className="gp-key">
                        New FAQ: {faqLabel(row)}
                        {row.faqEdited ? <span className="gp-edited"> · your draft</span> : null}
                      </p>
                      {row.suggestedFaq ? (
                        <blockquote className="gp-faq">
                          <div className="gp-faq-head">
                            <p className="gp-faq-q">{row.suggestedFaq.question}</p>
                            <span className="gp-muted num">{row.suggestedFaq.wordCount} words</span>
                          </div>
                          <p className="gp-muted">{row.suggestedFaq.answer}</p>
                          <div className="gp-row">
                            {onEditDraft ? (
                              <IconButton
                                size="sm"
                                tip
                                icon="pencil"
                                label="Edit draft"
                                onClick={() => onEditDraft(row)}
                              />
                            ) : null}
                            <IconButton
                              size="sm"
                              tip
                              icon={copiedId === row.id ? 'check' : 'copy'}
                              label={copiedId === row.id ? 'Copied' : 'Copy draft'}
                              onClick={() => {
                                const faq = row.suggestedFaq
                                if (!faq) return
                                void copyText(`${faq.question}\n${faq.answer}`)
                                setCopiedId(row.id)
                              }}
                            />
                            <IconButton
                              size="sm"
                              tip
                              icon={copiedId === `${row.id}:ld` ? 'check' : 'clipboard'}
                              label={copiedId === `${row.id}:ld` ? 'Copied' : 'Copy as JSON-LD'}
                              onClick={() => {
                                void onCopyJsonLd(row).then((done) => {
                                  if (done) setCopiedId(`${row.id}:ld`)
                                })
                              }}
                            />
                          </div>
                        </blockquote>
                      ) : (
                        <div className="gp-row">
                          <span className="gp-muted">No draft FAQ for this question.</span>
                          {onEditDraft ? (
                            <Button size="sm" onClick={() => onEditDraft(row)}>
                              Write a draft
                            </Button>
                          ) : null}
                        </div>
                      )}
                      <StatusRow
                        row={row}
                        onSetStatus={(status) => onSetStatus(row, status)}
                        onPlanFix={() => onPlanFix(row)}
                      />
                    </div>
                    <DraftFix
                      projectId={projectId}
                      pageId={pageId}
                      marketId={marketId}
                      row={row}
                      {...(assistClient ? { client: assistClient } : {})}
                    />
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

/** Page-wide fixes as a list grid: each links to where it is on the page and can be planned as a fix. */
export function PageWideFixes({
  pageId,
  findings
}: {
  pageId: string
  findings: readonly CoverageFinding[]
}): JSX.Element {
  return (
    <div className="gp-fixes">
      <SectionHead
        title="Fixes not tied to one question"
        description={`${pluralize(findings.length, 'fix', 'fixes')} across the whole page.`}
      />
      <ListGrid<CoverageFinding>
        label="Page-wide fixes"
        noun={['fix', 'fixes']}
        rows={findings}
        rowKey={(finding) => finding.id}
        rowLabel={(finding) => finding.summary}
        columns={[
          {
            id: 'fix',
            label: 'Fix',
            width: 'fill',
            minWidth: 260,
            render: (finding) => (
              <span className="gp-prompt">
                <span className="gp-fix-summary">{finding.summary}</span>
                <span className="gp-text">{finding.detail}</span>
              </span>
            )
          },
          {
            id: 'where',
            label: 'Where',
            width: 260,
            render: (finding) => (
              <a className="gx-link" href={readHash(pageId)}>
                {findingSourceLabel(finding.kind)}
              </a>
            )
          },
          {
            id: 'plan',
            label: 'Plan',
            width: 140,
            render: (finding) => (
              <a
                className="gx-link"
                href={planFixHash(pageId, { description: finding.summary, promptIds: [] })}
                aria-label={`Plan as a fix: ${finding.summary}`}
              >
                Plan as a fix
              </a>
            )
          }
        ]}
        pageSize="all"
        empty={<EmptyState icon="check" title="No page-wide fixes" />}
      />
    </div>
  )
}

/** The open item's one AI menu: Draft the fix, answered as one suggestion card. */
function DraftFix({
  projectId,
  pageId,
  marketId,
  row,
  client
}: {
  projectId: string
  pageId: string
  marketId: string
  row: GapListRow
  client?: AssistClient
}): JSX.Element {
  const { menu, card } = useAssistMenu({
    label: `AI actions for question ${row.position}`,
    scope: {
      projectId,
      pageId,
      marketId: marketId || null,
      promptId: row.promptId,
      ...(client ? { client } : {})
    },
    actions: [
      {
        assistId: 'gaps.draftFix',
        label: 'Draft the fix',
        seconds: 15,
        // Copy only: the draft goes to the clipboard, nothing is written to the page.
        applyLabel: 'Copy',
        onApply: (result, ids) => {
          const chosen = result.items.filter((item) => ids.length === 0 || ids.includes(item.id))
          void copyText(chosen.map((item) => item.text).join('\n\n'))
        }
      }
    ]
  })
  return (
    <div className="gp-acc-ai">
      <div className="gp-row">
        <span className="gp-muted">CiteFox AI can draft the change for this question.</span>
        {menu}
      </div>
      {card}
    </div>
  )
}

/** Where the gap stands, the next steps, and Plan as a fix. */
function StatusRow({
  row,
  onSetStatus,
  onPlanFix
}: {
  row: GapListRow
  onSetStatus: (status: GapStatus) => void
  onPlanFix: () => void
}): JSX.Element {
  const next: GapStatus[] = (['open', 'published', 'verified'] as const).filter(
    (status) => status !== row.status
  )
  return (
    <div className="gp-row gp-status-row">
      <span className="gp-muted">
        Status:{' '}
        <Chip tone={GAP_STATUS_TONE[row.status]} size="sm">
          {GAP_STATUS_LABEL[row.status]}
        </Chip>
      </span>
      {next.map((status) => (
        <Button
          key={status}
          size="sm"
          variant="secondary"
          aria-label={`${statusVerb(status)}: question ${row.position}`}
          onClick={() => onSetStatus(status)}
        >
          {statusVerb(status)}
        </Button>
      ))}
      <Button size="sm" variant="text" icon="target" onClick={onPlanFix}>
        Plan as a fix
      </Button>
    </div>
  )
}

function faqLabel(row: GapListRow): string {
  if (!row.suggestedFaq) return 'No'
  if (row.actions.includes('optional_faq')) return 'Optional'
  if (row.priority === 'high') return 'Yes · high priority'
  return 'Yes'
}
