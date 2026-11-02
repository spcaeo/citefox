import { useId, useState, type JSX, type KeyboardEvent } from 'react'
import { errorText } from '../../../components/errorText'
import { openDrawer } from '../../../shell/drawers'
import { exportHash, pageHash, projectSettingsHash } from '../../../shell/routes'
import { HeaderActions, type HeaderMoreItem } from '../../../components/HeaderActions'
import { questionsAndKeywords } from '@shared/pluralize'
import { targetPagePath } from '@shared/target-page'
import { Button, Chip, ToolButton, UiIcon, UrlText } from '../../../ui'
import { addQuestionsToTopicHash } from '../../settings/model'
import { formatDateTime } from '../model/format'
import type { TopicResults } from '../types'

/**
 * Topic header (Topic-Overview.png): name, one short line (what it tracks, when it was
 * checked, its target page), the market picker with two or more markets, the ⋯ menu
 * (Docs/HEADER.md: editing the topic, then Export) and the screen's one primary action,
 * Check now. Where the topic came from, its schedule, markets and history sit behind
 * the ⋯, as the page row's own tabs, since a topic is a `pages` row. Clicking the name
 * renames it in place; a topic with no questions offers Add questions, not Check now.
 * The top bar's breadcrumb is the only trail (Vibe: one per page); drawers keep their own.
 */
export function TopicHeader({
  results,
  onMarketChange,
  onChangeBands,
  onChangeTargetPage,
  onCheckNow,
  onRename
}: {
  results: TopicResults
  onMarketChange: (marketId: string) => void
  onChangeBands: () => void
  onChangeTargetPage: () => void
  /** Starts the check here, on this screen; the live line shows its progress. */
  onCheckNow: () => void
  /** Resolves when saved; rejects with the reason to keep the field open. */
  onRename: (name: string) => Promise<void>
}): JSX.Element {
  const { topic } = results
  const marketId = useId()
  const empty = topic.questions + topic.keywords === 0
  const checking = results.live?.state === 'running'
  const checked = topic.checkedAt ? `checked ${formatDateTime(topic.checkedAt)}` : 'not checked yet'
  const more: HeaderMoreItem[] = [
    {
      id: 'settings',
      label: 'Topic settings…',
      icon: 'sliders',
      onSelect: () => openDrawer('topic-settings', { 'ts.topic': topic.id })
    },
    {
      id: 'questions',
      label: 'Questions and keywords',
      icon: 'pencil',
      href: pageHash(topic.id, 'prompts')
    },
    {
      id: 'bands',
      label: 'Target bands',
      icon: 'target',
      onSelect: onChangeBands
    },
    {
      id: 'markets',
      label: 'Markets',
      icon: 'compass',
      href: pageHash(topic.id, 'markets')
    },
    {
      id: 'history',
      label: 'History and compare',
      icon: 'layers',
      href: pageHash(topic.id, 'history', { marketId: topic.marketId })
    },
    {
      id: 'schedule',
      label: 'Schedule',
      icon: 'refresh',
      href: projectSettingsHash('schedule')
    },
    { id: 'export', label: 'Export report', icon: 'download', href: exportHash(topic.id) }
  ]

  return (
    <header className="tr-head">
      <div className="tr-head-text">
        <TopicTitle name={topic.name} paused={topic.status === 'paused'} onRename={onRename} />
        <p className="tr-source tr-target-page num">
          <span>
            {questionsAndKeywords(topic.questions, topic.keywords)} · {checked}
          </span>
          <TargetPage targetPage={topic.targetPage} onChange={onChangeTargetPage} />
        </p>
      </div>
      <div className="tr-head-actions">
        {topic.markets.length > 1 ? (
          <div className="tr-market">
            <label className="sr-only" htmlFor={marketId}>
              Market
            </label>
            <select
              id={marketId}
              className="ui-input tr-market-select"
              value={topic.marketId}
              onChange={(event) => onMarketChange(event.target.value)}
            >
              {topic.markets.map((market) => (
                <option key={market.id} value={market.id}>
                  {market.label}
                </option>
              ))}
            </select>
            <span className="tr-market-caret" aria-hidden="true">
              <UiIcon name="chevron-down" size={16} />
            </span>
          </div>
        ) : null}
        <HeaderActions
          more={more}
          primary={
            empty
              ? { label: 'Add questions', icon: 'plus', href: addQuestionsToTopicHash(topic.id) }
              : checking
                ? { label: 'Checking…', icon: 'refresh', busy: true, disabled: true }
                : {
                    label: 'Check now',
                    icon: 'refresh',
                    onClick: onCheckNow,
                    guide: 'topic-check-now'
                  }
          }
        />
      </div>
    </header>
  )
}

/**
 * "· Target page /pricing [Copy] [Open] Change", or "· Set target page" with none (the
 * questions may still point at pages of their own). The guide's target step points here.
 */
function TargetPage({
  targetPage,
  onChange
}: {
  targetPage: string | null
  onChange: () => void
}): JSX.Element {
  return (
    <span className="tr-target-page" data-testid="topic-target-page" data-guide="topic-target-page">
      {targetPage ? (
        <>
          <span>Target page</span>
          <UrlText url={targetPage} label={targetPagePath(targetPage)} />
          <ToolButton kind="edit" label="Change target page" onClick={onChange} />
        </>
      ) : (
        <Button size="sm" variant="ghost" icon="target" onClick={onChange}>
          Set target page
        </Button>
      )}
    </span>
  )
}

/** The topic's name; click it to rename in place (Enter saves, Escape cancels). */
function TopicTitle({
  name,
  paused,
  onRename
}: {
  name: string
  paused: boolean
  onRename: (name: string) => Promise<void>
}): JSX.Element {
  const [value, setValue] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function commit(): Promise<void> {
    if (value === null || saving) return
    const next = value.trim().replace(/\s+/gu, ' ')
    if (next === name) {
      setValue(null)
      return
    }
    if (next.length === 0) {
      setError('Give the topic a name.')
      return
    }
    setSaving(true)
    try {
      await onRename(next)
      setValue(null)
      setError(null)
    } catch (cause) {
      setError(errorText(cause, 'Could not rename the topic.'))
    } finally {
      setSaving(false)
    }
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      void commit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setValue(null)
      setError(null)
    }
  }

  if (value !== null) {
    return (
      <div className="tr-title-edit">
        <input
          className="ui-input tr-title-input"
          aria-label={`Rename ${name}`}
          aria-invalid={error !== null || undefined}
          value={value}
          maxLength={120}
          disabled={saving}
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKey}
          onBlur={() => void commit()}
        />
        {error ? (
          <span className="tr-title-error" role="alert">
            {error}
          </span>
        ) : null}
      </div>
    )
  }
  return (
    <div className="tr-title">
      <h1>
        <button
          type="button"
          className="tr-title-button"
          title="Click to rename"
          onClick={() => setValue(name)}
        >
          {name}
        </button>
      </h1>
      {paused ? <Chip tone="warn">Paused</Chip> : null}
    </div>
  )
}
