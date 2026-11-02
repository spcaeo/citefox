import { useState, type JSX } from 'react'
import {
  setCelebrate,
  setCelebrateSound,
  useCelebrate,
  useCelebrateSound
} from '../../celebrate/setting'
import { previewCelebration, type PreviewSample } from '../../celebrate/preview'
import { signalGuide } from '../../guide/signals'
import type { OnboardingClient } from '../../onboarding/client'
import { Button, Panel } from '../../ui'

/**
 * Settings › General: the celebration when a check first finds your site
 * cited, and its sound. A choice is saved straight away; there is no Save.
 * The theme lives in the top bar (`ThemeMenu`).
 */
export function CelebrationsCard({
  client,
  previewSample = { brand: null, site: null }
}: {
  client: Pick<OnboardingClient, 'updateSettings'>
  /** The open project's brand and site for the Preview's sample card. */
  previewSample?: PreviewSample
}): JSX.Element {
  const celebrate = useCelebrate()
  const sound = useCelebrateSound()
  const [error, setError] = useState<string | null>(null)

  async function toggle(
    key: 'celebrate' | 'celebrateSound',
    set: (value: boolean) => void,
    next: boolean
  ): Promise<void> {
    set(next)
    setError(null)
    try {
      await client.updateSettings({ [key]: next })
    } catch {
      set(!next)
      setError('CiteFox could not save that choice. Try again.')
    }
  }

  return (
    <Panel
      title="Celebrations"
      actions={
        <Button
          size="sm"
          data-guide="celebrations-preview"
          onClick={() => {
            previewCelebration(previewSample)
            signalGuide('celebration-previewed')
          }}
        >
          Preview
        </Button>
      }
    >
      <label className="radio" htmlFor="stg-celebrate">
        <input
          id="stg-celebrate"
          type="checkbox"
          checked={celebrate}
          aria-describedby="stg-celebrate-h"
          onChange={(event) => void toggle('celebrate', setCelebrate, event.target.checked)}
        />
        <span className="stack-tight">
          <span className="field-label">Celebrate citations</span>
          <span className="hint" id="stg-celebrate-h">
            A short moment with confetti the first time a check finds your site cited.
          </span>
        </span>
      </label>
      <label className="radio" htmlFor="stg-celebrate-sound">
        <input
          id="stg-celebrate-sound"
          type="checkbox"
          checked={sound}
          disabled={!celebrate}
          onChange={(event) =>
            void toggle('celebrateSound', setCelebrateSound, event.target.checked)
          }
        />
        <span className="field-label">Play a sound</span>
      </label>
      <p role="status" aria-live="polite" className="data-note data-note-error">
        {error ?? ''}
      </p>
    </Panel>
  )
}
