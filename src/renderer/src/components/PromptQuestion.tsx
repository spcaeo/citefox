import type { JSX } from 'react'
import { Markdown } from './Markdown'
import { extraLabel, plain } from './promptText'

/**
 * A prompt as the buyer asks it: the full question first, and the short internal label
 * ("Crew alerts") after it in small faint text when it says something the question does
 * not. Lists, drills, the Markets matrix and Progress use this, so no screen shows only
 * the label where the question belongs.
 */
export function PromptQuestion({
  text,
  label,
  baseLevel = 3
}: {
  text: string
  label: string
  baseLevel?: number
}): JSX.Element {
  const full = plain(text).length > 0 ? text : label
  const extra = extraLabel({ text, label })
  return (
    <>
      <Markdown inline baseLevel={baseLevel}>
        {full}
      </Markdown>
      {extra ? <span className="faint"> · {extra}</span> : null}
    </>
  )
}
