import { useState, type JSX } from 'react'
import type { SentimentClaim, SentimentOverview } from '@shared/domain'
import { factualProblems } from '@shared/sentiment-metrics'
import { copyText } from '../../components/clipboard'
import { DrillLink, DrillNumber, openTarget, useDrill, type ItemDrill } from '../../drill'
import { Chip, EmptyState, ListGrid, SectionHead, type ListColumn } from '../../ui'
import { formatMoment } from '../../utils/dates'
import type { SentimentDrills } from '../drills'
import { countNoun } from '../utils/model'
import { SourceUrl } from './drillBits'

/**
 * FR-16.5: what the overview claims, why it is wrong, the correction, and the
 * source to fix, as one list grid. A buyer prompt opens Prompt detail; a row
 * opens every claim in that answer, with the overview it comes from; the row
 * menu copies the correction.
 */
export function FactualProblems({
  claims,
  overviews,
  checkedAt,
  hasFacts,
  drills
}: {
  claims: readonly SentimentClaim[]
  overviews: readonly SentimentOverview[]
  checkedAt: string | null
  hasFacts: boolean
  drills: SentimentDrills
}): JSX.Element {
  const { open } = useDrill()
  const problems = factualProblems(claims)
  const problemsDrill = drills.claims(
    {
      id: 'claims:problems',
      title: 'Factual problems',
      description:
        'Claims your brand facts or your own pages contradict. Expand a row for the correction.'
    },
    problems.map((claim) => claim.id)
  )
  const byId = new Map(overviews.map((overview) => [overview.id, overview]))
  const promptOf = (claim: SentimentClaim): string =>
    byId.get(claim.overviewId)?.promptText ?? claim.promptId
  const answerDrill = (claim: SentimentClaim): ItemDrill =>
    drills.claims(
      {
        id: `claims:answer:${claim.overviewId}`,
        title: `Claims in this answer`,
        description: `Every claim in the overview for “${promptOf(claim)}”, the wrong one included.`
      },
      claims.filter((item) => item.overviewId === claim.overviewId).map((item) => item.id)
    )
  const [copied, setCopied] = useState<string | null>(null)
  const basis = hasFacts
    ? 'each claim checked against your brand facts and your own pages'
    : 'each claim checked against your own pages (add brand facts to check more)'

  async function copy(claim: SentimentClaim): Promise<void> {
    const correction = claim.factProblem?.correction ?? ''
    const ok = await copyText(correction)
    setCopied(ok ? claim.id : null)
  }

  const columns: ListColumn<SentimentClaim>[] = [
    {
      id: 'prompt',
      label: 'Question',
      width: 200,
      sort: (claim) => promptOf(claim).toLowerCase(),
      render: (claim) => {
        const overview = byId.get(claim.overviewId)
        const target = overview ? drills.promptTarget(overview) : null
        const text = promptOf(claim)
        return (
          <span className="st-cell-prompt">
            <Chip size="sm">{claim.source === 'brand' ? 'Brand' : 'Buyer'}</Chip>
            {target ? (
              <DrillLink target={target} label={`Open question detail: ${text}`}>
                {text}
              </DrillLink>
            ) : (
              <span>{text}</span>
            )}
          </span>
        )
      }
    },
    {
      id: 'answer',
      label: 'Claims',
      width: 64,
      numeric: true,
      render: (claim) => {
        const answer = answerDrill(claim)
        return (
          <DrillNumber
            drill={answer}
            label={`${countNoun(answer.items.length, 'claim', 'claims')} in this answer: ${promptOf(claim)}`}
          />
        )
      }
    },
    {
      id: 'claim',
      label: 'What the overview claims',
      width: 'fill',
      minWidth: 180,
      render: (claim) => (
        <q className="st-mark-neg" title={claim.sentence}>
          {claim.sentence}
        </q>
      )
    },
    {
      id: 'why',
      label: 'Why it’s wrong',
      width: 'fill',
      minWidth: 180,
      render: (claim) => (
        <span className="st-clamp2" title={claim.factProblem?.why ?? ''}>
          {claim.factProblem?.why}
          <span className="st-basis">
            {claim.factProblem?.basis === 'fact'
              ? 'Checked against your brand facts'
              : 'Checked against your own pages'}
          </span>
        </span>
      )
    },
    {
      id: 'correction',
      label: 'Suggested correction',
      width: 'fill',
      minWidth: 180,
      render: (claim) => (
        <span className="st-clamp2" title={claim.factProblem?.correction ?? ''}>
          {claim.factProblem?.correction}
          <span className="st-basis">
            {copied === claim.id ? 'Copied · ' : ''}
            {claim.factProblem?.sourceToFix ? (
              <>
                Fix: <SourceUrl url={claim.factProblem.sourceToFix} />
              </>
            ) : (
              'No source to fix'
            )}
          </span>
        </span>
      )
    }
  ]

  return (
    <section className="st-section" aria-labelledby="st-problems-h">
      <SectionHead
        id="st-problems-h"
        title="Factual problems worth correcting"
        description={
          <>
            <DrillNumber
              drill={problemsDrill}
              label={`${countNoun(problems.length, 'problem', 'problems')} found, show the claims`}
              suffix={problems.length === 1 ? ' problem' : ' problems'}
            />{' '}
            found in the {formatMoment(checkedAt)} overviews, all shown · {basis}
          </>
        }
      />
      <ListGrid
        label="Factual problems table"
        noun={['problem', 'problems']}
        rows={problems.filter((claim) => claim.factProblem !== null)}
        rowKey={(claim) => claim.id}
        rowLabel={(claim) => claim.sentence}
        columns={columns}
        rowMenu={(claim) => [
          {
            id: 'copy',
            label: copied === claim.id ? 'Copied' : 'Copy the correction',
            icon: 'copy',
            onSelect: () => void copy(claim)
          },
          {
            id: 'answer',
            label: 'Show every claim in this answer',
            icon: 'eye',
            onSelect: () => open(answerDrill(claim))
          },
          ...(claim.factProblem?.sourceToFix
            ? [
                {
                  id: 'fix',
                  label: 'Open the source to fix',
                  icon: 'external' as const,
                  onSelect: () =>
                    openTarget({ kind: 'url', url: claim.factProblem?.sourceToFix ?? '' })
                }
              ]
            : [])
        ]}
        onActivate={(claim) => open(answerDrill(claim))}
        summary={() =>
          'Google rebuilds an overview from the pages it cites, so fix the source first. CiteFox doesn’t post or report anything for you.'
        }
        empty={
          <EmptyState
            compact
            title="No factual problems"
            body="No overview in this check says something your facts or pages contradict."
          />
        }
      />
    </section>
  )
}
