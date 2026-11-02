import { useId, type JSX } from 'react'
import type { ApiKeyMetadata, CapRule, ProjectUsageReport } from '@shared/domain'
import type { ProjectDetail } from '@shared/ipc'
import { sectionHash } from '../../shell/routes'
import { unassignedHint } from '../projectsScreen/utils/usageCopy'
import {
  CAP_RULE_OPTIONS,
  claudeOptions,
  clientUsesClaudeCode,
  type NewProjectChoices
} from './payload'

/**
 * FR-10.4 copy settings, FR-11.4 search source, cap and cap rule, and FR-11.7 Claude
 * connection on the New project form.
 */
export function ProjectChoices({
  choices,
  onChange,
  projects,
  keys,
  usage,
  clientName,
  capError
}: {
  choices: NewProjectChoices
  onChange: (next: NewProjectChoices) => void
  projects: readonly ProjectDetail[]
  keys: readonly ApiKeyMetadata[]
  usage: ProjectUsageReport | null
  clientName: string
  capError: string | null
}): JSX.Element {
  const copyId = useId()
  const capId = useId()
  const ruleId = useId()
  const keyId = useId()
  const claudeId = useId()
  const sharedId = useId()
  const ownId = useId()
  const set = (patch: Partial<NewProjectChoices>): void => onChange({ ...choices, ...patch })
  const serpKeys = keys
    .filter((key) => key.provider === 'serpapi')
    .sort((a, b) => a.rotationOrder - b.rotationOrder)
  const dedicatedTaken = new Set(
    (usage?.projects ?? []).flatMap((row) => (row.dedicatedKeyId ? [row.dedicatedKeyId] : []))
  )
  const ownerOf = new Map(
    (usage?.projects ?? []).flatMap((row) =>
      row.dedicatedKeyId ? [[row.dedicatedKeyId, row.name] as const] : []
    )
  )
  const sources = projects.filter((project) => project.status !== 'archived')
  return (
    <>
      <label className="field" htmlFor={copyId}>
        Copy settings from
        <select
          id={copyId}
          className="select"
          value={choices.copyFrom}
          onChange={(event) => set({ copyFrom: event.target.value })}
        >
          <option value="">Start blank (app defaults)</option>
          {sources.map((project) => (
            <option key={project.id} value={project.id}>
              {project.clientName
                ? `${project.name} (client: ${project.clientName})`
                : project.name}
            </option>
          ))}
        </select>
        <span className="hint">
          Copies schedule, samples, notifications and template overrides. Pages, questions and
          history are never copied.
        </span>
      </label>
      <fieldset className="np-searches">
        <legend>Searches</legend>
        <label className="radio-row" htmlFor={sharedId}>
          <input
            id={sharedId}
            type="radio"
            name="np-source"
            checked={choices.source === 'shared'}
            onChange={() => set({ source: 'shared' })}
          />
          <span className="stack-tight">
            <span>Use shared keys</span>
            <span className="hint">{unassignedHint(usage)}</span>
          </span>
        </label>
        {choices.source === 'shared' ? (
          <label className="field np-indent" htmlFor={capId}>
            <span>
              Cap for this project (searches a month) <span className="optional">(optional)</span>
            </span>
            <input
              id={capId}
              className="ob-input mono"
              inputMode="numeric"
              placeholder="No cap"
              value={choices.cap}
              aria-invalid={capError ? true : undefined}
              aria-describedby={capError ? `${capId}-error` : undefined}
              onChange={(event) => set({ cap: event.target.value })}
            />
            {capError ? (
              <span className="field-error" id={`${capId}-error`}>
                {capError}
              </span>
            ) : null}
          </label>
        ) : null}
        <label className="radio-row" htmlFor={ownId}>
          <input
            id={ownId}
            type="radio"
            name="np-source"
            checked={choices.source === 'dedicated'}
            disabled={serpKeys.length === 0}
            onChange={() => set({ source: 'dedicated' })}
          />
          <span className="stack-tight">
            <span>Use a dedicated key</span>
            <span className="hint">
              For a client who pays for their own SerpApi plan. Only this project uses it.
              {serpKeys.length === 0 ? (
                <>
                  {' '}
                  <a href={sectionHash('connections')}>Add a SerpApi key in Connections</a> first.
                </>
              ) : null}
            </span>
          </span>
        </label>
        {choices.source === 'dedicated' ? (
          <label className="field np-indent" htmlFor={keyId}>
            Dedicated key
            <select
              id={keyId}
              className="select"
              value={choices.dedicatedKeyId}
              onChange={(event) => set({ dedicatedKeyId: event.target.value })}
            >
              <option value="">Choose a key</option>
              {serpKeys.map((key) => (
                <option key={key.id} value={key.id} disabled={dedicatedTaken.has(key.id)}>
                  {key.name}
                  {key.maskedKey ? ` · ${key.maskedKey}` : ''}
                  {ownerOf.has(key.id) ? ` · used by ${ownerOf.get(key.id) ?? ''}` : ''}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="field" htmlFor={ruleId}>
          When the cap is reached
          <select
            id={ruleId}
            className="select"
            value={choices.capRule}
            onChange={(event) => set({ capRule: event.target.value as CapRule })}
          >
            {CAP_RULE_OPTIONS.map((rule) => (
              <option key={rule.value} value={rule.value}>
                {rule.label} · {rule.hint}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      <label className="field" htmlFor={claudeId}>
        Claude connection
        <select
          id={claudeId}
          className="select"
          value={choices.claude}
          onChange={(event) => set({ claude: event.target.value })}
        >
          {claudeOptions(keys).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="hint">
          Add Anthropic API keys in <a href={sectionHash('connections')}>Connections</a>.
        </span>
      </label>
      {clientUsesClaudeCode(clientName, choices.claude) ? (
        <p className="note note-warn" role="status">
          Claude Code is for running CiteFox yourself, on your own plan. For client work, use an
          Anthropic API key.
        </p>
      ) : null}
    </>
  )
}
