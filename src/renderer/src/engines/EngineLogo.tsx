import type { JSX } from 'react'
import { ENGINE_LABEL, type EngineId } from '@shared/domain'
import chatgpt from '../assets/engines/chatgpt.png'
import copilot from '../assets/engines/copilot.svg'
import gemini from '../assets/engines/gemini.png'
import googleAiMode from '../assets/engines/google_ai_mode.png'
import googleAio from '../assets/engines/google_aio.png'
import perplexity from '../assets/engines/perplexity.png'
import './engines.css'

/** Each engine's own mark, the same files the web app shows beside engine names. */
const ENGINE_LOGOS: Readonly<Record<EngineId, string>> = {
  google_aio: googleAio,
  google_ai_mode: googleAiMode,
  chatgpt,
  perplexity,
  gemini,
  copilot
}

/** An engine's logo, decorative beside its name. */
export function EngineLogo({
  engine,
  size = 20,
  className
}: {
  engine: EngineId
  size?: number
  className?: string
}): JSX.Element {
  return (
    <img
      className={className}
      src={ENGINE_LOGOS[engine]}
      alt=""
      width={size}
      height={size}
      aria-hidden="true"
    />
  )
}

/**
 * A row of engine logos, one per engine in display order: one image whose name lists
 * every engine, so a narrow column never cuts a name off (audit #4). An empty or missing
 * list is Google AI Overview (checks from before engines).
 */
export function EngineLogos({
  engines,
  size = 16
}: {
  engines: readonly EngineId[] | null | undefined
  size?: number
}): JSX.Element {
  const list = engines && engines.length > 0 ? engines : (['google_aio'] as const)
  const names = list.map((engine) => ENGINE_LABEL[engine]).join(', ')
  return (
    <span className="eng-logos" role="img" aria-label={names} title={names}>
      {list.map((engine) => (
        <EngineLogo key={engine} engine={engine} size={size} className="eng-filter-logo" />
      ))}
    </span>
  )
}
