import type { JSX } from 'react'
import type { ReportScopeKind } from '@shared/domain'
import { ScopeChooser, type ScopeKind, type ScopeOptions } from '../../../../scope'
import { DrawerField, DrawerFields, DrawerSection } from '../../../../ui'
import {
  ALL_PROJECTS_CHOICE,
  FORMAT_OPTIONS,
  WHOLE_PROJECT,
  type MarketOption,
  type NamedProject,
  type ScheduleDraft
} from '../../../scheduleModel'
import { projectOptionLabel } from '../../utils/projects'
import {
  CHECK_SUMMARY,
  isReadyFormat,
  READY_FORMAT_OPTIONS,
  REPORT_CHOICES,
  reportChoice
} from '../../utils/readyReport'

/** What a schedule can cover inside one project, in the order the form lists them. */
const KINDS: readonly ScopeKind[] = ['project', 'pages', 'group', 'cluster', 'topic']

/**
 * What: name, project ("All my projects (one email each)" is an explicit
 * choice), what the report covers inside that project, the file and markets.
 */
export function WhatSection({
  draft,
  patch,
  named,
  markets,
  scope
}: {
  draft: ScheduleDraft
  patch: (partial: Partial<ScheduleDraft>) => void
  named: readonly NamedProject[]
  markets: readonly MarketOption[]
  scope: {
    options: ScopeOptions | null
    error: string | null
    query: string
    onQuery: (query: string) => void
  }
}): JSX.Element {
  return (
    <DrawerSection
      title="What"
      description="The report CiteFox builds from the latest checks."
      testId="sd-what"
    >
      <DrawerFields columns={2}>
        <DrawerField label="Name" htmlFor="n-name">
          <input
            id="n-name"
            className="ui-input"
            data-autofocus
            value={draft.name}
            placeholder="Weekly client report"
            onChange={(event) => patch({ name: event.target.value })}
          />
        </DrawerField>
        <DrawerField
          label="Which report"
          htmlFor="n-report"
          hint={
            draft.report === 'rival'
              ? draft.rival
                ? `Against ${draft.rival}.`
                : 'Against your top competitor at send time.'
              : undefined
          }
        >
          <select
            id="n-report"
            className="ui-input rpt-select"
            value={draft.report ?? CHECK_SUMMARY}
            onChange={(event) => {
              const report = reportChoice(event.target.value)
              patch({
                report,
                // A ready report sends its PDF or offline HTML; the other files are the check summary's.
                ...(report !== null && !isReadyFormat(draft.format) ? { format: 'pdf' } : {})
              })
            }}
          >
            {REPORT_CHOICES.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </DrawerField>
        <DrawerField
          label="Project"
          htmlFor="n-proj"
          hint={draft.projectId === null ? 'Each project gets its own email.' : undefined}
        >
          <select
            id="n-proj"
            className="ui-input rpt-select"
            value={draft.projectId ?? 'all'}
            onChange={(event) =>
              patch({
                projectId: event.target.value === 'all' ? null : event.target.value,
                scope: WHOLE_PROJECT,
                marketIds: []
              })
            }
          >
            {named.map((project) => (
              <option key={project.id} value={project.id}>
                {projectOptionLabel(project)}
              </option>
            ))}
            <option value="all">{ALL_PROJECTS_CHOICE}</option>
          </select>
        </DrawerField>
        {draft.projectId !== null ? (
          <DrawerField label="What it covers" wide htmlFor="sd-scope">
            {scope.error ? (
              <p className="rpt-alert" role="alert">
                Could not load this project&apos;s pages. {scope.error}
              </p>
            ) : scope.options === null ? (
              <p className="rpt-help" role="status">
                Loading pages, groups and topics…
              </p>
            ) : (
              <ScopeChooser
                options={scope.options}
                value={draft.scope}
                onChange={(next) =>
                  patch({ scope: { kind: next.kind as ReportScopeKind, ids: [...next.ids] } })
                }
                kinds={KINDS}
                legend="What the report covers"
                query={scope.query}
                onQueryChange={scope.onQuery}
                testId="sd-scope"
              />
            )}
          </DrawerField>
        ) : null}
        <DrawerField label="Report format" htmlFor="n-fmt">
          <select
            id="n-fmt"
            className="ui-input rpt-select"
            value={draft.format}
            onChange={(event) => patch({ format: event.target.value as ScheduleDraft['format'] })}
          >
            {(draft.report === null ? FORMAT_OPTIONS : READY_FORMAT_OPTIONS).map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </DrawerField>
        <div className="ui-drawer-field">
          <span className="ui-drawer-label" id="n-mk">
            Markets
          </span>
          {markets.length === 0 ? (
            <p className="rpt-help">No markets yet.</p>
          ) : (
            <div className="rpt-markets" role="group" aria-labelledby="n-mk">
              {markets.map((market) => {
                const on = draft.marketIds.includes(market.id)
                return (
                  <button
                    key={market.id}
                    type="button"
                    className="rpt-toggle"
                    aria-pressed={on}
                    onClick={() =>
                      patch({
                        marketIds: on
                          ? draft.marketIds.filter((id) => id !== market.id)
                          : [...draft.marketIds, market.id]
                      })
                    }
                  >
                    {market.label}
                  </button>
                )
              })}
            </div>
          )}
          <p className="ui-drawer-hint">
            {draft.marketIds.length === 0
              ? draft.projectId === null
                ? "None picked: each project's default market."
                : "None picked: the project's default market."
              : 'Only the picked markets.'}
          </p>
        </div>
      </DrawerFields>
    </DrawerSection>
  )
}
