import type { HelpFillRow } from '@shared/ipc'
import type { ImportEntity } from '@shared/import-fields'
import type { HelpFillChatbotCopy, HelpFillDescribeCopy } from '../ui'

/**
 * "✦ Help me fill this" on the importer's Choose step (Docs/HELPFILL.md): for a
 * list that has a helper kind, the rows the helper reads go into this import's
 * preview as a paste, where every row is checked and added on the user's click.
 * Add an entity here to give its import the helper.
 */
export interface ImportHelp {
  /** The registered help-fill kind in main. */
  kind: string
  /** The white button on Choose and in empty states: "Help me find them". */
  label: string
  /** The Choose step card's line under it. */
  hint: string
  describe: HelpFillDescribeCopy
  chatbot: HelpFillChatbotCopy
  /** Reply columns, in the order the paste header names them (IMPORT_FIELDS ids). */
  columns: readonly string[]
}

export const IMPORT_HELP: Partial<Record<ImportEntity, ImportHelp>> = {
  competitors: {
    kind: 'competitors',
    label: 'Help me find them',
    hint: 'Describe who you lose deals to, or copy a prompt into your own ChatGPT or Perplexity.',
    describe: {
      label: 'Who do you lose deals to?',
      placeholder:
        'For example: cheaper SMS apps for small offices, and developer APIs our buyers try first.',
      chips: [
        {
          id: 'web',
          label: 'Search the web for them',
          text: 'Search independent comparison and review lists for the companies buyers shortlist.'
        },
        {
          id: 'cheaper',
          label: 'Cheaper options buyers try',
          text: 'Include the cheaper options buyers try before us.'
        }
      ],
      // The web search decides how many it finds (up to 20).
      defaultCount: 20,
      buttonLabel: () => 'Find competitors'
    },
    chatbot: {
      tip: 'Perplexity is best for competitors: it searches the web.',
      pastePlaceholder: (name) => `Paste the CSV or table ${name} gave you…`
    },
    columns: ['name', 'domain', 'competes_with']
  }
}

/** Rows as a tab-separated paste with a header, the way the importer reads a sheet. */
export function rowsAsPaste(columns: readonly string[], rows: readonly HelpFillRow[]): string {
  const cell = (value: string | undefined): string =>
    (value ?? '').replace(/[\t\r\n]+/gu, ' ').trim()
  return [
    columns.join('\t'),
    ...rows.map((row) => columns.map((column) => cell(row.values[column])).join('\t'))
  ].join('\n')
}
