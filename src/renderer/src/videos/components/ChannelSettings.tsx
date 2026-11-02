import { useEffect, useState, type JSX } from 'react'
import type { VideosSource } from '../source'
import { IDLE, type ActionState } from '../types'
import { Button, Panel, ToolButton } from '../../ui'
import { plainError } from '../utils/model'

/**
 * FR-11.9 and FR-18.10. The project's own channel (read-only recognition) and
 * the optional YouTube Data API details. Without a key, cited videos are still listed.
 */
export function ChannelSettings({
  source,
  projectId,
  youtubeKey,
  onChanged
}: {
  source: VideosSource
  projectId: string
  youtubeKey: boolean
  onChanged: () => void
}): JSX.Element {
  const [channel, setChannel] = useState('')
  const [save, setSave] = useState<ActionState>(IDLE)
  const [refresh, setRefresh] = useState<ActionState & { missingKey?: boolean }>(IDLE)

  useEffect(() => {
    let cancelled = false
    void source['communities:getSettings']({ projectId }).then(
      (settings) => {
        if (!cancelled) setChannel(settings.youtubeChannel ?? '')
      },
      () => undefined
    )
    return () => {
      cancelled = true
    }
  }, [source, projectId])

  async function saveChannel(): Promise<void> {
    setSave({ busy: true, message: null, error: false })
    try {
      const saved = await source['communities:setSettings']({
        projectId,
        youtubeChannel: channel.trim().length === 0 ? null : channel.trim()
      })
      setChannel(saved.youtubeChannel ?? '')
      setSave({ busy: false, message: 'Saved.', error: false })
      onChanged()
    } catch (cause) {
      setSave({ busy: false, message: plainError(cause, 'Could not save.'), error: true })
    }
  }

  async function getDetails(): Promise<void> {
    setRefresh({ busy: true, message: null, error: false })
    try {
      const result = await source['communities:refreshVideos']({ projectId })
      setRefresh({
        busy: false,
        error: result.message !== null && !result.missingKey,
        missingKey: result.missingKey,
        message:
          result.message ??
          `Updated ${result.fetched} ${result.fetched === 1 ? 'video' : 'videos'}.`
      })
      onChanged()
    } catch (cause) {
      setRefresh({ busy: false, message: plainError(cause, 'Could not refresh.'), error: true })
    }
  }

  return (
    <Panel title="Your channel" className="yt-channel">
      <p className="yt-muted yt-small">
        Optional. CiteFox recognises videos on this channel as yours (read-only). Without it, paste
        each video&apos;s URL under Publish and track.
      </p>
      <form
        className="yt-row yt-row-end"
        onSubmit={(event) => {
          event.preventDefault()
          void saveChannel()
        }}
      >
        <label className="yt-field">
          <span>Your YouTube channel (@handle or channel id)</span>
          <input
            className="ui-input"
            value={channel}
            placeholder="@yourbrand"
            onChange={(event) => setChannel(event.target.value)}
          />
        </label>
        <Button type="submit" disabled={save.busy}>
          Save channel
        </Button>
        <span className={save.error ? 'yt-error yt-small' : 'yt-muted yt-small'} role="status">
          {save.message ?? ''}
        </span>
      </form>
      <div className="yt-row">
        <ToolButton
          kind="refresh"
          label="Get views and dates"
          busy={refresh.busy}
          onClick={() => void getDetails()}
        />
        <span className={refresh.error ? 'yt-error yt-small' : 'yt-muted yt-small'} role="status">
          {refresh.message ??
            (youtubeKey ? 'Uses your YouTube Data API key.' : 'Needs a YouTube Data API key.')}
          {refresh.missingKey || (!youtubeKey && refresh.message === null) ? (
            <>
              {' '}
              <a href="#/connections">Open Connections</a>
            </>
          ) : null}
        </span>
      </div>
    </Panel>
  )
}
