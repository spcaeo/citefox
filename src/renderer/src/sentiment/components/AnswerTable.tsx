import { useMemo, type JSX } from 'react'
import type { ClaimTone, SentimentClaim, SentimentOverview } from '@shared/domain'
import { answerRows, rankLabel, type AnswerRow } from '@shared/sentiment-metrics'
import { askColumn } from '../../assistant/sparkle/askColumn'
import { DrillButton, DrillFigure, DrillLink, openTarget } from '../../drill'
import { DrawerLevel } from '../../shell/DrawerLevel'
import { openDrawer, useDrawerEntry } from '../../shell/drawers'
import { Button, Chip, EmptyState, ListGrid, type ListColumn } from '../../ui'
import { useHashQuery } from '../../utils/hashQuery'
import { TONE_LABEL } from '../constants'
import type { SentimentDrills } from '../drills'
import { countNoun, filterAnswers } from '../utils/model'
import { AnswerDrawer } from './AnswerDrawer'

const TONE_ORDER: Readonly<Record<ClaimTone, number>> = { positive: 0, neutral: 1, negative: 2 }

const TONE_OPTIONS = [
  { value: 'all', label: 'All tones' },
  { value: 'positive', label: 'Positive' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'negative', label: 'Negative' }
] as const

type ToneFilter = (typeof TONE_OPTIONS)[number]['value']

/** The tone filter is on the route (`?tone=negative`); All tones has no value. */
const QUERY = ['tone'] as const

function toneFrom(value: string | null): ToneFilter {
  return TONE_OPTIONS.find((option) => option.value === value)?.value ?? 'all'
}

/**
 * FR-16.7: each overview naming the brand, its rank among brands named, and a
 * written reason, as one list grid. A buyer prompt opens Prompt detail; the
 * tone count and the theme open their claims; the rank, a row or its menu
 * open the answer in a drawer on the URL (`drawer=st-answer&sa.id=<overview>`):
 * the full reason, the claims, the brands named in order and the sources.
 */
