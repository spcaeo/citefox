import {
  CITATION_SOURCE_TYPE_VALUES,
  CITATION_CLASS_VALUES,
  COVERAGE_ACTION_VALUES,
  COVERAGE_FINDING_VALUES,
  COVERAGE_LEVEL_VALUES,
  INTENT_STAGE_VALUES,
  PROMPT_SOURCE_VALUES,
  PROMPT_STATUS_VALUES,
  REPORT_SECTION_VALUES
} from './enums'
import { CITATION_CHANGES } from '@shared/report/diff'
import { SITE_KINDS } from '@shared/report/site-kinds'
import { VERDICT_SETS } from '@shared/report/verdict'
import { ANSWER_SHAPE_CODES } from '../../analytics/answer-shape/vocabulary'
import { TOPICS_FILE, topicDefinitions } from './topic-schema'

/**
 * JSON Schema (draft-07) for the `report` object of a v2 export: the report model of
 * src/main/export/model/types.ts, split over four files so each stays readable:
 * `citefox-report.v2.json` (the object), `citefox-report-common.v2.json` (counts, rows,
 * shared shapes), `citefox-report-sections.v2.json` (cover to trends) and
 * `citefox-report-more.v2.json` (universe to content gaps). They are written by
 * `CITEFOX_WRITE_SCHEMA=1 npx vitest run src/main/export/json.test.ts`, and a test keeps
 * the files and this builder equal.
 */

type Schema = Record<string, unknown>

const COMMON = 'citefox-report-common.v2.json'
const SECTIONS = 'citefox-report-sections.v2.json'
const MORE = 'citefox-report-more.v2.json'
const ref = (name: string): Schema => ({ $ref: `${COMMON}#/definitions/${name}` })
const sectionRef = (file: string, name: string): Schema => ({
  $ref: `${file}#/definitions/${name}`
})
const str: Schema = { type: 'string' }
const nstr: Schema = { type: ['string', 'null'] }
const int: Schema = { type: 'integer', minimum: 0 }
const num: Schema = { type: 'number' }
const nnum: Schema = { type: ['number', 'null'] }
const nint: Schema = { type: ['integer', 'null'], minimum: 0 }
const bool: Schema = { type: 'boolean' }
const arr = (items: Schema): Schema => ({ type: 'array', items })
const strings: Schema = arr(str)
const enumOf = (values: readonly string[]): Schema => ({ enum: [...values] })

/** A closed object: every listed property is required unless named in `optional`. */
function obj(properties: Record<string, Schema>, optional: readonly string[] = []): Schema {
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties).filter((key) => !optional.includes(key)),
    properties
  }
}

const nullable = (schema: Schema): Schema => ({ anyOf: [schema, { type: 'null' }] })

const who = enumOf(['you', 'competitor', 'observed'])

