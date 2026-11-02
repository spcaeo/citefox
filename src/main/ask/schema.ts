import { MOVEMENT_VALUES, STAGE_VALUES, STATUS_VALUES } from './vocabulary'

const nullableList = (items: Record<string, unknown>): Record<string, unknown> => ({
  anyOf: [{ type: 'array', maxItems: 50, items }, { type: 'null' }]
})

const nullableText = (maxLength: number): Record<string, unknown> => ({
  anyOf: [{ type: 'string', maxLength }, { type: 'null' }]
})

/** The `filters` object Claude writes. Same fields as `AskFilters`; null means "any". */
export const ASK_FILTERS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'pageIds',
    'marketIds',
    'statuses',
    'movements',
    'intentStages',
    'citedDomain',
    'text'
  ],
  properties: {
    pageIds: nullableList({ type: 'string', maxLength: 80 }),
    marketIds: nullableList({ type: 'string', maxLength: 80 }),
    statuses: nullableList({ type: 'string', enum: STATUS_VALUES }),
    movements: nullableList({ type: 'string', enum: MOVEMENT_VALUES }),
    intentStages: nullableList({ type: 'string', enum: STAGE_VALUES }),
    citedDomain: nullableText(253),
    text: nullableText(200)
  }
}

/** Claude's whole reply to an Ask CiteFox question. */
export const ASK_REPLY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['filters', 'notCovered'],
  properties: {
    filters: ASK_FILTERS_SCHEMA,
    notCovered: nullableText(600)
  }
}
