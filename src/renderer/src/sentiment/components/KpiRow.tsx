import type { JSX } from 'react'
import type { SentimentCheckPoint, SentimentClaim, SentimentOverview } from '@shared/domain'
import {
  formatNet,
  mentionShares,
  netSentiment,
  overviewsNamingBrand,
  ownClaims,
  toneBuckets,
  toneCounts
} from '@shared/sentiment-metrics'
import { DrillButton, DrillFigure, DrillNumber, type ItemDrill } from '../../drill'
import { TONE_LABEL } from '../constants'
import type { SentimentDrills } from '../drills'
import { changeLabel, countNoun } from '../utils/model'
import { KpiStrip, KpiTile } from '../../ui'
import { MarkButton } from './drillBits'
import { pluralize } from '@shared/pluralize'

const TONES = ['positive', 'neutral', 'negative'] as const

/** FR-16.4: net sentiment with change, tone, overviews naming the brand, share of mentions. */
export function KpiRow({
  brand,
  competitors,
  overviews,
  claims,
  trend,
  drills
}: {
  brand: string
  competitors: readonly string[]
  overviews: readonly SentimentOverview[]
  claims: readonly SentimentClaim[]
  trend: readonly SentimentCheckPoint[]
  drills: SentimentDrills
}): JSX.Element {
  const own = ownClaims(claims)
  const counts = toneCounts(own)
  const net = netSentiment(counts)
  const tones = toneBuckets(own)
  const read = overviews.filter((overview) => overview.readState === 'read')
  const named = overviewsNamingBrand(overviews, claims, brand)
  const shares = mentionShares(overviews, claims, brand, competitors)
  const mine = shares.find((row) => row.isOwn)
  const allMentionIds = shares.flatMap((row) => row.overviewIds)
  const ownDrill = drills.claims(
    {
      id: 'claims:own',
      title: `Claims about ${brand}`,
      description: `Every claim about ${brand} in the latest check. Net sentiment = (positive − negative) ÷ all claims × 100.`
    },
    own.map((claim) => claim.id)
  )
  const change = changeLabel(net, trend)
  const compared = trend.slice(-2)
  const toneDrill = (tone: (typeof TONES)[number]): ItemDrill =>
    drills.claims(
      { id: `claims:tone:${tone}`, title: `${TONE_LABEL[tone]} claims about ${brand}` },
      tones[tone].claimIds
    )
  const namedDrill = drills.overviews(
    {
      id: 'overviews:named',
      title: `Overviews that name ${brand}`,
      description: `Read overviews in the latest check with at least one claim about ${brand}.`
    },
    named.map((overview) => overview.id)
  )
  const mentionDrill = drills.overviews(
    {
      id: 'overviews:mentions',
      title: `Overviews that mention ${brand}`,
      description: `${brand}'s share is these overviews out of all brand mentions (one overview naming two brands counts once for each).`
    },
    mine?.overviewIds ?? []
  )

  const ownCount = (
    <DrillNumber
      drill={ownDrill}
      suffix={counts.total === 1 ? ' claim' : ' claims'}
      label={`${countNoun(counts.total, 'claim', 'claims')} about ${brand}, show them`}
    />
  )
  const changeNode =
    compared.length === 2 ? (
      <DrillButton
        drill={drills.checks(
          {
            id: 'checks:change',
            title: `Net sentiment: ${change}`,
            description: `The two full checks behind the change. Each row has its own-brand claim counts.`
          },
          compared
        )}
        untracked
        label={`${change}: compare the two checks`}
        className="st-drill"
      >
        {change}
      </DrillButton>
    ) : (
      change
    )
  const positiveShare =
    counts.total === 0 ? null : Math.round((counts.positive / counts.total) * 100)

  return (
    <KpiStrip className="st-kpi-row" label="Sentiment summary">
      <KpiTile
        label="Net sentiment"
        value={
          <DrillButton
            drill={ownDrill}
            untracked
            label={`Net sentiment ${formatNet(net)} from ${countNoun(counts.total, 'claim', 'claims')}, show them`}
            className={net === null ? 'drill-num st-kpi-none' : 'drill-num'}
          >
            {formatNet(net)}
          </DrillButton>
        }
        sub={
          <>
            −100 to +100 · from {ownCount} · {changeNode}
          </>
        }
      />
      <KpiTile
        label={`Tone of claims about ${brand}`}
        value={
          <DrillButton
            drill={toneDrill('positive')}
            untracked
            label={`${positiveShare ?? 0}% of claims are positive, show them`}
            className="drill-num"
          >
            {positiveShare === null ? '—' : `${positiveShare}%`}
          </DrillButton>
        }
        suffix="positive"
        sub={
          <span className="st-tone-sub">
            <span className="st-tone-bar" aria-hidden="true">
              {TONES.map((tone) =>
                tones[tone].count > 0 ? (
                  <MarkButton
                    key={tone}
                    drill={toneDrill(tone)}
                    className={`st-bar-${tone}`}
                    style={{ flexGrow: tones[tone].count }}
                    title={`${countNoun(tones[tone].count, `${tone} claim`, `${tone} claims`)}`}
                  />
                ) : null
              )}
            </span>
            <span className="st-tone-counts">
              {TONES.map((tone) => {
                const drill = toneDrill(tone)
                return (
                  <DrillButton
                    key={tone}
                    drill={drill}
                    label={`${tones[tone].count} ${tone}, show them`}
                    className={`st-drill st-tone st-tone-${tone}`}
                  >
                    <DrillFigure drill={drill} /> {tone}
                  </DrillButton>
                )
              })}
            </span>
          </span>
        }
      />
      <KpiTile
        label={`Overviews that name ${brand}`}
        value={
          <DrillButton
            drill={namedDrill}
            label={`${named.length} of ${read.length} read overviews name ${brand}, show them`}
            className="drill-num"
          >
            <DrillFigure drill={namedDrill} />
          </DrillButton>
        }
        suffix={`/ ${read.length}`}
        sub={`${countNoun(read.length, 'overview', 'overviews')} read in this check`}
      />
      <KpiTile
        label="Share of mentions"
        value={
          <DrillButton
            drill={mentionDrill}
            untracked
            label={`${brand} share of mentions ${mine?.share ?? 0}%, ${mine?.mentions ?? 0} of ${pluralize(allMentionIds.length, 'mention')}, show them`}
            className="drill-num"
          >
            {mine?.share === null || mine === undefined ? '—' : `${mine.share}%`}
          </DrillButton>
        }
        sub={
          <>
            <DrillNumber
              drill={mentionDrill}
              suffix={` of ${pluralize(allMentionIds.length, 'mention')}`}
              label={`${mine?.mentions ?? 0} of ${pluralize(allMentionIds.length, 'mention')} are ${brand}, show them`}
            />{' '}
            · vs {countNoun(competitors.length, 'competitor', 'competitors')}
          </>
        }
      />
    </KpiStrip>
  )
}