const DEFINITIONS: Record<string, Schema> = {
  count: {
    ...obj({ n: int, drill: nstr }),
    description: 'A number and the rows behind it. drills[drill] lists exactly n row ids (NFR-14).'
  },
  pct: { type: ['integer', 'null'], minimum: 0, maximum: 100 },
  empty: nullable(obj({ title: str, message: str, nextStep: nstr })),
  instant: { type: 'string', minLength: 1, description: 'ISO-8601 UTC.' },
  nullableInstant: { type: ['string', 'null'] },
  market: obj({ id: str, code: str, label: str, flag: str }),
  page: obj({ id: str, url: str, path: str, title: nstr, role: enumOf(['tracked', 'other_own']) }),
  row: obj({
    id: str,
    promptId: str,
    pageId: str,
    marketId: str,
    runId: str,
    number: int,
    label: str,
    text: str,
    stage: enumOf(INTENT_STAGE_VALUES),
    funnel: { enum: ['TOFU', 'MOFU', 'BOFU', null] },
    source: enumOf(PROMPT_SOURCE_VALUES),
    status: enumOf(PROMPT_STATUS_VALUES),
    aio: bool,
    cited: bool,
    pageCited: bool,
    named: bool,
    wrongPage: bool,
    notVisible: bool,
    citedUrl: nstr,
    position: nnum,
    topDomains: strings,
    checkedAt: ref('nullableInstant'),
    aioExcerpt: nstr
  }),
  reference: obj({
    rowId: str,
    position: int,
    url: str,
    normalizedUrl: str,
    domain: str,
    title: nstr,
    classification: enumOf(CITATION_CLASS_VALUES),
    untracked: bool,
    sourceType: enumOf(CITATION_SOURCE_TYPE_VALUES)
  }),
  opportunityBar: obj({
    key: str,
    label: str,
    total: ref('count'),
    notVisible: ref('count'),
    namedOnly: ref('count'),
    citedOnly: ref('count'),
    winning: ref('count')
  }),
  deltaList: obj({
    count: ref('count'),
    items: arr(
      obj({ rowId: str, prompt: str, pagePath: str, marketId: str, before: str, after: str })
    )
  }),
  universeRow: obj({
    key: str,
    label: str,
    prompts: ref('count'),
    aio: ref('count'),
    cited: ref('count'),
    named: ref('count'),
    citedRate: ref('pct')
  }),
  universeDimension: obj({
    id: enumOf(['stage', 'funnel', 'source', 'page', 'group', 'market']),
    title: str,
    rows: arr(ref('universeRow'))
  }),
  journey: obj({ fingerprint: str, codes: arr(enumOf(ANSWER_SHAPE_CODES)), prompts: ref('count') })
}

const cover = obj({
  title: str,
  domain: str,
  projectName: str,
  clientName: nstr,
  scope: enumOf(['page', 'project']),
  scopeLabel: str,
  scopeSlug: str,
  builtAt: ref('instant'),
  windowFrom: ref('nullableInstant'),
  windowTo: ref('nullableInstant'),
  timeZone: str,
  promptsTracked: int,
  brands: strings,
  competitors: strings,
  trackedPages: int,
  templates: arr(obj({ kind: str, name: str, hash: str })),
  brandColor: str
})

const overview = obj({
  headline: str,
  tracked: ref('count'),
  aio: ref('count'),
  aioPct: ref('pct'),
  failed: ref('count'),
  cited: ref('count'),
  citedPct: ref('pct'),
  pageCited: ref('count'),
  named: ref('count'),
  winning: ref('count'),
  notVisible: ref('count'),
  wrongPage: ref('count'),
  score: { type: ['integer', 'null'] },
  scoreChange: { type: ['integer', 'null'] },
  previousCheckAt: ref('nullableInstant'),
  funnel: arr(
    obj({
      id: enumOf(['tracked', 'aio', 'cited', 'page_cited', 'named']),
      label: str,
      count: ref('count'),
      dropReason: nstr
    })
  ),
  opportunityByStage: arr(ref('opportunityBar')),
  opportunityByPage: arr(ref('opportunityBar')),
  coverageLine: str,
  measured: int,
  topActions: arr(obj({ rank: int, text: str, reason: str, rowId: str }))
})

const pagesSection = obj({
  empty: ref('empty'),
  pagesTracked: int,
  pagesCited: int,
  pagesNeverCited: int,
  otherOwnCited: int,
  mostCited: arr(
    obj({ url: str, path: str, tracked: bool, prompts: ref('count'), citations: int })
  ),
  tracked: arr(
    obj({
      pageId: str,
      url: str,
      path: str,
      title: nstr,
      score: { type: ['integer', 'null'] },
      prompts: ref('count'),
      aio: ref('count'),
      pageCited: ref('count'),
      ownCited: ref('count'),
      named: ref('count'),
      citationsTarget: int,
      citationsOtherOwn: int,
      lastChecked: ref('nullableInstant')
    })
  ),
  otherOwn: arr(
    obj({ url: str, path: str, prompts: ref('count'), citations: int, likelyNoise: bool })
  ),
  wrongPage: arr(obj({ rowId: str, prompt: str, citedUrl: str, trackedUrl: str, marketId: str }))
})

