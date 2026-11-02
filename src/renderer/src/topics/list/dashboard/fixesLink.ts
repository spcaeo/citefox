import { fixesTodoHash } from '../../../fixes/views'
import type { DashTopic } from '../../views/model'

const n = (value: number): string => value.toLocaleString('en-US')

/**
 * Where "As N page fixes in Fixes" goes, and the words, so the count matches the screen
 * it opens. One topic: Fixes cut to it (`?topic=`). Several: Fixes has no "topics only"
 * cut, so the line names both counts ("14 of the 15 page fixes in Fixes").
 */
export function fixesLink(
  topics: readonly Pick<DashTopic, 'id'>[],
  topicFixes: number,
  allFixes: number | null
): { href: string; text: string } {
  const noun = (count: number): string => (count === 1 ? 'page fix' : 'page fixes')
  const only = topics.length === 1 ? topics[0] : undefined
  if (only !== undefined) {
    return {
      href: fixesTodoHash({ topic: only.id }),
      text: `As ${n(topicFixes)} ${noun(topicFixes)} in Fixes`
    }
  }
  if (allFixes !== null && allFixes > topicFixes) {
    return {
      href: fixesTodoHash(),
      text: `As ${n(topicFixes)} of the ${n(allFixes)} ${noun(allFixes)} in Fixes`
    }
  }
  return { href: fixesTodoHash(), text: `As ${n(topicFixes)} ${noun(topicFixes)} in Fixes` }
}
