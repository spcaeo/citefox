import { useState } from 'react'
import type { CommunitiesSource } from '../source'
import { errorText } from '../utils/errors'
import { threadResultText } from '../utils/messages'

export interface SourceActions {
  threadsBusy: boolean
  threadsMessage: string | null
  videosBusy: boolean
  videosMessage: string | null
  checkThreads: () => Promise<void>
  refreshVideos: () => Promise<void>
}

/** "Check threads" (public Reddit data) and "Get views and dates" (YouTube key), on demand. */
export function useSourceActions(
  source: CommunitiesSource,
  projectId: string,
  onChanged: () => void
): SourceActions {
  const [threadsBusy, setThreadsBusy] = useState(false)
  const [threadsMessage, setThreadsMessage] = useState<string | null>(null)
  const [videosBusy, setVideosBusy] = useState(false)
  const [videosMessage, setVideosMessage] = useState<string | null>(null)

  async function checkThreads(): Promise<void> {
    setThreadsBusy(true)
    setThreadsMessage('Checking threads…')
    try {
      const result = await source['communities:checkThreads']({
        projectId,
        urls: null,
        force: false
      })
      setThreadsMessage(threadResultText(result))
      onChanged()
    } catch (cause) {
      setThreadsMessage(errorText(cause, 'Could not check the threads.'))
    } finally {
      setThreadsBusy(false)
    }
  }

  async function refreshVideos(): Promise<void> {
    setVideosBusy(true)
    setVideosMessage('Getting views and dates…')
    try {
      const result = await source['communities:refreshVideos']({ projectId })
      setVideosMessage(
        result.message ??
          (result.fetched === 1
            ? 'Updated 1 video.'
            : `Updated ${result.fetched.toLocaleString('en-US')} videos.`)
      )
      if (!result.missingKey) onChanged()
    } catch (cause) {
      setVideosMessage(errorText(cause, 'Could not get the video details.'))
    } finally {
      setVideosBusy(false)
    }
  }

  return { threadsBusy, threadsMessage, videosBusy, videosMessage, checkThreads, refreshVideos }
}
