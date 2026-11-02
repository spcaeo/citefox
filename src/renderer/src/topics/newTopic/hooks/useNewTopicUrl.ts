import { useCallback, useEffect, useState } from 'react'
import { navigateHash, replaceHash } from '../../../shell/routes'
import { parseNewTopicUrl, withNewTopicUrl, type NewTopicUrl } from '../utils/url'

export type NewTopicUrlPatch = Parameters<typeof withNewTopicUrl>[1]

function currentHash(): string {
  return typeof window === 'undefined' ? '' : window.location.hash
}

function same(left: NewTopicUrl, right: NewTopicUrl): boolean {
  return (
    left.draftId === right.draftId &&
    left.step === right.step &&
    left.way === right.way &&
    left.topicId === right.topicId &&
    left.help === right.help &&
    left.bot === right.bot &&
    left.questions.join(',') === right.questions.join(',')
  )
}

/**
 * The dialog's values in the hash, kept in step with Back and Forward. `set` writes a
 * new history entry; `replace: true` rewrites the current one (a draft just made).
 */
export function useNewTopicUrl(): [
  NewTopicUrl,
  (patch: NewTopicUrlPatch, options?: { replace?: boolean }) => void
] {
  const [url, setUrl] = useState<NewTopicUrl>(() => parseNewTopicUrl(currentHash()))

  useEffect(() => {
    function onHash(): void {
      const next = parseNewTopicUrl(currentHash())
      setUrl((current) => (same(current, next) ? current : next))
    }
    onHash()
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const set = useCallback((patch: NewTopicUrlPatch, options: { replace?: boolean } = {}) => {
    const next = withNewTopicUrl(currentHash(), patch)
    if (next !== currentHash()) {
      if (options.replace) replaceHash(next)
      else navigateHash(next)
    }
    setUrl(parseNewTopicUrl(next))
  }, [])

  return [url, set]
}

/** The hash with every New topic value removed, for closing the dialog. */
export function clearedNewTopicHash(hash: string): string {
  return withNewTopicUrl(hash, {
    draftId: null,
    step: 'start',
    way: null,
    questions: [],
    topicId: null,
    help: null,
    bot: null
  })
}
