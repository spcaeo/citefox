import { useId, useState, type JSX } from 'react'
import { HELPFILL_SENTENCE_MAX } from '@shared/ipc'
import { Button } from '../Button'
import type { HelpFillChip, HelpFillDescribeCopy } from './types'

/**
 * "✦ Describe it" (panel 1): the question-style label, the box for the user's
 * own words, quick-start chips, the count, the cost before anything runs and a
 * white "✦ Write N …" button. Once rows came back, "Tell Claude what to change…"
 * runs it again with the change added.
 */
export function DescribeForm({
  copy,
  noun,
  costText,
  busy,
  disabled,
  hasResult,
  onWrite
}: {
  copy: HelpFillDescribeCopy
  noun: readonly [string, string]
  costText: string | null
  busy: boolean
  disabled: boolean
  /** Rows came back: offer "Tell Claude what to change…". */
  hasResult: boolean
  onWrite: (sentence: string, count: number) => void
}): JSX.Element {
  const boxId = useId()
  const countId = useId()
  const changeId = useId()
  const [sentence, setSentence] = useState('')
  const [count, setCount] = useState(copy.defaultCount ?? copy.counts?.[0] ?? 10)
  const [change, setChange] = useState('')
  const off = disabled || busy

  function pick(chip: HelpFillChip): void {
    if (chip.onPick) {
      chip.onPick()
      return
    }
    const text = chip.text ?? ''
    if (text.length === 0) return
    setSentence((current) =>
      current.includes(text)
        ? current
            .replace(text, '')
            .replace(/\s{2,}/gu, ' ')
            .trim()
        : [current.trim(), text].filter(Boolean).join(' ').slice(0, HELPFILL_SENTENCE_MAX)
    )
  }

  function redo(): void {
    const extra = change.trim()
    if (extra.length === 0) return
    const asked = [sentence.trim(), `Change: ${extra}`].filter(Boolean).join('\n')
    onWrite(asked.slice(0, HELPFILL_SENTENCE_MAX), count)
  }

  return (
    <div className="hf-describe" data-testid="hf-describe">
      <label className="hf-label" htmlFor={boxId}>
        {copy.label}
      </label>
      <textarea
        id={boxId}
        className="ui-input hf-box"
        rows={3}
        value={sentence}
        maxLength={HELPFILL_SENTENCE_MAX}
        placeholder={copy.placeholder}
        disabled={off}
        onChange={(event) => setSentence(event.target.value)}
      />
      {copy.chips && copy.chips.length > 0 ? (
        <div className="hf-chips" role="group" aria-label="Quick starts">
          {copy.chips.map((chip) => {
            const pressed = chip.pressed ?? (chip.text ? sentence.includes(chip.text) : false)
            return (
              <button
                key={chip.id}
                type="button"
                className="hf-chip"
                aria-pressed={pressed}
                disabled={off}
                onClick={() => pick(chip)}
              >
                {chip.label}
              </button>
            )
          })}
        </div>
      ) : null}
      <div className="hf-row">
        {copy.counts && copy.counts.length > 0 ? (
          <>
            <label className="sr-only" htmlFor={countId}>
              How many {noun[1]}
            </label>
            <select
              id={countId}
              className="ui-input ui-input-sm hf-count"
              value={count}
              disabled={off}
              onChange={(event) => setCount(Number(event.target.value))}
            >
              {copy.counts.map((value) => (
                <option key={value} value={value}>
                  {value} {value === 1 ? noun[0] : noun[1]}
                </option>
              ))}
            </select>
          </>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          icon="sparkle"
          className="hf-spark-btn"
          busy={busy}
          disabled={off}
          onClick={() => onWrite(sentence.trim(), count)}
          data-testid="hf-write"
        >
          {busy ? 'Writing…' : copy.buttonLabel(count)}
        </Button>
        <span className="hf-hint hf-cost">{costText ?? ''}</span>
      </div>
      {hasResult ? (
        <div className="hf-row hf-redo">
          <label className="sr-only" htmlFor={changeId}>
            Tell CiteFox AI what to change
          </label>
          <input
            id={changeId}
            className="ui-input ui-input-sm hf-grow"
            value={change}
            maxLength={300}
            placeholder="Tell CiteFox AI what to change…"
            disabled={off}
            onChange={(event) => setChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                redo()
              }
            }}
          />
          <Button
            variant="text"
            size="sm"
            disabled={off || change.trim().length === 0}
            onClick={redo}
          >
            Redo
          </Button>
        </div>
      ) : null}
    </div>
  )
}