const competition = obj({
  empty: ref('empty'),
  domainsCited: int,
  reach: ref('count'),
  reachPct: ref('pct'),
  rival: nullable(obj({ domain: str, prompts: ref('count') })),
  rivalLead: { type: ['integer', 'null'] },
  gapPrompts: ref('count'),
  sov: obj({
    total: ref('count'),
    you: ref('count'),
    competitor: ref('count'),
    others: ref('count'),
    none: ref('count')
  }),
  mostCited: arr(obj({ domain: str, who, prompts: ref('count'), before: nint })),
  leaderboard: arr(
    obj({
      domain: str,
      who,
      kind: { enum: [...SITE_KINDS, null] },
      prompts: ref('count'),
      overlap: nullable(ref('count')),
      gap: nullable(ref('count')),
      avgPosition: nnum,
      authority: { type: 'integer', minimum: 0, maximum: 100 },
      reach: num,
      prominence: num,
      marketCoverage: num
    })
  ),
  byKind: arr(
    obj({
      kind: enumOf(SITE_KINDS),
      label: str,
      sites: int,
      before: nint,
      now: int,
      change: { type: ['integer', 'null'] },
      prompts: ref('count')
    })
  ),
  authorityNote: str
})

const verdictTone = enumOf(['ok', 'warn', 'bad', 'neutral'])

const verdict = obj({
  status: enumOf(['strong', 'working', 'mixed', 'slipping', 'flat', 'early']),
  label: str,
  tone: verdictTone,
  compareLabel: nstr,
  previousAt: ref('nullableInstant'),
  currentAt: ref('nullableInstant'),
  findings: arr(
    obj({
      id: enumOf(['movement', 'holding', 'named', 'opportunity', 'competition', 'first']),
      tone: verdictTone,
      lead: str,
      parts: arr({
        anyOf: [str, obj({ set: enumOf(VERDICT_SETS), label: str, n: int, drill: nstr })]
      })
    })
  )
})

const whatChanged = obj({
  empty: ref('empty'),
  previousAt: ref('nullableInstant'),
  currentAt: ref('nullableInstant'),
  gained: ref('count'),
  kept: ref('count'),
  lost: ref('count'),
  never: ref('count'),
  noEarlier: ref('count'),
  rows: arr(
    obj({
      rowId: str,
      prompt: str,
      pagePath: str,
      marketId: str,
      change: { enum: [...CITATION_CHANGES, null] },
      positionBefore: nnum,
      positionNow: nnum,
      citedThrough: nstr,
      ownPageCited: { type: ['boolean', 'null'] }
    })
  )
})

const recommendations = arr(
  obj({
    kind: enumOf(['competitor_gap', 'wrong_page', 'content_gap', 'not_visible']),
    doThis: str,
    why: str,
    questions: ref('count'),
    evidence: arr(
      obj({
        rowId: str,
        question: str,
        pagePath: str,
        marketId: str,
        competitor: nstr,
        citedUrl: nstr,
        citedTitle: nstr
      })
    )
  })
)

const method = obj(
  {
    scopeLabel: str,
    sampleWarning: nstr,
    questions: ref('count'),
    marketIds: strings,
    trackedPages: int,
    windowFrom: ref('nullableInstant'),
    windowTo: ref('nullableInstant'),
    previousAt: ref('nullableInstant'),
    currentAt: ref('nullableInstant'),
    copy: obj({ cited: str, vary: str, partial: str, change: str }),
    agreement: nullable(
      obj({
        total: ref('count'),
        agree: ref('count'),
        percent: { type: 'integer', minimum: 0, maximum: 100 }
      })
    )
  },
  // Added within v2: optional, so files written before them still validate.
  ['scopeLabel', 'sampleWarning']
)

const tone = enumOf(['positive', 'neutral', 'negative'])

const reputation = obj({
  empty: ref('empty'),
  positive: ref('count'),
  neutral: ref('count'),
  negative: ref('count'),
  analysed: int,
  net: nnum,
  trend: arr(obj({ at: ref('instant'), positive: int, neutral: int, negative: int })),
  issues: arr(
    obj({ rowId: nstr, prompt: str, claim: str, whyWrong: str, correction: str, sourceToFix: nstr })
  ),
  answers: arr(obj({ rowId: nstr, prompt: str, tone, theme: str, rank: nstr, why: str }))
})

