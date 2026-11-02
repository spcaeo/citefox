import { useState, type JSX } from 'react'
import { templateKindInfo, type TemplateVariableHelp } from '@shared/domain'
import type { LlmCallList, TemplateStep, TemplateVersionEntry } from '@shared/ipc'
import { DrillNumber } from '../../drill'
import { SectionHead } from '../../ui'
import { versionsDrill } from '../utils/drills'
import { variableToken } from '../utils/highlight'
import { OUTPUT_FIELDS_NOTE } from '../utils/stepCopy'
import { variableSample } from '../utils/variableSamples'

/** "Variables you can use" (FR-26.2): name, what it holds, and an Insert button. */
export function VariablesTable({
  variables,
  disabled,
  onInsert
}: {
  variables: readonly TemplateVariableHelp[]
  disabled: boolean
  onInsert: (name: string) => void
}): JSX.Element {
  const [shown, setShown] = useState<ReadonlySet<string>>(new Set())
  function toggle(name: string): void {
    setShown((current) => {
      const next = new Set(current)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }
  return (
    <section className="tpl-vars" aria-labelledby="vars-h">
      <SectionHead
        id="vars-h"
        title="Variables you can use"
        count={variables.length}
        description="Filled in for each page and market when the template runs. Select Example to see what a filled value looks like."
      />
      <div className="tpl-scroll">
        <table className="tpl-table">
          <thead>
            <tr>
              <th scope="col">Variable</th>
              <th scope="col">What it holds</th>
            </tr>
          </thead>
          <tbody>
            {variables.map((variable) => (
              <tr key={variable.name}>
                <td>
                  <button
                    type="button"
                    className="tpl-insert"
                    disabled={disabled}
                    onClick={() => onInsert(variable.name)}
                  >
                    <span className="sr-only">Insert </span>
                    {variableToken(variable.name)}
                  </button>
                </td>
                <td className="muted">
                  {variable.holds}
                  {variableSample(variable.name) === null ? null : (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="m3-link"
                        aria-expanded={shown.has(variable.name)}
                        aria-label={`Example value for ${variable.name}`}
                        onClick={() => toggle(variable.name)}
                      >
                        Example
                      </button>
                      {shown.has(variable.name) ? (
                        <span className="mono tpl-var-sample">{variableSample(variable.name)}</span>
                      ) : null}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** "Output fields" (FR-26.2): the step's JSON schema and the retry note. */
export function OutputFields({
  kind,
  schema
}: {
  kind: string
  schema: string | null
}): JSX.Element {
  return (
    <section className="card tpl-card" aria-labelledby="fields-h">
      <SectionHead
        id="fields-h"
        title="Output fields"
        description={templateKindInfo(kind).schemaLabel}
      />
      {schema === null ? (
        <p className="muted">This step has no fixed output fields.</p>
      ) : (
        <pre
          className="mono tpl-view tpl-schema"
          tabIndex={0}
          role="region"
          aria-label="Output fields as JSON schema"
        >
          {schema}
        </pre>
      )}
      <p className="hint">{OUTPUT_FIELDS_NOTE}</p>
    </section>
  )
}

/**
 * Saved versions of what this step runs (FR-26.4). The count opens the
 * version history drawer: each version with the calls that ran it.
 */
export function VersionHistory({
  step,
  versions,
  calls
}: {
  step: TemplateStep
  versions: readonly TemplateVersionEntry[]
  calls: LlmCallList | null
}): JSX.Element | null {
  if (versions.length === 0) return null
  const drill = versionsDrill(step, versions, calls)
  return (
    <p className="tpl-versions">
      Version history:{' '}
      <DrillNumber
        drill={drill}
        label={`Version history: ${versions.length === 1 ? '1 version' : `${versions.length} versions`}`}
        suffix={versions.length === 1 ? ' version' : ' versions'}
      />
    </p>
  )
}
