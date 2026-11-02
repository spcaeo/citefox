import type { JSX } from 'react'
import type { ApiKeyMetadata } from '@shared/domain'
import { KeyEditor } from '../../keys/KeyEditor'
import type { OnboardingClient } from '../../onboarding/client'
import { Panel, SectionHead } from '../../ui'

/** FR-11.9. One optional, read-only YouTube Data API key. */
export function YouTubeSection({
  client,
  saved,
  onChanged
}: {
  client: OnboardingClient
  saved: ApiKeyMetadata | null
  onChanged: () => Promise<void>
}): JSX.Element {
  return (
    <section className="conn-section" aria-labelledby="yt-h">
      <SectionHead
        id="yt-h"
        title="YouTube Data API (optional)"
        description="Adds view counts and publish dates to cited videos, and recognises your own channel's videos. Read-only."
      />
      <Panel className="conn-narrow">
        <KeyEditor
          client={client}
          provider="youtube"
          saved={saved}
          addLabel="Add API key"
          onChanged={onChanged}
        />
        <div className="field">
          <label className="field-label" htmlFor="yt-channel">
            Your channel
          </label>
          <input
            id="yt-channel"
            className="ob-input"
            type="text"
            placeholder="youtube.com/@yourchannel"
            disabled
            aria-describedby="yt-channel-hint"
          />
          <p className="hint" id="yt-channel-hint">
            Without a key, CiteFox still lists the videos AI Overviews cite, just without views. The
            channel address is not saved in this version.
          </p>
        </div>
      </Panel>
    </section>
  )
}
