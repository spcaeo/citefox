import { useId, type JSX } from 'react'
import { NEW_TOPIC_WAYS, type NewTopicWay } from '../types'
import { WAY_COPY } from '../utils/plan'

/** The four ways to start, as radio cards (NewTopic.dc.html, Start). */
export function WayCards({
  way,
  disabled,
  onWay
}: {
  way: NewTopicWay
  disabled: boolean
  onWay: (way: NewTopicWay) => void
}): JSX.Element {
  const name = useId()
  return (
    <fieldset className="nt-ways" disabled={disabled}>
      <legend className="nt-label">Start from</legend>
      {NEW_TOPIC_WAYS.map((item) => {
        const copy = WAY_COPY[item]
        const checked = item === way
        return (
          <label key={item} className="nt-way" data-on={checked || undefined}>
            <input
              type="radio"
              className="nt-way-input"
              name={name}
              value={item}
              checked={checked}
              onChange={() => onWay(item)}
            />
            <span className="nt-way-title">{copy.title}</span>
            <span className="nt-way-body">{copy.body}</span>
          </label>
        )
      })}
    </fieldset>
  )
}
