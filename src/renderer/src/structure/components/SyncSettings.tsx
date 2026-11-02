import { useId, type JSX } from 'react'
import type { SitemapSyncRules } from '@shared/domain'
import type { SitemapOverview } from '@shared/ipc'
import type { StructureClient } from '../client'
import {
  CHANGED_NOTE,
  CHANGED_RULE_OPTIONS,
  FREQUENCY_OPTIONS,
  NEW_RULE_OPTIONS,
  REMOVED_RULE_OPTIONS
} from '../constants'
import { Panel } from '../../ui'
import type { RunAction } from '../types'
import { dayTime, syncCounts } from '../utils/model'

function RuleGroup<V extends string>({
  legend,
  name,
  value,
  options,
  disabled,
  onChange,
  hint
}: {
  legend: string
  name: string
  value: V
  options: readonly { id: V; label: string }[]
  disabled: boolean
  onChange: (value: V) => void
  /** One helper line under the choices. */
  hint?: string
}): JSX.Element {
  return (
    <fieldset className="str-rule">
      <legend className="str-field-label">{legend}</legend>
      <div className="str-choices">
        {options.map((option) => (
          <label key={option.id} className="str-choice">
            <input
              type="radio"
              name={name}
              value={option.id}
              checked={value === option.id}
              disabled={disabled}
              onChange={() => onChange(option.id)}
            />
            {option.label}
          </label>
        ))}
      </div>
      {hint ? <p className="str-hint">{hint}</p> : null}
    </fieldset>
  )
}

export function SyncSettings({
  client,
  projectId,
  overview,
  run,
  busy
}: {
  client: StructureClient
  projectId: string
  overview: SitemapOverview
  run: RunAction
  busy: string | null
}): JSX.Element {
  const name = useId()
  const rules = overview.rules
  const disabled = busy !== null

  function save(patch: Partial<SitemapSyncRules>): void {
    const next: SitemapSyncRules = { ...rules, ...patch }
    void run('Save sync settings', () => client['sitemaps:setRules']({ projectId, rules: next }))
  }

  const newHint = NEW_RULE_OPTIONS.find((option) => option.id === rules.onNew)?.hint ?? ''
  const removedHint =
    REMOVED_RULE_OPTIONS.find((option) => option.id === rules.onRemoved)?.hint ?? ''
  const last = overview.lastSync

  return (
    <Panel title="Sync rules" titleAs="h3" className="str-rules" padding={20}>
      <RuleGroup
        legend="Check sitemaps"
        name={`${name}-freq`}
        value={rules.frequency}
        options={FREQUENCY_OPTIONS}
        disabled={disabled}
        onChange={(frequency) => save({ frequency })}
      />
      <RuleGroup
        legend="New pages"
        name={`${name}-new`}
        value={rules.onNew}
        options={NEW_RULE_OPTIONS}
        disabled={disabled}
        onChange={(onNew) => save({ onNew })}
        hint={newHint}
      />
      <RuleGroup
        legend="Removed pages"
        name={`${name}-removed`}
        value={rules.onRemoved}
        options={REMOVED_RULE_OPTIONS}
        disabled={disabled}
        onChange={(onRemoved) => save({ onRemoved })}
        hint={removedHint}
      />
      <RuleGroup
        legend="Changed pages (lastmod)"
        name={`${name}-changed`}
        value={rules.onChanged}
        options={CHANGED_RULE_OPTIONS}
        disabled={disabled}
        onChange={(onChanged) => save({ onChanged })}
        hint={CHANGED_NOTE}
      />
      <p className="str-last">
        {last ? (
          <>
            <strong>Last sync {dayTime(last.finishedAt)}</strong> · {syncCounts(last)}
          </>
        ) : (
          'No sync yet.'
        )}
        <br />
        {rules.frequency === 'manual'
          ? 'Your page list stays as it is until you press Sync now.'
          : `Next sync ${dayTime(overview.nextSyncAt)}.`}
      </p>
    </Panel>
  )
}
