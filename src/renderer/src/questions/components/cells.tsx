import { Fragment, type JSX } from 'react'
import { brandRuns, type BrandLens } from '@shared/brand-mentions'
import type { ClaimTone } from '@shared/domain'
import type { QuestionChange, QuestionRow, QuestionSource } from '@shared/ipc'
import { CitedSites } from '../../components/CitedSites'
import { pathOf, stageLabel } from '../../topics/clusters'
import {
  ChangeCell as SharedChangeCell,
  Chip,
  ResultChip,
  UrlText,
  type ChangeTone,
  resultBucket,
  useResultWords,
  type ChipTone,
  type ResultBucket,
  type ResultKind
} from '../../ui'
import { CHANGE_LABEL, questionBucket, questionResultKind } from '../model'

/** The question, with the brand and own site in a `--mark` highlight. Text stays text nodes. */
export function QuestionText({
  row,
  lens
}: {
  row: QuestionRow
  lens: BrandLens | null
}): JSX.Element {
  return (
    <span className={row.enabled ? 'qs-text' : 'qs-text qs-text-off'} title={row.text}>
      {/* The words sit in their own box so a long question ends in an ellipsis. */}
      <span className="qs-text-words">
        {brandRuns(row.text, lens).map((run, index) =>
          run.marked ? (
            <mark key={index} className="qs-mark">
              {run.text}
            </mark>
          ) : (
            <Fragment key={index}>{run.text}</Fragment>
          )
        )}
      </span>
      {row.enabled ? null : (
        <Chip size="sm" className="qs-off-chip">
          Off
        </Chip>
      )}
    </span>
  )
}

/** A page's path with copy and open buttons, or the topic's name. */
export function SourceCell({ source }: { source: QuestionSource | undefined }): JSX.Element {
  if (!source) return <span className="faint">—</span>
  if (source.kind === 'topic') {
    return (
      <span className="qs-source" title={source.name}>
        <Chip size="sm" tone="info">
          Topic
        </Chip>
        <span className="qs-source-name">{source.name}</span>
      </span>
    )
  }
  if (source.url === null) return <span className="qs-source-name">{source.name}</span>
  return <UrlText url={source.url} label={source.path ?? source.name} />
}

/** "Question" or "Keyword" (a short topic search). */
export function KindCell({ row }: { row: QuestionRow }): JSX.Element {
  return row.promptKind === 'keyword' ? (
    <span className="faint">Keyword</span>
  ) : (
    <span>Question</span>
  )
}

/** The journey stage label, or a dash. */
export function StageCell({ row }: { row: QuestionRow }): JSX.Element {
  if (row.stage === null) return <span className="faint">—</span>
  return <span>{stageLabel(row.stage)}</span>
}

/** The target page's path with copy and open buttons, or "None yet". */
export function TargetCell({ row }: { row: QuestionRow }): JSX.Element {
  if (row.targetUrl === null) return <span className="faint">None yet</span>
  return <UrlText url={row.targetUrl} label={pathOf(row.targetUrl)} />
}

/**
 * The result in the four shared words (audit2 #3): "Target page" green, "Your
 * other page" blue, "Not cited" orange, "No AI Overview" quiet. A named brand
 * is its own small badge, and Google's place a quiet "#2" after the pill.
 */
export function ResultCell({ row }: { row: QuestionRow }): JSX.Element {
  const words = useResultWords()
  if (!row.inMarket) return <span className="faint">Not in this market</span>
  // A running check has not reached it yet: quiet words, never "not cited" or a red mark.
  if (row.live && row.result === 'not_checked') {
    return <span className="faint">{row.live === 'checking' ? 'Checking…' : 'Waiting'}</span>
  }
  const bucket = questionBucket(row)
  const kind = questionResultKind(row)
  const cited = bucket === 'target' || bucket === 'other_page'
  return (
    <span className="qs-result">
      {bucket === null ? (
        <ResultChip result={kind === 'failed' ? 'failed' : 'not_checked'} />
      ) : (
        <ResultChip
          result={BUCKET_KIND[bucket]}
          label={bucket === 'no_overview' ? words.none : resultBucket(bucket).label}
        />
      )}
      {cited && row.position !== null ? (
        <span
          className="faint num"
          title={`Google showed your page as source ${Math.round(row.position)}`}
        >
          #{Math.round(row.position)}
        </span>
      ) : null}
      {!cited && kind === 'named' ? (
        <span title="Your brand is named in the answer, but no page of yours is cited">
          <Chip size="sm" className="ui-result-named">
            Named
          </Chip>
        </span>
      ) : null}
    </span>
  )
}

const BUCKET_KIND: Readonly<Record<ResultBucket, ResultKind>> = {
  target: 'cited',
  other_page: 'own_page',
  not_cited: 'not_cited',
  no_overview: 'no_overview'
}

/** The sources cited instead: the first whole, the others as site icons. */
export function InsteadCell({ row }: { row: QuestionRow }): JSX.Element {
  return <CitedSites names={row.citedInstead} className="qs-instead" />
}

const TONE_CHIP: Readonly<Record<ClaimTone, { tone: ChipTone; label: string }>> = {
  positive: { tone: 'ok', label: 'Positive' },
  neutral: { tone: 'neutral', label: 'Neutral' },
  negative: { tone: 'bad', label: 'Negative' }
}

export function SentimentCell({ tone }: { tone: ClaimTone | null }): JSX.Element {
  if (tone === null) return <span className="faint">—</span>
  const chip = TONE_CHIP[tone]
  return (
    <Chip size="sm" tone={chip.tone}>
      {chip.label}
    </Chip>
  )
}

const CHANGE_TONE: Readonly<Record<QuestionChange, ChangeTone>> = {
  gained: 'good',
  lost: 'bad',
  new_overview: 'info',
  gone: 'warn',
  none: 'neutral'
}

/** The shared change cell: coloured text, and "—" for no change. */
export function ChangeCell({ change }: { change: QuestionChange }): JSX.Element {
  return (
    <SharedChangeCell
      label={change === 'none' ? null : CHANGE_LABEL[change]}
      tone={CHANGE_TONE[change]}
    />
  )
}
