import { pluralize } from '@shared/pluralize'
import type { IconName } from '../components/Icon'
import { withDrawerOpened } from './drawerUrl'
import { withShellDialog } from './overlay'
import { sectionHash } from './routes'

export interface AddMenuEntry {
  id: 'questions' | 'import-questions' | 'page' | 'topic' | 'import'
  label: string
  hint: string
  href: string
  /** The same icon as the screen it adds to, so no two entries look alike. */
  icon: IconName
  /** Entries that bring in a file sit under one "Import" heading. */
  fromFile?: true
}

/**
 * The + Add menu's paths (AddFlow.dc.html): three things to add, then two
 * files to import, each starting with a different word. Questions, the
 * Excel or CSV file and Topic
 * open their drawers over the current route (`?drawer=add-questions`, with
 * `&tab=import` for a file; `?drawer=new-topic`, which links to the full wizard at
 * `#/add`); Page to track opens Add a page (`?drawer=add-page`); Sitemap (Import pages) is its
 * own route. `currentHash` is the route the drawer opens over.
 */
export function addMenuEntries(currentHash: string, foundPageCount: number): AddMenuEntry[] {
  return [
    {
      id: 'questions',
      label: 'Questions',
      hint: 'Type, paste or pick suggestions',
      href: withShellDialog(currentHash, 'add-questions'),
      icon: 'question'
    },
    {
      id: 'topic',
      label: 'Topic',
      hint: 'A buyer situation with its own questions',
      href: withShellDialog(currentHash, 'new-topic'),
      icon: 'layers'
    },
    {
      id: 'page',
      label: 'Page to track',
      hint:
        foundPageCount > 0
          ? `Pick from your ${pluralize(foundPageCount, 'page')} or paste a URL`
          : 'Paste the URL of a page',
      href: withDrawerOpened(currentHash, 'add-page'),
      icon: 'file'
    },
    {
      id: 'import-questions',
      label: 'Excel or CSV file',
      hint: '100 or more questions at once',
      href: withDrawerOpened(currentHash, 'add-questions', { tab: 'import' }),
      icon: 'table',
      fromFile: true
    },
    {
      id: 'import',
      label: 'Sitemap',
      hint: 'Pages from a sitemap or a CSV of URLs',
      href: sectionHash('import-pages'),
      icon: 'tree',
      fromFile: true
    }
  ]
}
