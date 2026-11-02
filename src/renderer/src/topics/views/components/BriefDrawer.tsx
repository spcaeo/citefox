import { useMemo, useState, type JSX } from 'react'
import { copyText } from '../../../components/clipboard'
import { signalGuide } from '../../../guide/signals'
import { Drawer, DrawerSection, useResultWords } from '../../../ui'
import { searchesBrief, type Search } from '../model'

/**
 * Get fix brief (`drawer=topic-brief&tb.ids=…`): a plain-text brief for the picked
 * searches, built only from stored data, with one Copy button. No AI call, no search;
 * the writer pastes it wherever they work.
 */
export function BriefDrawer({
  searches,
  title,
  topicName,
  marketName,
  targetUrl,
  perSearchTarget = false,
  onClose
}: {
  searches: readonly Search[]
  title: string
  topicName: string
  marketName: string
  targetUrl: string | null
  /** Searches from several topics: each names its own page to improve. */
  perSearchTarget?: boolean
  onClose: () => void
}): JSX.Element {
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle')
  const words = useResultWords()
  const brief = useMemo(
    () =>
      searchesBrief({ title, topicName, marketName, targetUrl, searches, perSearchTarget, words }),
    [title, topicName, marketName, targetUrl, searches, perSearchTarget, words]
  )
  return (
    <Drawer
      id="topic-brief"
      title={`Fix brief for ${searches.length} ${searches.length === 1 ? 'search' : 'searches'}`}
      subtitle="Built from your saved checks. No AI call and no searches."
      onClose={onClose}
      testId="topic-brief"
      footer={{
        summary:
          copied === 'copied'
            ? 'Fix brief copied.'
            : copied === 'failed'
              ? 'Could not copy. Select the brief and copy it.'
              : 'Paste it into your editor or send it to your writer.',
        cancel: 'Close',
        primary: {
          label: copied === 'copied' ? 'Copied' : 'Copy fix brief',
          icon: 'copy',
          onClick: () => {
            void copyText(brief).then((ok) => {
              setCopied(ok ? 'copied' : 'failed')
              if (ok) signalGuide('fix-brief-copied')
            })
          }
        }
      }}
    >
      <DrawerSection title={title}>
        {searches.length === 0 ? (
          <p className="tv-muted">These searches are no longer in this topic.</p>
        ) : (
          <pre className="tv-brief mono" tabIndex={0}>
            {brief}
          </pre>
        )}
      </DrawerSection>
    </Drawer>
  )
}
