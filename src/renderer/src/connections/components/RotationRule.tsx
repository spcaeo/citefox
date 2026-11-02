import { useState, type JSX } from 'react'
import type { SerpApiRotationMode } from '@shared/domain'
import type { OnboardingClient } from '../../onboarding/client'
import { plainError, ROTATION_OPTIONS } from '../utils/model'

/** FR-11.2. How CiteFox uses the SerpApi keys, saved in Settings at once. */
export function RotationRule({
  client,
  value,
  onChanged
}: {
  client: OnboardingClient
  value: SerpApiRotationMode
  onChanged: () => Promise<void>
}): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null)

  async function pick(next: SerpApiRotationMode): Promise<void> {
    setBusy(true)
    try {
      await client.updateSettings({ serpapiRotation: next })
      const label = ROTATION_OPTIONS.find((option) => option.value === next)?.label ?? next
      setStatus({ text: `Saved. ${label.split(':')[0]} from the next search.`, error: false })
      await onChanged()
    } catch (cause) {
      setStatus({ text: plainError(cause), error: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="field">
      <label className="field-label" htmlFor="serp-rule">
        How CiteFox uses these keys
      </label>
      <select
        id="serp-rule"
        className="select"
        value={value}
        disabled={busy}
        onChange={(event) => void pick(event.target.value as SerpApiRotationMode)}
      >
        {ROTATION_OPTIONS.map((mode) => (
          <option key={mode.value} value={mode.value}>
            {mode.label}
          </option>
        ))}
      </select>
      {status ? (
        <p
          className={status.error ? 'field-error' : 'hint'}
          role={status.error ? 'alert' : 'status'}
        >
          {status.text}
        </p>
      ) : null}
    </div>
  )
}
