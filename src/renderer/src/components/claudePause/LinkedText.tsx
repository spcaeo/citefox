import type { JSX } from 'react'
import { screenHash, SCREEN_NAMES, type ScreenName } from './screenLinks'

/** A message whose screen names ("Connections and keys") are links that open that screen. */
export function LinkedText({ text }: { text: string }): JSX.Element {
  const parts = text.split(SCREEN_NAMES)
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <a key={index} className="screen-link" href={screenHash(part as ScreenName)}>
            {part}
          </a>
        ) : (
          part
        )
      )}
    </>
  )
}
