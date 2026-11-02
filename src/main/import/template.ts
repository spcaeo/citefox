import { IMPORT_FIELDS, type ImportEntity } from '@shared/import-fields'
import { encodeCsv } from '../export/csv'
import { writeXlsx } from './xlsx'

/**
 * "Download a template": the entity's columns as headers and two example rows, as a
 * CSV (UTF-8 with BOM, so Excel reads accents) or an Excel file. A file filled from
 * the template imports with every column matched.
 */

export function templateRows(entity: ImportEntity): { header: string[]; rows: string[][] } {
  const fields = IMPORT_FIELDS[entity]
  return {
    header: fields.map((field) => field.label),
    rows: [0, 1].map((at) => fields.map((field) => field.examples[at] ?? ''))
  }
}

export function templateFileName(entity: ImportEntity, format: 'csv' | 'xlsx'): string {
  return `citefox-${entity}-template.${format}`
}

export async function templateBytes(entity: ImportEntity, format: 'csv' | 'xlsx'): Promise<Buffer> {
  const { header, rows } = templateRows(entity)
  if (format === 'xlsx') {
    const sheet = entity.charAt(0).toUpperCase() + entity.slice(1)
    return writeXlsx(sheet, header, rows)
  }
  return Buffer.from(encodeCsv([header, ...rows], ',', true), 'utf8')
}
