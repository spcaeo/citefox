import { useState } from 'react'
import type { InternalLinkSuggestion } from '@shared/ipc'
import type { StructureClient } from '../client'

type LinkClient = Pick<StructureClient, 'structure:suggestLinks'>

export interface LinkSuggestionsState {
  links: readonly InternalLinkSuggestion[] | null
  status: 'idle' | 'loading' | 'error'
  load: () => void
  close: () => void
}

/** FR-19.8 "Suggest internal links" for one cluster: from, to, anchor text and where. */
export function useLinkSuggestions(
  client: LinkClient,
  projectId: string,
  clusterId: string
): LinkSuggestionsState {
  const [links, setLinks] = useState<readonly InternalLinkSuggestion[] | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  return {
    links,
    status,
    load: () => {
      setStatus('loading')
      client['structure:suggestLinks']({ projectId, clusterId }).then(
        (result) => {
          setLinks(result.links)
          setStatus('idle')
        },
        () => setStatus('error')
      )
    },
    close: () => {
      setLinks(null)
      setStatus('idle')
    }
  }
}
