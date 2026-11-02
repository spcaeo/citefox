import type { JSX } from 'react'
import type { GenerationTemplate, GenerationTemplateKind } from '@shared/domain'
import type { PlaygroundRunResult } from '@shared/ipc'
import { KIND_LABEL, PLAYGROUND_KIND_ORDER } from '../../templates/model'
import { parseCoverageMatrix, parseProfileParts, parsePromptLines } from '../output'

/** Compare mode: the kind and the 1 to 3 templates to run side by side. */
export function ComparePicker({
  templates,
  kind,
  ids,
  onKind,
  onToggle
}: {
  templates: readonly GenerationTemplate[]
  kind: GenerationTemplateKind
  ids: readonly string[]
  onKind: (kind: GenerationTemplateKind) => void
  onToggle: (id: string) => void
}): JSX.Element {
  const choices = templates.filter(
    (template) => template.kind === kind && template.deletedAt === null
  )
  return (
    <div className="tpl-editor-title">
      <label className="field">
        <span className="field-label">Kind to compare</span>
        <select
          className="select"
          value={kind}
          onChange={(event) => {
            const value = event.target.value
            if (value === 'buyer_profile' || value === 'buyer_prompts') {
              onKind(value)
            }
          }}
        >
          {PLAYGROUND_KIND_ORDER.map((item) => (
            <option key={item} value={item}>
              {KIND_LABEL[item]}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="tpl-facet">
        <legend>Templates to compare</legend>
        {choices.map((template) => (
          <label key={template.id} className="tpl-check">
            <input
              type="checkbox"
              checked={ids.includes(template.id)}
              onChange={() => onToggle(template.id)}
            />
            <span>
              {template.name}
              {template.isDefault && !/\bdefault\b/i.test(template.name) ? ' (default)' : ''}
            </span>
          </label>
        ))}
      </fieldset>
      <p role="status">
        {ids.length} of {choices.length} selected
      </p>
    </div>
  )
}

/** One template's output in a compare. Not saved to a project. */
export function CompareColumn({ run }: { run: PlaygroundRunResult }): JSX.Element {
  const promptLines = parsePromptLines(run.modelOutput)
  const coverage = parseCoverageMatrix(run.modelOutput)
  const profile = !promptLines && !coverage ? parseProfileParts(run.modelOutput) : null
  return (
    <section className="pg-compare-card" aria-label={run.templateName}>
      <h2>{run.templateName}</h2>
      <p className="hint">Not saved to a project.</p>
      {profile
        ? profile.map((part) => (
            <section key={part.heading}>
              <h3>{part.heading}</h3>
              <p className="pg-prose">{part.body}</p>
            </section>
          ))
        : null}
      {promptLines ? (
        <ol className="pg-prose">
          {promptLines.map((line) => (
            <li key={line.n}>{line.text}</li>
          ))}
        </ol>
      ) : null}
      {coverage
        ? coverage.rows.map((row) => (
            <section key={row.n}>
              <h3>
                {row.n}. {row.prompt}
              </h3>
              <p>{row.coverage}</p>
              <p>{row.where}</p>
              <p>{row.gap}</p>
              <p>{row.action}</p>
            </section>
          ))
        : null}
      {!profile && !promptLines && !coverage
        ? run.modelOutput.split(/\n\n+/).map((paragraph, index) => (
            <p key={`${run.runId}-${index}`} className="pg-prose">
              {paragraph}
            </p>
          ))
        : null}
    </section>
  )
}
