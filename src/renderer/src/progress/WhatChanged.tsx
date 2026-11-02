import { useState, type JSX } from 'react'
import { PromptQuestion } from '../components/PromptQuestion'
import { DrillLink } from '../drill'
import { Button, ListGrid, SectionHead, UrlText, type ListColumn } from '../ui'
import { unchangedPromptsToggle, type ChangeGroup, type ChangeItem } from '../visibility/progress'
import { RunDrillButton, RunFigure } from '../visibility/progressRuns'
import { useProgressRuns } from '../visibility/progressRunsContext'
import type { WhatChangedModel } from './changes'
import './progress.css'

/** One changed prompt, in the group (Gained a citation, Moved…) it is listed under. */
type ChangeRow = ChangeItem & { group: string; key: string }

/** FR-14.1, FR-14.2. "What changed since the last check", from the two latest full checks. */
export function WhatChanged({
  model,
  runId
}: {
  model: WhatChangedModel
  /** The later of the two checks compared. Counts and prompt links read it. */
  runId: string | null
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const runs = useProgressRuns()
  const marketId = runs?.marketId ?? null
  const promptLink = (id: string, children: JSX.Element): JSX.Element =>
    runs ? (
      <DrillLink
        className="vis-link"
        target={{ kind: 'prompt', pageId: runs.pageId, promptId: id, marketId, runId }}
      >
        {children}
      </DrillLink>
    ) : (
      children
    )
  const rows: ChangeRow[] = model.groups.flatMap((group) =>
    group.items.map((item) => ({ ...item, group: group.title, key: `${group.title}:${item.id}` }))
  )
  const anyExtra = rows.some((row) => row.extra)
  const columns: ListColumn<ChangeRow>[] = [
    {
      id: 'n',
      label: '#',
      width: 56,
      numeric: true,
      sort: (row) => row.n,
      render: (row) => <span className="faint">{row.n}</span>
    },
    {
      id: 'prompt',
      label: 'Question',
      width: 'fill',
      minWidth: 200,
      render: (row) =>
        promptLink(
          row.id,
          <span className="vis-chg-prompt" title={row.full}>
            <PromptQuestion text={row.full} label={row.label} baseLevel={4} />
          </span>
        )
    },
    {
      id: 'detail',
      label: 'What changed',
      width: 300,
      render: (row) => (
        <span className="vis-chg-detail" title={row.detail}>
          {row.detail}
        </span>
      )
    },
    ...(anyExtra
      ? [
          {
            id: 'extra',
            label: 'Page or note',
            width: 260,
            render: (row: ChangeRow) =>
              row.extra && row.extraMono && /^https?:\/\//.test(row.extra) ? (
                <UrlText url={row.extra} className="vis-chg-note" />
              ) : row.extra ? (
                <span
                  className={row.extraMono ? 'mono vis-chg-note' : 'faint vis-chg-note'}
                  title={row.extra}
                >
                  {row.extra}
                </span>
              ) : (
                <span className="faint">—</span>
              )
          }
        ]
      : [])
  ]
  return (
    <section className="vis-panel stack-tight" aria-labelledby="chg-h">
      <SectionHead id="chg-h" title={model.heading} description={model.intro} />
      <ul className="vis-chg-sum" aria-label="Changes by kind">
        {model.groups.map((group) => (
          <li key={group.title} className={`vis-chg-chip vis-chg-chip-${group.tone}`}>
            <ChangeIcon tone={group.tone} />
            <span>{group.title}</span>
            {group.count > 0 ? (
              <RunDrillButton
                className="vis-chg-count"
                label={group.aria}
                copy={{
                  id: `change:${group.title}`,
                  title: group.title,
                  description: group.aria
                }}
                ids={group.items.map((item) => item.id)}
                marketId={marketId}
                runId={runId}
              >
                <RunFigure id={`change:${group.title}`} ids={group.items.map((item) => item.id)} />
              </RunDrillButton>
            ) : (
              <span className="vis-chg-count">{group.count}</span>
            )}
          </li>
        ))}
      </ul>
      {rows.length > 0 ? (
        <ListGrid<ChangeRow>
          label="Questions that changed"
          noun={['question', 'questions']}
          rows={rows}
          rowKey={(row) => row.key}
          rowLabel={(row) => `Question ${row.n}`}
          columns={columns}
          group={{
            key: (row) => ({ key: row.group, label: row.group }),
            order: model.groups.map((group) => group.title)
          }}
          empty={null}
        />
      ) : null}
      <div className="vis-same">
        <p className="muted">{model.unchangedNote}</p>
        {model.unchanged.length > 0 ? (
          <Button size="sm" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            {unchangedPromptsToggle(model.unchanged.length, open)}
          </Button>
        ) : null}
      </div>
      {open ? (
        <ul className="vis-chg-list">
          {model.unchanged.map((item) => (
            <li key={item.id}>
              <span className="num faint">{item.n}</span>{' '}
              {promptLink(item.id, <PromptQuestion text={item.full} label={item.label} />)}{' '}
              <span className="faint">{item.note}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function ChangeIcon({ tone }: { tone: ChangeGroup['tone'] }): JSX.Element {
  const path =
    tone === 'up'
      ? 'M12 19V5M5 12l7-7 7 7'
      : tone === 'down'
        ? 'M12 5v14M19 12l-7 7-7-7'
        : tone === 'named'
          ? 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'
          : 'M5 12h14'
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`vis-ico vis-ico-${tone}`}
    >
      <path d={path} />
    </svg>
  )
}
