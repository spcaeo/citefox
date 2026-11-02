import { useMemo, type JSX } from 'react'
import type { TemplateSettings } from '@shared/domain'
import { changedLines, diffSummary, diffSummaryText, lineDiff } from '../utils/lineDiff'
import { settingsDifferences } from '../utils/settingsForm'

/**
 * "Compare with default" (FR-26.5, TPL-5): the current draft against the shipped
 * default, line by line. Only added and removed lines are listed.
 */
export function CompareView({
  kind,
  body,
  settings,
  shippedBody,
  shippedSettings
}: {
  kind: string
  body: string
  settings: TemplateSettings
  shippedBody: string
  shippedSettings: TemplateSettings
}): JSX.Element {
  const lines = useMemo(() => lineDiff(shippedBody, body), [shippedBody, body])
  const changed = changedLines(lines)
  const summary = diffSummaryText(diffSummary(lines))
  const settingLines = settingsDifferences(kind, settings, shippedSettings)

  return (
    <section className="tpl-compare" aria-labelledby="tpl-compare-h">
      <h3 id="tpl-compare-h">Your version compared with the default</h3>
      {changed.length === 0 ? (
        <p className="muted">
          {settingLines.length === 0
            ? 'No differences. This template matches the default.'
            : `The wording matches the default. This version changes: ${settingLines.join(' · ')}.`}
        </p>
      ) : (
        <>
          <p className="hint" role="status">
            {summary}.
          </p>
          <ol className="tpl-diff" aria-label="Changed lines">
            {changed.map((line, index) => (
              <li
                key={`${index}-${line.kind}`}
                className={`diff-line mono ${line.kind === 'add' ? 'diff-add' : 'diff-del'}`}
              >
                <span className="diff-sign" aria-hidden="true">
                  {line.kind === 'add' ? '+' : '−'}
                </span>
                <span>
                  <span className="sr-only">{line.kind === 'add' ? 'Added: ' : 'Removed: '}</span>
                  {line.text.length > 0 ? line.text : ' '}
                </span>
              </li>
            ))}
          </ol>
          {settingLines.length > 0 ? (
            <p className="hint">Settings also differ: {settingLines.join(' · ')}.</p>
          ) : null}
        </>
      )}
    </section>
  )
}
