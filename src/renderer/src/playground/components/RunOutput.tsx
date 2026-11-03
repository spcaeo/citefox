import type { JSX } from 'react'
import type { PlaygroundAioResult, PlaygroundRunResult } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { formatReadStamp, shortHash } from '../../pageSetup/model'
import { AioPanel, CoverageMatrix } from '../OutputPanels'
import type { parseCoverageMatrix, parseProfileParts, parsePromptLines } from '../output'
import type { SaveNote } from '../saveNote'
import { SaveNoteText } from './SaveNote'
import { Button } from '../../ui'

/** The current run: usage, rendered prompt, the parsed output, AI Overview checks and Save. */
export function RunOutput({
  run,
  promptLines,
  coverage,
  profile,
  checked,
  onTogglePrompt,
  onCheck,
  checking,
  aio,
  onSave,
  saveNote
}: {
  run: PlaygroundRunResult
  promptLines: ReturnType<typeof parsePromptLines>
  coverage: ReturnType<typeof parseCoverageMatrix>
  profile: ReturnType<typeof parseProfileParts>
  checked: readonly string[]
  onTogglePrompt: (text: string) => void
  onCheck: () => void
  checking: boolean
  aio: PlaygroundAioResult | null
  onSave: () => void
  saveNote: SaveNote | null
}): JSX.Element {
  return (
    <div className="tpl-editor-title">
      <p className="hint">This run is not saved.</p>
      {run.templateUpdatedAt ? (
        <p className="hint">Edited {formatReadStamp(run.templateUpdatedAt)}</p>
      ) : null}
      <details>
        <summary title={run.templateHash}>Wording hash {shortHash(run.templateHash)}</summary>
        <p className="mono">{run.templateHash}</p>
      </details>
      <p>
        {pluralize(run.usage.inputTokens, 'input token')} ·{' '}
        {pluralize(run.usage.outputTokens, 'output token')} ·{' '}
        {pluralize(run.usage.cacheReadTokens, 'token')} read from cache ·{' '}
        {pluralize(run.usage.cacheCreationTokens, 'token')} written to cache ·{' '}
        {pluralize(run.usage.serpapiSearches, 'search', 'searches')}
      </p>
      <p className="faint">
        {run.resolvedModel} · {run.durationMs.toLocaleString('en-US')} ms
      </p>
      {run.warnings.length > 0 ? (
        <ul className="tpl-warnings" aria-label="Unknown variables">
          {run.warnings.map((warning) => (
            <li key={warning.name}>{warning.message}</li>
          ))}
        </ul>
      ) : null}
      <details>
        <summary>Rendered question</summary>
        <pre className="mono pg-output">{run.renderedPrompt}</pre>
      </details>
      {coverage ? <CoverageMatrix view={coverage} /> : null}
      {promptLines ? (
        <section aria-labelledby="prompts-out-h">
          <h2 id="prompts-out-h">
            {promptLines.length} {promptLines.length === 1 ? 'question' : 'questions'}
          </h2>
          <ol>
            {promptLines.map((line) => (
              <li key={line.n}>{line.text}</li>
            ))}
          </ol>
          <fieldset className="tpl-facet">
            <legend>Questions to check</legend>
            {promptLines.map((line) => (
              <label key={line.n} className="tpl-check">
                <input
                  type="checkbox"
                  checked={checked.includes(line.text)}
                  onChange={() => onTogglePrompt(line.text)}
                />
                <span>{line.text}</span>
              </label>
            ))}
          </fieldset>
          <p role="status">
            {checked.length} of {pluralize(promptLines.length, 'question')} selected
          </p>
          <Button disabled={checking || checked.length === 0} onClick={onCheck}>
            Check AI Overviews
          </Button>
        </section>
      ) : null}
      {profile ? (
        <section aria-labelledby="profile-out-h">
          <h2 id="profile-out-h">{profile.length} parts</h2>
          {profile.map((part) => (
            <section key={part.heading}>
              <h3>{part.heading}</h3>
              <p>{part.body}</p>
            </section>
          ))}
        </section>
      ) : null}
      {!coverage && !promptLines && !profile ? (
        <pre className="mono pg-output">{run.modelOutput}</pre>
      ) : null}
      {aio ? <AioPanel result={aio} pageUrl={run.url} /> : null}
      <div className="tpl-actions">
        <Button onClick={onSave}>Save to project</Button>
      </div>
      {saveNote ? <SaveNoteText note={saveNote} /> : null}
    </div>
  )
}
