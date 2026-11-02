import { useId, type JSX, type ReactNode } from 'react'

export interface Choice<T extends string> {
  value: T
  label: ReactNode
  /** Muted line under the label (list), or under the group while picked (seg). */
  hint?: ReactNode
}

/**
 * A labelled radio group. Arrow keys move between options, as with any native
 * radio set. `seg` draws the radios as a v2 segmented control (Theme "Inputs":
 * choices of 2–5 use a segmented control) and shows the picked choice's hint
 * under it; `list` stacks them with their hints.
 */
export function ChoiceGroup<T extends string>({
  name,
  legend,
  legendClassName = 'xpt-label',
  choices,
  value,
  onChange,
  inline = false,
  variant = 'list'
}: {
  name: string
  legend: string
  legendClassName?: string
  choices: readonly Choice<T>[]
  value: T
  onChange: (value: T) => void
  inline?: boolean
  variant?: 'list' | 'seg'
}): JSX.Element {
  const legendId = useId()
  const picked = choices.find((choice) => choice.value === value)
  if (variant === 'seg') {
    return (
      <fieldset className="xpt-group" role="radiogroup" aria-labelledby={legendId}>
        <legend id={legendId} className={legendClassName}>
          {legend}
        </legend>
        <div className="xpt-seg">
          {choices.map((choice) => (
            <label
              className={value === choice.value ? 'xpt-seg-opt on' : 'xpt-seg-opt'}
              key={choice.value}
            >
              <input
                type="radio"
                name={name}
                value={choice.value}
                checked={value === choice.value}
                onChange={() => onChange(choice.value)}
              />
              <span>{choice.label}</span>
            </label>
          ))}
        </div>
        {picked?.hint ? <p className="xpt-help">{picked.hint}</p> : null}
      </fieldset>
    )
  }
  return (
    <fieldset className="xpt-group" role="radiogroup" aria-labelledby={legendId}>
      <legend id={legendId} className={legendClassName}>
        {legend}
      </legend>
      <div className={inline ? 'xpt-choices inline' : 'xpt-choices'}>
        {choices.map((choice) => (
          <label className="check" key={choice.value}>
            <input
              type="radio"
              name={name}
              value={choice.value}
              checked={value === choice.value}
              onChange={() => onChange(choice.value)}
            />
            <span className="stack">
              <span>{choice.label}</span>
              {choice.hint ? <span className="sub">{choice.hint}</span> : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
