import type { PageFix } from '@shared/page-fixes'
import {
  pageEditFileName,
  pageEditHtml,
  pageEditMarkdown,
  pageEditMdFileName
} from '@shared/page-edit-html'
import { errorText } from '../../../components/errorText'
import { showUndo } from '../../../ui'
import { formatMoment } from '../../../utils/dates'
import type { ProjectFixesSource } from '../../source'
import { editSearches, usePageEdit, type PageEditTarget } from './usePageEdit'

type PanelSource = Pick<
  ProjectFixesSource,
  'fixes:draftPageEdit' | 'fixes:pageEdit' | 'fixes:savePageEditHtml'
>

/** The tab's state and actions, shared by the page (main column) and the Review card (rail). */
export interface PageEditPanel {
  page: ReturnType<typeof usePageEdit>
  download: (format: 'html' | 'md') => void
}

/**
 * A page fix's Page edits: the page itself with what to cut struck out and what
 * to add in yellow, saved per fix. Download saves it as HTML or Markdown for a writer.
 */
export function usePageEditPanel(
  source: PanelSource,
  projectId: string,
  fix: PageFix,
  /** The page to mark up when it is not the fix's own page (owner fixes). */
  target: PageEditTarget | null = null
): PageEditPanel {
  const page = usePageEdit(source, projectId, fix, target)
  const { state } = page

  function download(format: 'html' | 'md'): void {
    if (state.phase !== 'done') return
    const build = format === 'md' ? pageEditMarkdown : pageEditHtml
    const html = build(state.edit, page.edits, editSearches(fix), (iso) => formatMoment(iso))
    const fileName = (format === 'md' ? pageEditMdFileName : pageEditFileName)(state.edit.url)
    source['fixes:savePageEditHtml']({ projectId, fileName, html, format }).then(
      (result) => {
        if (result.saved)
          showUndo({ message: `Saved ${fileName}.`, effect: 'Send it to your writer.' })
      },
      (cause: unknown) => showUndo({ message: errorText(cause, 'Could not save the file.') })
    )
  }

  return { page, download }
}
