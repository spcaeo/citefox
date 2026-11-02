import type {
  ClusterMaker,
  ClusterMethod,
  ClusterRole,
  SitemapChangedPageRule,
  SitemapNewPageRule,
  SitemapRemovedPageRule,
  SitemapSyncFrequency
} from '@shared/domain'
import type { StructureViewId } from './types'

export const SUBTITLE =
  'Your sitemaps keep the page list current. Clusters, silos and groups let you track and compare pages together.'

export const FREQUENCY_OPTIONS: readonly { id: SitemapSyncFrequency; label: string }[] = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'manual', label: 'Only on Sync now' }
]

export const NEW_RULE_OPTIONS: readonly { id: SitemapNewPageRule; label: string; hint: string }[] =
  [
    {
      id: 'add_untracked',
      label: 'Add as not tracked',
      hint: 'New pages show up in All pages, marked "New". Nothing is searched until you track them.'
    },
    {
      id: 'track_default',
      label: 'Track automatically with default markets',
      hint: "Uses the silo's default markets, or the project default market. Each new page adds searches to every check."
    },
    {
      id: 'ask',
      label: 'Ask me',
      hint: 'CiteFox lists new pages in the sync report and waits for you.'
    }
  ]

export const REMOVED_RULE_OPTIONS: readonly {
  id: SitemapRemovedPageRule
  label: string
  hint: string
}[] = [
  {
    id: 'pause',
    label: 'Pause tracking and keep history',
    hint: 'Results and notes stay. The page stops using searches.'
  },
  {
    id: 'delete',
    label: 'Delete',
    hint: 'The page leaves your list. Its past checks are not shown any more.'
  }
]

export const CHANGED_RULE_OPTIONS: readonly { id: SitemapChangedPageRule; label: string }[] = [
  { id: 'reread_gaps', label: 'Re-read page and rerun gap analysis' },
  { id: 'reread', label: 'Re-read page only' },
  { id: 'nothing', label: 'Do nothing' }
]

export const CHANGED_NOTE = 'Only tracked pages are re-read. Untracked pages just get the new date.'

export const VIEW_HINTS: Readonly<Record<StructureViewId, string>> = {
  clusters: 'Clusters: topic groups found by meaning, across folders.',
  silos: 'Silos: built from your URL folders, like /blog/, /features/ and /use-cases/.',
  groups: 'Groups: lists you make by hand, for reports or a round of updates.'
}

export const METHOD_OPTIONS: readonly { id: ClusterMethod; label: string; hint: string }[] = [
  {
    id: 'topic',
    label: 'Topic and buyer intent',
    hint: 'Groups pages that answer the same kind of buyer question.'
  },
  {
    id: 'queries',
    label: 'Shared target queries',
    hint: 'Groups pages whose buyer questions overlap. Needs pages with saved questions.'
  },
  {
    id: 'links',
    label: 'Internal links',
    hint: 'Groups pages that link to each other.'
  }
]

export const METHOD_UNAVAILABLE: Readonly<Record<ClusterMethod, string>> = {
  topic: 'Not available for this project yet.',
  queries: 'Save buyer questions on a few pages first.',
  links: 'CiteFox has no internal-link data for this site yet.'
}

export const MAKER_LABELS: Readonly<Record<ClusterMaker, string>> = {
  rules: 'Made by CiteFox',
  claude: 'Made by CiteFox AI',
  user: 'Made by you'
}

export const ROLE_LABELS: Readonly<Record<ClusterRole, string>> = {
  pillar: 'Pillar',
  supporting: 'Supporting',
  orphan: 'Orphan'
}

export const ROLE_LEGEND =
  "Pillar: the page the cluster's other pages should link to. Supporting: covers one part of the topic. Orphan: no other page in the cluster links to it."

export const GROUPS_NOTE =
  'Groups are lists you make. CiteFox AI never changes them, and a page can be in any number of groups.'

export const RECLUSTER_APPLIED = 'Applied. The previous clusters are saved, so you can go back.'

export const INSIGHT_CHOICE = "Noted. Add it as a fix on the page's Content gaps tab."

/** Rows per page in the screen's long grids. */
export const PAGE_ROWS = 25

/**
 * Body height that fits a full page of rows plus up to three group headers, so
 * a long list pages instead of scrolling inside its card.
 */
export const FULL_PAGE_BODY = (PAGE_ROWS + 3) * 44

/** What "Track" from this screen uses (FR-20.6 recommendations for many pages). */
export const QUICK_TRACK = {
  intervalDays: 30,
  samples: 1,
  promptCount: 5,
  stagger: true
} as const
