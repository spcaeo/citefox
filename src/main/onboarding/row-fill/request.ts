import { ROW_FILL_LISTS, type RowFillList, type RowFillRequest } from '@shared/ipc'
import { IpcRequestError } from '../../ipc-request'
import { parseContext, parseRows, record, text } from '../sections/parse'

/** Checks `onboarding:rowFill` from the renderer: exact keys, the list value, length caps. */

const MAX_NAME = 500
/** A few rows are enough for style; more is junk. */
const MAX_EXAMPLES = 12

export function isRowFillList(value: unknown): value is RowFillList {
  return typeof value === 'string' && (ROW_FILL_LISTS as readonly string[]).includes(value)
}

export function parseRowFill(value: unknown): RowFillRequest {
  const channel = 'onboarding:rowFill'
  const r = record(value, channel, ['list', 'context', 'name', 'examples'])
  if (!isRowFillList(r.list)) throw new IpcRequestError(channel, 'That list is not known.')
  const name = text(r.name, channel, MAX_NAME).replace(/\s+/gu, ' ').trim()
  if (name.length === 0) throw new IpcRequestError(channel, 'Type a name first.')
  const examples = parseRows(r.examples, channel)
  if (examples.length > MAX_EXAMPLES) throw new IpcRequestError(channel)
  return { list: r.list, context: parseContext(r.context, channel), name, examples }
}
