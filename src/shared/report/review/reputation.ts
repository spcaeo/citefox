import { SENTIMENT_CELL_MIN_CLAIMS } from '../../domain/sentiment'
import { formatNet, netSentiment } from '../../sentiment-metrics'
import { plural } from './items'
import type { SectionInput } from './sections'
import type { Num, QuestionItem } from './types'
import { engineRowsOf } from './engine-rows'
import type { ClaimToneId, ReputationData } from './visibility-extras'
import type {
  BrandView,
  ReputationIssueView,
  ReputationRowView,
  ReputationView,
  ThemeView,
  TonePoint,
  ToneSlice
} from './visibility-types'

/**
 * The Visibility report's Reputation tab (Docs/REPORT-SPEC.md "Reputation"), ported from
 * the Full report's reputation block (src/main/export/sections/reputation.ts): how the
 * answers speak about you, the tone per check, wrong claims with a suggested correction,
 * and every read answer. CiteFox AI reads Google AI Overview answers, so the tab shows
 * under Google AI Overview and All engines and says plainly what it needs otherwise.
 */

const TONES: readonly { tone: ClaimToneId; label: string }[] = [
  { tone: 'positive', label: 'Positive' },
  { tone: 'neutral', label: 'Neutral' },
  { tone: 'negative', label: 'Negative' }
]

function emptyView(needs: string): ReputationView {
  return {
    needs,
    standingLine: null,
    themes: [],
    brands: [],
    basis: '',
    split: [],
    claims: { positive: 0, neutral: 0, negative: 0, net: null },
    trend: [],
    issues: [],
    rows: []
  }
}

export function reputationView(input: SectionInput, data: ReputationData | null): ReputationView {
  const { metrics, ctx, book } = input
  if (metrics.engine !== 'all' && metrics.engine !== 'google_aio') {
    return emptyView(
      `CiteFox AI reads the tone of Google AI Overview answers for now. Pick Google AI Overview or All engines to see it.`
    )
  }
  if (data === null || data.answers === 0) {
    return emptyView(
      'Needs a check with Google AI Overview answers. CiteFox AI reads their tone after each check.'
    )
  }
  if (data.read === 0) {
    return emptyView(
      `CiteFox AI has not read the ${data.answers} ${plural(data.answers, 'answer')} in this check yet. It reads them after each check once CiteFox AI is on in Settings.`
    )
  }
  // An engine row (`google_aio:<check>:<question>`) → the report's question id.
  const toId = new Map<string, string>()
  for (const id of input.toIds(metrics.now.checked.ids)) {
    for (const row of engineRowsOf(metrics, id)) toId.set(row.id, id)
  }
  const byId = new Map(input.questions.map((item) => [item.id, item]))
  const questionOf = (rowId: string | null): QuestionItem | null => {
    if (rowId === null) return null
    const id = toId.get(rowId)
    return id === undefined ? null : (byId.get(id) ?? null)
  }
  const rows: ReputationRowView[] = data.rows.flatMap((row) => {
    const question = questionOf(row.rowId)
    return question === null
      ? []
      : [{ question, tone: row.tone, theme: row.theme, rank: row.rank, reason: row.reason }]
  })
  const brand = data.brand ?? ctx.brand
  const split: ToneSlice[] = TONES.map(({ tone, label }) => ({
    tone,
    label,
    value: book.add(`vis:tone:${tone}`, {
      title: `Answers that read ${label.toLowerCase()} about ${brand}`,
      kind: 'questions',
      ids: [...new Set(rows.filter((row) => row.tone === tone).map((row) => row.question.id))]
    }) as Num
  }))
  const trend = new Map<string, TonePoint>()
  for (const point of data.trend) {
    const label = ctx.day(point.at)
    const known = trend.get(label) ?? {
      label,
      positive: 0,
      neutral: 0,
      negative: 0,
      total: 0,
      net: null
    }
    known.positive += point.positive
    known.neutral += point.neutral
    known.negative += point.negative
    known.total += point.positive + point.neutral + point.negative
    trend.set(label, known)
  }
  const issues: ReputationIssueView[] = data.issues.map((issue) => {
    const question = questionOf(issue.rowId)
    return {
      id: issue.id,
      question,
      questionText: question?.text ?? issue.question,
      claim: issue.claim,
      brand: issue.brand,
      own: issue.own,
      why: issue.why,
      correction: issue.correction,
      sourceToFix: issue.sourceToFix
    }
  })
  const claims = data.claims
  const total = claims.positive + claims.neutral + claims.negative
  const score = netSentiment({ ...claims, total })
  const themes: ThemeView[] = data.themes.map((theme) => {
    const sum = theme.positive + theme.neutral + theme.negative
    return {
      theme: theme.theme,
      positive: theme.positive,
      neutral: theme.neutral,
      negative: theme.negative,
      total: sum,
      net: netSentiment({ ...theme, total: sum }, SENTIMENT_CELL_MIN_CLAIMS),
      examples: theme.examples.map((example) => ({
        claim: example.claim,
        tone: example.tone,
        question: questionOf(example.rowId)
      }))
    }
  })
  const brands: BrandView[] = data.brands.map((item) => {
    const ids = item.rowIds.flatMap((rowId) => {
      const question = questionOf(rowId)
      return question === null ? [] : [question.id]
    })
    const sum = item.positive + item.neutral + item.negative
    return {
      brand: item.brand,
      own: item.own,
      answers: book.add(`vis:brand:${item.brand}`, {
        title: `Answers that name ${item.brand}`,
        kind: 'questions',
        ids: [...new Set(ids)]
      }),
      first: item.first,
      positive: item.positive,
      neutral: item.neutral,
      negative: item.negative,
      net: netSentiment({ ...item, total: sum }, SENTIMENT_CELL_MIN_CLAIMS)
    }
  })
  return {
    needs:
      rows.length === 0 && issues.length === 0
        ? `None of the ${data.read} read ${plural(data.read, 'answer')} names ${brand} yet.`
        : null,
    standingLine:
      total === 0
        ? null
        : score === null
          ? `${total} ${plural(total, 'claim')} about ${brand} so far: ${claims.positive} positive, ${claims.negative} negative. A net score needs 5 or more.`
          : `Net sentiment ${formatNet(score)} from ${total} claims about ${brand}: ${claims.positive} positive, ${claims.neutral} neutral, ${claims.negative} negative.`,
    themes,
    // You first, then the competitors most often named next to you.
    brands:
      brands.length > 1
        ? [...brands].sort(
            (a, b) =>
              Number(b.own) - Number(a.own) ||
              b.answers.n - a.answers.n ||
              a.brand.localeCompare(b.brand)
          )
        : [],
    basis: `Read by CiteFox AI from ${data.read} of ${data.answers} Google AI Overview ${plural(data.answers, 'answer')} in this check.`,
    split: rows.length === 0 ? [] : split,
    claims: { ...claims, net: score },
    trend: [...trend.values()]
      .filter((point) => point.total > 0)
      .map((point) => ({ ...point, net: netSentiment(point) })),
    issues,
    rows
  }
}
