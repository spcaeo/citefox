import { MATCH_STATES, TOPIC_PROMPT_KINDS, TOPIC_STAGES } from '@shared/domain'

/**
 * JSON Schema for `report.topicCoverage` (Docs/TOPICS-SPEC.md section 5), written to
 * `citefox-report-topics.v2.json`. The property is optional: page exports leave it out.
 */

type Schema = Record<string, unknown>

export const TOPICS_FILE = 'citefox-report-topics.v2.json'

const COMMON = 'citefox-report-common.v2.json'
const count: Schema = { $ref: `${COMMON}#/definitions/count` }
const str: Schema = { type: 'string' }
const nstr: Schema = { type: ['string', 'null'] }
const int: Schema = { type: 'integer', minimum: 0 }
const pctSchema: Schema = { type: ['integer', 'null'], minimum: 0, maximum: 100 }
const bool: Schema = { type: 'boolean' }
const arr = (items: Schema): Schema => ({ type: 'array', items })

function obj(properties: Record<string, Schema>): Schema {
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties
  }
}

const goal = obj({
  kind: { enum: [...TOPIC_PROMPT_KINDS] },
  label: str,
  prompts: int,
  withAio: count,
  cited: count,
  rightPage: count,
  otherPage: count,
  named: count,
  noAio: count,
  failed: count,
  notChecked: int,
  rate: pctSchema,
  bandLo: int,
  bandHi: int,
  bandState: { enum: ['below', 'in', 'above', null] },
  toReachBand: int
})

const stage = obj({
  stage: { enum: [...TOPIC_STAGES] },
  label: str,
  questions: int,
  aio: count,
  cited: count,
  rate: pctSchema
})

const todoRow = obj({
  number: int,
  kind: { enum: [...TOPIC_PROMPT_KINDS] },
  text: str,
  stage: nstr,
  targetUrl: nstr,
  targetPath: nstr,
  citedInstead: arr(str),
  winOdds: { type: ['integer', 'null'], minimum: 0, maximum: 100 },
  winLevel: nstr,
  rowId: nstr
})

const todoGroup = obj({
  state: { enum: [...MATCH_STATES] },
  label: str,
  hint: str,
  count,
  rows: arr({ $ref: '#/definitions/topicTodoRow' })
})

const keywordRow = obj({
  key: str,
  label: str,
  groupKind: nstr,
  keywords: count,
  aio: count,
  cited: count,
  named: count,
  rate: pctSchema
})

const keywordRows = arr({ $ref: '#/definitions/topicKeywordRow' })

const topic = obj({
  topicId: str,
  name: str,
  sourceLine: str,
  marketId: str,
  marketLabel: str,
  checkedAt: nstr,
  executive: str,
  executiveSaved: bool,
  executiveAt: nstr,
  nextActions: arr(obj({ text: str, verify: nstr })),
  goals: arr({ $ref: '#/definitions/topicGoal' }),
  stages: arr({ $ref: '#/definitions/topicStage' }),
  todo: arr({ $ref: '#/definitions/topicTodoGroup' }),
  keywords: obj({
    byGroup: keywordRows,
    byIntent: keywordRows,
    byFunnel: keywordRows,
    byPageType: keywordRows
  })
})

const topicCoverage = obj({
  empty: { anyOf: [obj({ title: str, message: str, nextStep: nstr }), { type: 'null' }] },
  topics: arr({ $ref: '#/definitions/topic' })
})

/** The definitions file content (`$id` and title are added by the caller). */
export function topicDefinitions(): Record<string, Schema> {
  return {
    topicCoverage,
    topic,
    topicGoal: goal,
    topicStage: stage,
    topicTodoGroup: todoGroup,
    topicTodoRow: todoRow,
    topicKeywordRow: keywordRow
  }
}
