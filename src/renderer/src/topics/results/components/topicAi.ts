import { openAsk } from '../../../assistant/openAsk'
import type { AiAction } from '../../../ui'
import type { TopicCall } from '../hooks/useTopicCall'
import type { TopicResults } from '../types'
import { needsWork, type Search } from '../../views/model'

/**
 * The lines every tab's one AI menu ends with: Claude's topic summary (one
 * suggestion card) and Ask CiteFox about this topic (the drawer over the
 * tab, which reads the topic's ids from the screen). Neither runs a search.
 */
export function topicAiActions(results: TopicResults, call: TopicCall): AiAction[] {
  const { topic } = results
  return [
    {
      id: 'summary',
      label: 'Summarise this topic',
      icon: 'sparkle',
      seconds: call.seconds.summary,
      onSelect: () => call.start({ kind: 'summary', title: 'Topic summary' })
    },
    {
      id: 'ask',
      label: 'Ask about this topic',
      onSelect: () => openAsk({ about: { kind: 'topic', id: topic.id, label: topic.name } })
    }
  ]
}

/**
 * The topic views' one AI menu: why the search with the best win odds is not cited, its
 * fix draft, then the lines every menu ends with. Each is one Claude call and no search.
 */
export function topicViewsAiActions(
  results: TopicResults,
  call: TopicCall,
  searches: readonly Search[]
): AiAction[] {
  const likeliest = searches
    .filter((search) => needsWork(search.result) && search.winOdds !== null)
    .sort((a, b) => (b.winOdds ?? 0) - (a.winOdds ?? 0))[0]
  return [
    {
      id: 'why',
      label: likeliest ? `Why isn't ${likeliest.ref} cited?` : "Why aren't we cited?",
      icon: 'bulb',
      seconds: call.seconds.whyNotCited,
      disabled: !likeliest,
      onSelect: () => {
        if (likeliest) {
          call.start({
            kind: 'whyNotCited',
            title: `Why ${likeliest.ref} isn't cited`,
            promptId: likeliest.id
          })
        }
      }
    },
    {
      id: 'fix',
      label: likeliest ? `Draft the fix for ${likeliest.ref}` : 'Draft the fix',
      icon: 'wand',
      seconds: call.seconds.draftFix,
      disabled: !likeliest,
      onSelect: () => {
        if (likeliest) {
          call.start({
            kind: 'draftFix',
            title: `Fix for ${likeliest.ref}`,
            promptId: likeliest.id
          })
        }
      }
    },
    ...topicAiActions(results, call)
  ]
}