const trends = obj({
  empty: ref('empty'),
  series: arr(
    obj({
      at: ref('instant'),
      checked: int,
      aio: int,
      ownCited: int,
      pageCited: int,
      named: int,
      score: { type: ['integer', 'null'] },
      partial: bool
    })
  ),
  fixes: arr(obj({ number: int, at: ref('instant'), description: str, pageId: str })),
  previousAt: ref('nullableInstant'),
  currentAt: ref('nullableInstant'),
  gained: ref('deltaList'),
  lost: ref('deltaList'),
  newlyNamed: ref('deltaList'),
  noLongerNamed: ref('deltaList'),
  verdicts: arr(
    obj({
      number: int,
      pageId: str,
      description: str,
      goLiveAt: ref('instant'),
      verdict: enumOf(['worked', 'partly', 'no_change', 'pending']),
      label: str,
      prompts: ref('count')
    })
  )
})

const universe = obj({
  empty: ref('empty'),
  segments: int,
  largest: nullable(obj({ label: str, prompts: int })),
  best: nullable(obj({ label: str, rate: int })),
  weakest: nullable(obj({ label: str, rate: int })),
  dimensions: arr(ref('universeDimension'))
})

const sources = obj({
  empty: ref('empty'),
  note: str,
  total: int,
  yours: int,
  yoursPct: ref('pct'),
  competitor: int,
  external: int,
  gapsToWin: int,
  platforms: arr(
    obj({
      type: enumOf(CITATION_SOURCE_TYPE_VALUES),
      label: str,
      pages: int,
      citations: int,
      share: ref('pct'),
      prompts: ref('count')
    })
  ),
  youtube: obj({
    videos: arr(
      obj({
        videoId: str,
        url: str,
        title: nstr,
        channel: nstr,
        views: { type: ['integer', 'null'] },
        publishedAt: nstr,
        prompts: ref('count'),
        citations: int,
        gap: ref('count')
      })
    ),
    channels: arr(obj({ channel: str, videos: int, prompts: ref('count'), citations: int })),
    detailsMissing: bool
  }),
  reddit: obj({
    threads: arr(
      obj({
        url: str,
        title: nstr,
        subreddit: str,
        replyStatus: enumOf(['open', 'archived', 'locked', 'unchecked']),
        upvotes: { type: ['integer', 'null'] },
        comments: { type: ['integer', 'null'] },
        prompts: ref('count'),
        citations: int
      })
    ),
    subreddits: arr(obj({ name: str, threads: int, prompts: ref('count'), citations: int })),
    sentence: str
  }),
  linkedin: arr(
    obj({
      url: str,
      title: nstr,
      kind: enumOf(['post', 'article', 'other']),
      prompts: ref('count'),
      citations: int
    })
  ),
  influential: arr(
    obj({
      url: str,
      domain: str,
      who,
      title: nstr,
      prompts: ref('count'),
      citations: int,
      gap: ref('count')
    })
  )
})

const codes = enumOf(ANSWER_SHAPE_CODES)

const answerShape = obj({
  empty: ref('empty'),
  legend: arr(obj({ id: str, label: str, codes: arr(codes) })),
  labels: {
    type: 'object',
    additionalProperties: false,
    required: [...ANSWER_SHAPE_CODES],
    properties: Object.fromEntries(ANSWER_SHAPE_CODES.map((code) => [code, str]))
  },
  analysed: ref('count'),
  notAnalysed: ref('count'),
  blockTypes: int,
  repeatingShapes: int,
  mostCommon: nullable(ref('journey')),
  changed: ref('count'),
  frequency: arr(obj({ code: codes, label: str, answers: ref('count'), blocks: int })),
  journeys: arr(ref('journey')),
  changes: arr(obj({ rowId: str, prompt: str, before: str, after: str })),
  templateHash: nstr
})

