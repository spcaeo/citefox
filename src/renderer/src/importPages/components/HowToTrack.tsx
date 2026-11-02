import { useId, useState, type JSX, type ReactNode } from 'react'
import type { MarketDraft } from '@shared/ipc'
import { intervalDaysText } from '@shared/domain'
import { Icon } from '../../components/Icon'
import { SM_BTN } from '../buttons'
import { CountryOptions, LanguageOptions } from '../../onboarding/MarketOptions'
import { marketLabel } from '../../shell/model'
import { INTERVAL_OPTIONS, SAMPLE_OPTIONS } from '../constants'
import type { MarketChoice, TrackSettings } from '../types'
import { StepHead } from './StepHead'

export function HowToTrack({
  choices,
  onToggleMarket,
  onAddMarket,
  settings,
  promptText,
  onPromptText,
  onSettings,
  children
}: {
  choices: readonly MarketChoice[]
  onToggleMarket: (key: string) => void
  onAddMarket: (draft: Omit<MarketDraft, 'device'>) => boolean
  settings: TrackSettings
  promptText: string
  onPromptText: (value: string) => void
  onSettings: (patch: Partial<TrackSettings>) => void
  children: ReactNode
}): JSX.Element {
  const promptsId = useId()
  const promptsHint = useId()
  return (
    <section className="imp-step imp-card" aria-labelledby="imp-step-3">
      <StepHead number={3} id="imp-step-3" title="How to track them" />
      <fieldset className="imp-group">
        <legend className="imp-label">Markets</legend>
        <div className="imp-chips">
          {choices.map((choice) => (
            <label className="choice" key={choice.key}>
              <input
                type="checkbox"
                checked={choice.on}
                onChange={() => onToggleMarket(choice.key)}
              />
              {marketLabel(choice)}
            </label>
          ))}
        </div>
        <AddMarket onAdd={onAddMarket} />
        <p className="hint">Each market is checked and scored separately, with its own baseline.</p>
      </fieldset>
      <fieldset className="imp-group">
        <legend className="imp-label">Re-check every</legend>
        <div className="actions">
          {INTERVAL_OPTIONS.map((days) => (
            <label className="choice" key={days}>
              <input
                type="radio"
                name="imp-interval"
                value={days}
                checked={settings.intervalDays === days}
                onChange={() => onSettings({ intervalDays: days })}
              />
              {intervalDaysText(days)}
            </label>
          ))}
        </div>
        <p className="hint">30 days recommended for large imports</p>
      </fieldset>
      <div className="grid2">
        <div className="field">
          <label htmlFor={promptsId}>Questions per page</label>
          <input
            id={promptsId}
            className="ob-input mono"
            type="number"
            min={1}
            max={50}
            value={promptText}
            aria-describedby={promptsHint}
            onChange={(event) => onPromptText(event.target.value)}
          />
          <span className="hint" id={promptsHint}>
            5 recommended for large imports
          </span>
        </div>
        <fieldset className="imp-group">
          <legend className="imp-label">Samples per question</legend>
          <div className="actions">
            {SAMPLE_OPTIONS.map((count) => (
              <label className="choice" key={count}>
                <input
                  type="radio"
                  name="imp-samples"
                  checked={settings.samples === count}
                  onChange={() => onSettings({ samples: count })}
                />
                {count}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <p className="hint">
        Fewer questions per page keeps a large site affordable. You can add more questions to any
        page later.
      </p>
      <label className="pop-check imp-stagger">
        <input
          type="checkbox"
          checked={settings.stagger}
          onChange={(event) => onSettings({ stagger: event.target.checked })}
        />
        <span>
          <strong>Stagger first checks over 7 days</strong>
          <span className="hint imp-block">
            Spreads the first round so searches and AI work don&apos;t all land on one day.
          </span>
        </span>
      </label>
      {children}
    </section>
  )
}

function AddMarket({
  onAdd
}: {
  onAdd: (draft: Omit<MarketDraft, 'device'>) => boolean
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [country, setCountry] = useState<string>('US')
  const [language, setLanguage] = useState<string>('en')
  const [location, setLocation] = useState('')
  const [note, setNote] = useState<string | null>(null)
  if (!open) {
    return (
      <div>
        <button type="button" className={SM_BTN} onClick={() => setOpen(true)}>
          <Icon name="plus" />
          Add market
        </button>
      </div>
    )
  }
  return (
    <div className="mkt-row" role="group" aria-label="New market">
      <label className="field">
        <span className="hint">Country</span>
        <select
          className="select"
          value={country}
          onChange={(event) => setCountry(event.target.value)}
        >
          <CountryOptions current={country} />
        </select>
      </label>
      <label className="field">
        <span className="hint">Language</span>
        <select
          className="select"
          value={language}
          onChange={(event) => setLanguage(event.target.value)}
        >
          <LanguageOptions current={language} />
        </select>
      </label>
      <label className="field">
        <span className="hint">City or region (optional)</span>
        <input
          className="ob-input"
          placeholder="e.g. Austin, Texas"
          value={location}
          onChange={(event) => setLocation(event.target.value)}
        />
      </label>
      <button
        type="button"
        className={SM_BTN}
        onClick={() => {
          const added = onAdd({
            country,
            language,
            location: location.trim() || null,
            localWording: false
          })
          setNote(added ? null : 'That market is already in the list.')
          if (added) {
            setOpen(false)
            setLocation('')
          }
        }}
      >
        Add
      </button>
      <button type="button" className={SM_BTN} onClick={() => setOpen(false)}>
        Cancel
      </button>
      {note ? (
        <p className="hint" role="status">
          {note}
        </p>
      ) : null}
    </div>
  )
}
