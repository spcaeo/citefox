import type { JSX } from 'react'
import type { AssistResult } from '@shared/ipc'

/** The answer as read-only text: the summary, then one line per page and market. */
export function ChangedBody({ result }: { result: AssistResult }): JSX.Element {
  return (
    <div className="hp-changed" data-testid="what-changed">
      {result.summary ? <p>{result.summary}</p> : null}
      {result.items.length > 0 ? (
        <ul className="hp-changed-list">
          {result.items.map((item) => (
            <li key={item.id}>
              {item.tag ? <span className="hp-changed-tag">{item.tag}</span> : null}
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
