import { useState, type JSX } from 'react'
import { Markdown } from '../components/Markdown'
import type { DrillSpec } from '../m3/model'
import { countNoun } from '../m3/model'
import {
  Button,
  LinkButton,
  ListGrid,
  SectionHead,
  SegmentedControl,
  Sparkline,
  type ListColumn
} from '../ui'
import { CountDrawer } from './CountDrawer'
import {
  unchangedPromptsToggle,
  visibleFixRows,
  type ChangeGroup,
  type FixFilter,
  type FixResultRow,
  type MarketTrend,
  type ProgressDetail
} from './progress'

const FILTERS: readonly FixFilter[] = ['all', 'Worked', 'No change', 'Got worse', 'Planned']

/** Harness and tests only. Production screens do not import this module. */
export function WhatChangedSection({
  detail,
  onDrill
}: {
  detail: ProgressDetail
  onDrill: (drill: DrillSpec) => void
}): JSX.Element {
  return <WhatChanged detail={detail} onDrill={onDrill} />
}

export function ProgressAfterChart({
  detail,
  onDrill
}: {
  detail: ProgressDetail
  onDrill: (drill: DrillSpec) => void
}): JSX.Element {
  return <Fixes detail={detail} onDrill={onDrill} />
}

export function SampleMarkets({ detail }: { detail: ProgressDetail }): JSX.Element {
  return <AllMarkets markets={detail.markets} />
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

function WhatChanged({
  detail,
  onDrill
}: {
  detail: ProgressDetail
  onDrill: (drill: DrillSpec) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <section className="card stack-tight" aria-labelledby="chg-h">
      <SectionHead id="chg-h" title={detail.changedHeading} />
      <Markdown className="faint" baseLevel={3}>
        {detail.changedIntro}
      </Markdown>
      <div className="vis-chg">
        {detail.groups.map((group) => (
          <div key={group.title} className="vis-chg-col" role="group" aria-label={group.aria}>
            <h3>
              <ChangeIcon tone={group.tone} />
              <span>{group.title}</span>
              {group.count > 0 ? (
                <button
                  type="button"
                  className="vis-chg-count"
                  aria-label={group.aria}
                  onClick={() =>
                    onDrill({
                      id: `change:${group.title}`,
                      title: group.title,
                      description: group.aria,
                      omitCount: false,
                      promptIds: group.items.map((item) => item.id)
                    })
                  }
                >
                  {group.count}
                </button>
              ) : (
                <span className="vis-chg-count">{group.count}</span>
              )}
            </h3>
            {group.items.length === 0 ? <p className="faint">None</p> : null}
            <ul className="vis-chg-list">
              {group.items.map((item) => (
                <li key={item.id}>
                  <span className="mono faint">{item.n}</span>{' '}
                  <Markdown inline baseLevel={4}>
                    {item.label}
                  </Markdown>
                  <Markdown baseLevel={4}>{item.detail}</Markdown>
                  <Markdown className={item.extraMono ? 'mono' : 'faint'} baseLevel={4}>
                    {item.extra}
                  </Markdown>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="vis-same">
        <Markdown className="muted" baseLevel={3}>
          {detail.unchangedNote}
        </Markdown>
        <Button size="sm" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {unchangedPromptsToggle(detail.unchanged.length, open)}
        </Button>
      </div>
      {open ? (
        <ul className="vis-chg-list">
          {detail.unchanged.map((item) => (
            <li key={item.id}>
              <span className="mono faint">{item.n}</span>{' '}
              <Markdown inline baseLevel={3}>
                {item.label}
              </Markdown>{' '}
              <span className="faint">
                <Markdown inline baseLevel={3}>
                  {item.note}
                </Markdown>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function Fixes({
  detail,
  onDrill
}: {
  detail: ProgressDetail
  onDrill: (drill: DrillSpec) => void
}): JSX.Element {
  const [filter, setFilter] = useState<FixFilter>('all')
  const [saved, setSaved] = useState(false)
  const [picked, setPicked] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        detail.fixTargets.filter((item) => item.n === 4 || item.n === 5).map((item) => item.id)
      )
  )
  const planned = [...picked].length
  const total = detail.fix1Rows.length + planned
  const rows = visibleFixRows(detail.fix1Rows, filter)
  const showFix1 = rows.length > 0 && filter !== 'Planned'
  const showFix2 = filter === 'all' || (filter === 'Planned' && planned > 0)
  const countFor = (name: FixFilter): number => {
    if (name === 'all') return detail.fix1Rows.length + planned
    if (name === 'Planned') return planned
    return detail.fix1Rows.filter((row) => row.result === name).length
  }
  return (
    <section className="stack-tight" aria-labelledby="fix-h">
      <SectionHead
        id="fix-h"
        title="Fixes and what happened"
        description={
          <Markdown inline baseLevel={3}>
            {detail.fixIntro}
          </Markdown>
        }
        actions={
          <LinkButton variant="text" href="#fix2">
            Log a fix
          </LinkButton>
        }
      />
      <SegmentedControl<FixFilter>
        label="Show fixes by result"
        size="sm"
        options={FILTERS.map((name) => ({
          value: name,
          label: name === 'all' ? 'All' : name,
          count: countFor(name)
        }))}
        value={filter}
        onChange={setFilter}
      />
      <p className="muted" role="status">
        {filter === 'all'
          ? `Showing all ${countNoun(total, 'targeted question', 'targeted questions')}: ${detail.fix1Rows.length} checked after Fix 1, ${planned} planned for Fix 2.`
          : `Showing ${countFor(filter)} of ${countNoun(total, 'targeted question', 'targeted questions')} · ${filter}`}
      </p>
      {!showFix1 && !showFix2 ? (
        <p className="empty">No questions match {filter}. Fix 2 has no questions picked yet.</p>
      ) : null}
      {showFix1 ? (
        <article className="card stack-tight" aria-label="Fix 1 · Added 5 FAQs">
          <h3>Added 5 FAQs</h3>
          <p className="faint">
            Live Oct 8 · targets questions 4, 6 and 9 · checked Oct 19, 11 days later · 🇺🇸 US · EN
          </p>
          <p>Partly worked · 1 of 3 questions</p>
          <ListGrid<FixResultRow>
            label="Questions Fix 1 targeted, before Oct 5 and after Oct 19"
            noun={['question', 'questions']}
            rows={rows}
            rowKey={(row) => row.id}
            rowLabel={(row) => `Question ${row.n}`}
            columns={fixColumns(onDrill)}
            empty={null}
          />
          <p className="muted">
            3 of the 7 questions you didn&apos;t target also moved in the same period. Google&apos;s
            overviews shift on their own, so treat one check as a signal, not proof.
          </p>
        </article>
      ) : null}
      {showFix2 ? (
        <article id="fix2" className="card stack-tight" aria-label="Fix 2 · Plan a fix">
          <h3>Plan a fix</h3>
          {saved ? <p>Saved · follow-up check Oct 24</p> : null}
          <label className="field-label" htmlFor="fix-what">
            What will you change?
          </label>
          <textarea id="fix-what" className="input" rows={4} />
          <fieldset>
            <legend>Questions this fix should help</legend>
            {detail.fixTargets.map((target) => (
              <label key={target.id} className="check">
                <input
                  type="checkbox"
                  checked={picked.has(target.id)}
                  onChange={() => {
                    setSaved(false)
                    setPicked((current) => {
                      const next = new Set(current)
                      if (next.has(target.id)) next.delete(target.id)
                      else next.add(target.id)
                      return next
                    })
                  }}
                />{' '}
                <span className="mono faint">{target.n}</span> {target.label}
              </label>
            ))}
          </fieldset>
          <label className="field-label" htmlFor="fix-live">
            Goes live on
          </label>
          <input id="fix-live" className="input" type="date" defaultValue="2026-10-21" />
          <label className="field-label" htmlFor="fix-when">
            Re-check these questions
          </label>
          <select id="fix-when" className="input" defaultValue="3">
            <option value="3">3 days after it goes live (Oct 24)</option>
            <option value="7">7 days after it goes live (Oct 28)</option>
            <option value="next">At the next scheduled check (Nov 2)</option>
          </select>
          <p className="muted">All 4 markets</p>
          <p className="faint">
            The follow-up uses {planned * 4}–{planned * 8} searches ({planned} questions × 4
            markets). Google has to recrawl the page before an overview can change; requesting
            indexing in Google Search Console usually speeds that up.
          </p>
          <div className="fx-actions">
            <Button variant="primary" onClick={() => setSaved(true)}>
              Save fix
            </Button>
            <Button onClick={() => setSaved(false)}>Cancel</Button>
          </div>
        </article>
      ) : null}
    </section>
  )
}

function fixColumns(onDrill: (drill: DrillSpec) => void): readonly ListColumn<FixResultRow>[] {
  return [
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
      label: 'Targeted question',
      width: 'fill',
      minWidth: 200,
      render: (row) => (
        <span className="vis-clip" title={row.full.split('**').join('')}>
          <Markdown inline baseLevel={4}>
            {row.full}
          </Markdown>
        </span>
      )
    },
    { id: 'before', label: 'Before · Oct 5', width: 140, render: (row) => row.before },
    { id: 'after', label: 'After · Oct 19', width: 140, render: (row) => row.after },
    {
      id: 'result',
      label: 'Result',
      width: 120,
      render: (row) => (
        <button
          type="button"
          className="vis-link-btn"
          aria-label={`${row.result}: question ${row.n}`}
          onClick={() =>
            onDrill({
              id: `fix:${row.id}`,
              title: row.result,
              description: row.full,
              omitCount: false,
              promptIds: [row.id]
            })
          }
        >
          {row.result}
        </button>
      )
    }
  ]
}

function AllMarkets({ markets }: { markets: readonly MarketTrend[] }): JSX.Element {
  const [open, setOpen] = useState<MarketTrend | null>(null)
  const columns: readonly ListColumn<MarketTrend>[] = [
    {
      id: 'market',
      label: 'Market',
      width: 'fill',
      minWidth: 160,
      sort: (market) => market.name,
      render: (market) => market.name
    },
    { id: 'sep21', label: 'Sep 21', width: 96, numeric: true, render: (market) => market.sep21 },
    { id: 'oct5', label: 'Oct 5', width: 96, numeric: true, render: (market) => market.oct5 },
    { id: 'oct19', label: 'Oct 19', width: 96, numeric: true, render: (market) => market.oct19 },
    {
      id: 'trend',
      label: 'Trend',
      width: 120,
      render: (market) => <Sparkline values={market.scores} label={market.aria} />
    },
    {
      id: 'change',
      label: 'Change',
      width: 96,
      numeric: true,
      render: (market) => (
        <button
          type="button"
          className="vis-link-btn"
          aria-label={`${market.name}, ${countNoun(market.checks.length, 'check', 'checks')}, change ${market.delta}`}
          onClick={() => setOpen(market)}
        >
          {market.delta}
        </button>
      )
    }
  ]
  return (
    <section className="stack-tight" aria-labelledby="mkt-h">
      <SectionHead
        id="mkt-h"
        title="All markets"
        description="Visibility score by market on Sep 21, Oct 5 and Oct 19. The trend drawing repeats these cells."
      />
      <ListGrid<MarketTrend>
        label="Visibility score by market"
        noun={['market', 'markets']}
        rows={markets}
        rowKey={(market) => market.name}
        rowLabel={(market) => market.name}
        columns={columns}
        rowMenu={(market) => [
          {
            id: 'checks',
            label: `Show the ${countNoun(market.checks.length, 'check', 'checks')}`,
            icon: 'layers',
            onSelect: () => setOpen(market)
          }
        ]}
        empty={null}
      />
      {open ? (
        <CountDrawer
          title={open.name}
          description={open.aria}
          items={open.checks.map((check) => ({
            id: `${open.name}-${check.label}`,
            primary: check.label,
            secondary: check.value
          }))}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </section>
  )
}
