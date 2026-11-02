import { useState, type JSX } from 'react'
import type { StructureInsight, StructureInsightKind } from '@shared/domain'
import { pluralize } from '@shared/pluralize'
import { pageHash } from '../../shell/routes'
import { Button, Chip, LinkButton, SectionHead } from '../../ui'
import { INSIGHT_CHOICE } from '../constants'
import type { StructureDrills } from '../hooks/useStructureDrills'
import { AsyncDrill } from './AsyncDrill'

const KIND_LABELS: Readonly<Record<StructureInsightKind, string>> = {
  cannibalization: 'Two pages compete',
  orphan: 'Orphan pages',
  thin_coverage: 'Thin coverage',
  template_pages: 'Template pages'
}

/** FR-19.8 "Claude noticed". The flags come from rules over stored pages and checks. */
export function Insights({
  insights,
  drills
}: {
  insights: readonly StructureInsight[]
  drills: StructureDrills
}): JSX.Element | null {
  const [choices, setChoices] = useState<Readonly<Record<string, string>>>({})
  if (insights.length === 0) return null
  return (
    <section className="str-insights" aria-labelledby="str-insights-h">
      <SectionHead
        id="str-insights-h"
        className="str-insights-head"
        title="CiteFox AI noticed"
        description="Found by CiteFox from your pages and checks. Nothing changes until you act."
      />
      {insights.map((insight) => {
        const first = insight.pageIds[0]
        const choice = choices[insight.id]
        return (
          <article key={insight.id} className="str-insight" aria-label={insight.title}>
            <Chip size="sm" tone={insight.kind === 'cannibalization' ? 'warn' : 'neutral'}>
              {KIND_LABELS[insight.kind]}
            </Chip>
            <h3>{insight.title}</h3>
            <p className="str-insight-body">{insight.body}</p>
            {insight.pages.length > 0 ? (
              <ul className="str-insight-pages" aria-label="Pages">
                {insight.pages.map((page) => (
                  <li key={page.id}>
                    <a href={pageHash(page.id)}>{page.label}</a>
                  </li>
                ))}
                {insight.pageIds.length > insight.pages.length ? (
                  <li>
                    <AsyncDrill
                      className="str-row-link"
                      prefix={capped(insight) ? '' : 'All '}
                      suffix={capped(insight) ? ` of ${insight.pageCount} pages` : ' pages'}
                      nfrId={`insight:${insight.id}`}
                      label={`${drillCountLabel(insight)}: ${insight.title}`}
                      load={() =>
                        drills.pagesById(
                          {
                            id: `insight:${insight.id}`,
                            title: insight.title,
                            description: capped(insight)
                              ? `The first ${insight.pageIds.length} of the ${insight.pageCount} pages this flag is about.`
                              : `Every page this flag is about.`
                          },
                          insight.pageIds
                        )
                      }
                    >
                      {insight.pageIds.length}
                    </AsyncDrill>
                  </li>
                ) : null}
              </ul>
            ) : null}
            {insight.kind === 'cannibalization' ? (
              <div className="str-insight-actions">
                <Button
                  size="sm"
                  aria-pressed={choice === 'merge'}
                  onClick={() => setChoices((current) => ({ ...current, [insight.id]: 'merge' }))}
                >
                  Merge the two pages
                </Button>
                <Button
                  size="sm"
                  aria-pressed={choice === 'differentiate'}
                  onClick={() =>
                    setChoices((current) => ({ ...current, [insight.id]: 'differentiate' }))
                  }
                >
                  Differentiate them
                </Button>
                {first ? (
                  <LinkButton size="sm" variant="ghost" href={pageHash(first, 'gaps')}>
                    Open content gaps
                  </LinkButton>
                ) : null}
              </div>
            ) : null}
            {choice ? (
              <p className="str-ok" role="status">
                {INSIGHT_CHOICE}
              </p>
            ) : null}
          </article>
        )
      })}
    </section>
  )
}

/** The flag lists only its first pages when it is about more than the payload carries. */
function capped(insight: StructureInsight): boolean {
  return insight.pageCount > insight.pageIds.length
}

function drillCountLabel(insight: StructureInsight): string {
  return capped(insight)
    ? `${insight.pageIds.length} of ${pluralize(insight.pageCount, 'page')}`
    : `All ${pluralize(insight.pageIds.length, 'page')}`
}