export function AnswerTable({
  brand,
  overviews,
  claims,
  drills
}: {
  brand: string
  overviews: readonly SentimentOverview[]
  claims: readonly SentimentClaim[]
  drills: SentimentDrills
}): JSX.Element {
  const [query, setQuery] = useHashQuery(QUERY)
  const tone = toneFrom(query.tone)
  const setTone = (next: string): void => setQuery({ tone: next === 'all' ? null : next })
  const drawer = useDrawerEntry('st-answer')
  const openId = drawer?.entry.params['sa.id'] ?? null
  const open = (overviewId: string): void => {
    openDrawer('st-answer', { 'sa.id': overviewId })
  }
  const byOverview = useMemo(
    () => new Map(overviews.map((overview) => [overview.id, overview] as const)),
    [overviews]
  )
  const byClaim = useMemo(
    () => new Map(claims.map((claim) => [claim.id, claim] as const)),
    [claims]
  )
  const claimsOf = (row: AnswerRow): SentimentClaim[] =>
    row.claimIds.flatMap((id) => {
      const claim = byClaim.get(id)
      return claim ? [claim] : []
    })
  const rows = useMemo(() => answerRows(overviews, claims, brand), [overviews, claims, brand])
  const shown = filterAnswers(rows, '', tone)
  const openRow = openId === null ? null : (rows.find((row) => row.overviewId === openId) ?? null)
  const openOverview = openRow ? byOverview.get(openRow.overviewId) : undefined

  const columns: ListColumn<AnswerRow>[] = [
    {
      id: 'prompt',
      label: 'Question',
      width: 'fill',
      minWidth: 240,
      sort: (row) => row.promptText.toLowerCase(),
      render: (row) => {
        const overview = byOverview.get(row.overviewId)
        const target = overview ? drills.promptTarget(overview) : null
        return (
          <span className="st-cell-prompt">
            <Chip size="sm">{row.source === 'brand' ? 'Brand' : 'Buyer'}</Chip>
            {target ? (
              <DrillLink target={target} label={`Open question detail: ${row.promptText}`}>
                {row.promptText}
              </DrillLink>
            ) : (
              <span>{row.promptText}</span>
            )}
          </span>
        )
      }
    },
    {
      id: 'tone',
      label: 'Tone',
      width: 128,
      sort: (row) => TONE_ORDER[row.tone],
      render: (row) => {
        const drill = drills.claims(
          {
            id: `answer:${row.overviewId}`,
            title: `Claims about ${brand} in this answer`,
            description: `The claims about ${brand} in the overview for “${row.promptText}”.`
          },
          row.claimIds
        )
        return (
          <DrillButton
            drill={drill}
            label={`${TONE_LABEL[row.tone]} · ${countNoun(row.claimIds.length, 'claim', 'claims')} about ${brand}, show them`}
            className={`st-drill st-tone st-tone-${row.tone}`}
          >
            {TONE_LABEL[row.tone]} · <DrillFigure drill={drill} />
          </DrillButton>
        )
      }
    },
    {
      id: 'theme',
      label: 'Theme',
      width: 150,
      sort: (row) => row.theme?.toLowerCase() ?? null,
      render: (row) =>
        row.theme === null ? (
          '—'
        ) : (
          <DrillButton
            drill={drills.claims(
              {
                id: `answer:${row.overviewId}:theme:${row.theme}`,
                title: `${row.theme} in this answer`,
                description: `Claims about ${brand} on ${row.theme} in the overview for “${row.promptText}”.`
              },
              claimsOf(row)
                .filter((claim) => claim.theme === row.theme)
                .map((claim) => claim.id)
            )}
            untracked
            label={`Show this answer's claims about ${row.theme}`}
            className="st-drill"
          >
            {row.theme}
          </DrillButton>
        )
    },
    {
      id: 'rank',
      label: 'Rank',
      width: 168,
      sort: (row) => row.rank,
      render: (row) =>
        byOverview.has(row.overviewId) ? (
          <button
            type="button"
            className="st-drill"
            aria-haspopup="dialog"
            aria-label={`Rank ${rankLabel(row)}: show the brands named`}
            onClick={() => open(row.overviewId)}
          >
            {rankLabel(row)}
          </button>
        ) : (
          rankLabel(row)
        )
    },
    {
      id: 'why',
      label: 'Why',
      width: 'fill',
      minWidth: 200,
      render: (row) => <span className="st-muted-cell">{row.reason ?? '—'}</span>
    }
  ]

  return (
    <>
      <ListGrid
        label="Answers table"
        noun={['answer', 'answers']}
        rows={shown}
        rowKey={(row) => row.overviewId}
        rowLabel={(row) => row.promptText}
        columns={[
          ...columns,
          askColumn<AnswerRow>((row) => ({
            kind: 'question',
            id: byOverview.get(row.overviewId)?.promptId ?? null,
            label: row.promptText,
            detail: TONE_LABEL[row.tone]
          }))
        ]}
        search={{
          text: (row) =>
            [row.promptText, row.promptLabel, row.reason ?? '', row.theme ?? ''].join(' '),
          placeholder: 'Search answers by question or reason'
        }}
        filter={{
          label: 'Tone',
          options: TONE_OPTIONS,
          value: tone,
          onChange: setTone
        }}
        rowMenu={(row) => {
          const overview = byOverview.get(row.overviewId)
          const target = overview ? drills.promptTarget(overview) : null
          return [
            {
              id: 'open',
              label: 'Read the full answer',
              icon: 'eye',
              disabled: overview === undefined,
              onSelect: () => open(row.overviewId)
            },
            ...(target
              ? [
                  {
                    id: 'prompt',
                    label: 'Open question detail',
                    icon: 'external' as const,
                    onSelect: () => openTarget(target)
                  }
                ]
              : [])
          ]
        }}
        onActivate={(row) => {
          if (byOverview.has(row.overviewId)) open(row.overviewId)
        }}
        isRowCurrent={(row) => row.overviewId === openId}
        empty={
          <EmptyState
            compact
            title={rows.length === 0 ? `No overview in this check names ${brand}` : 'No answers'}
            {...(rows.length > 0
              ? {
                  body: 'No answer has this tone.',
                  action: (
                    <Button size="sm" onClick={() => setTone('all')}>
                      Show all tones
                    </Button>
                  )
                }
              : {})}
          />
        }
      />
      {drawer ? (
        <DrawerLevel depth={drawer.depth}>
          <AnswerDrawer
            brand={brand}
            row={openRow}
            overview={openOverview}
            claims={openRow ? claimsOf(openRow) : []}
            promptTarget={openOverview ? drills.promptTarget(openOverview) : null}
            onClose={() => drawer.close()}
          />
        </DrawerLevel>
      ) : null}
    </>
  )
}
