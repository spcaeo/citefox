import type { JSX } from 'react'
import { CountryOptions, LanguageOptions } from '../onboarding/MarketOptions'
import { Button, Chip, IconButton } from '../ui'
import type { MarketRow } from './addPageModel'

/**
 * The market rows: country, language, city and local wording, one row per
 * market. The first row starts from the project default.
 */
export function AddPageMarkets({
  rows,
  onChange,
  onAdd,
  onRemove
}: {
  rows: readonly MarketRow[]
  onChange: (key: string, patch: Partial<MarketRow>) => void
  onAdd: () => void
  onRemove: (key: string) => void
}): JSX.Element {
  return (
    <div className="ap2-markets">
      {rows.map((row, index) => (
        <div className="ap2-market" key={row.key}>
          <label className="ap2-field">
            <span className="ap2-label">Country</span>
            <select
              className="ui-input"
              aria-label={`Country for market ${index + 1}`}
              value={row.country}
              onChange={(event) => onChange(row.key, { country: event.target.value })}
            >
              <CountryOptions current={row.country} />
            </select>
          </label>
          <label className="ap2-field">
            <span className="ap2-label">Language</span>
            <select
              className="ui-input"
              aria-label={`Language for market ${index + 1}`}
              value={row.language}
              onChange={(event) => onChange(row.key, { language: event.target.value })}
            >
              <LanguageOptions current={row.language} />
            </select>
          </label>
          <label className="ap2-field">
            <span className="ap2-label">City or region (optional)</span>
            <input
              className="ui-input"
              aria-label={`City or region for market ${index + 1}`}
              placeholder="e.g. Austin, Texas"
              value={row.location}
              onChange={(event) => onChange(row.key, { location: event.target.value })}
            />
          </label>
          <div className="ap2-market-end">
            {index === 0 ? (
              <Chip size="sm" tone="info">
                Default
              </Chip>
            ) : null}
            <IconButton
              icon="x"
              size="sm"
              label={`Remove market ${index + 1}`}
              disabled={rows.length === 1}
              onClick={() => onRemove(row.key)}
            />
          </div>
          <label className="ap2-check">
            <input
              type="checkbox"
              className="ui-check"
              checked={row.localWording}
              onChange={(event) => onChange(row.key, { localWording: event.target.checked })}
            />
            Use local wording in questions
          </label>
        </div>
      ))}
      <div className="ap2-market-add">
        <Button size="sm" icon="plus" onClick={onAdd}>
          Add market
        </Button>
        <p className="ap2-hint">
          Checks use desktop. Local wording adds the city to questions where it reads naturally.
        </p>
      </div>
    </div>
  )
}