const contentGaps = obj({
  empty: ref('empty'),
  pageRead: nullable(
    obj({
      url: str,
      title: nstr,
      metaDescription: nstr,
      h1: nstr,
      readAt: ref('nullableInstant'),
      lastModified: ref('nullableInstant'),
      titleLength: int,
      titleTruncated: bool,
      mismatches: strings
    })
  ),
  matrix: arr(
    obj({
      number: int,
      rowId: nstr,
      prompt: str,
      coverage: enumOf(COVERAGE_LEVEL_VALUES),
      whereCovered: strings,
      mainGap: str,
      actions: arr(enumOf(COVERAGE_ACTION_VALUES)),
      actionLabel: str
    })
  ),
  summary: str,
  oneByOne: arr(
    obj({
      number: int,
      prompt: str,
      now: str,
      update: str,
      newFaq: bool,
      faq: nullable(obj({ question: str, answer: str, words: int }))
    })
  ),
  pageWide: arr(obj({ kind: enumOf(COVERAGE_FINDING_VALUES), summary: str, detail: str }))
})

const ID = 'https://citefox.app/schema/'

function definitionsFile(file: string, title: string, definitions: Record<string, Schema>): Schema {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: `${ID}${file}`,
    title,
    definitions
  }
}

/** Every report schema file, keyed by file name. */
export function reportSchemas(): Record<string, Schema> {
  return {
    'citefox-report.v2.json': reportSchema(),
    [COMMON]: definitionsFile(COMMON, 'CiteFox report model v2: shared shapes', DEFINITIONS),
    [SECTIONS]: definitionsFile(SECTIONS, 'CiteFox report model v2: cover to trends', {
      cover,
      overview,
      pagesSection,
      competition,
      reputation,
      trends,
      verdict,
      whatChanged,
      method,
      recommendations
    }),
    [MORE]: definitionsFile(MORE, 'CiteFox report model v2: universe to content gaps', {
      universe,
      sources,
      answerShape,
      contentGaps
    }),
    [TOPICS_FILE]: definitionsFile(
      TOPICS_FILE,
      'CiteFox report model v2: topic coverage',
      topicDefinitions()
    )
  }
}

export function reportSchema(): Schema {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: `${ID}citefox-report.v2.json`,
    title: 'CiteFox report model, version 2',
    description:
      'The report every CiteFox output renders (Docs/REPORT-SPEC.md). Rows are one prompt in one market on one tracked page from the latest full check. Every count with a drill names a list in drills with exactly that many row ids. Competition holds sov and leaderboard (authority, overlap, gap, avgPosition); trends holds the deltas (gained, lost, newlyNamed, noLongerNamed).',
    ...obj(
      {
        version: { const: 2 },
        cover: sectionRef(SECTIONS, 'cover'),
        sections: arr(enumOf(REPORT_SECTION_VALUES)),
        markets: arr(ref('market')),
        pages: arr(ref('page')),
        rows: arr(ref('row')),
        drills: { type: 'object', additionalProperties: strings },
        overview: sectionRef(SECTIONS, 'overview'),
        pagesSection: sectionRef(SECTIONS, 'pagesSection'),
        competition: sectionRef(SECTIONS, 'competition'),
        reputation: sectionRef(SECTIONS, 'reputation'),
        trends: sectionRef(SECTIONS, 'trends'),
        universe: sectionRef(MORE, 'universe'),
        sources: sectionRef(MORE, 'sources'),
        answerShape: sectionRef(MORE, 'answerShape'),
        contentGaps: sectionRef(MORE, 'contentGaps'),
        prompts: obj({ empty: ref('empty'), all: ref('count') }),
        headline: str,
        recommendations: sectionRef(SECTIONS, 'recommendations'),
        verdict: sectionRef(SECTIONS, 'verdict'),
        whatChanged: sectionRef(SECTIONS, 'whatChanged'),
        method: sectionRef(SECTIONS, 'method'),
        references: arr(ref('reference')),
        topicCoverage: sectionRef(TOPICS_FILE, 'topicCoverage')
      },
      // Added within v2 (headline, recommendations): optional for files written before.
      ['topicCoverage', 'headline', 'recommendations']
    )
  }
}
