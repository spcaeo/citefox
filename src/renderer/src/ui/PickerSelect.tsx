import type { JSX, SelectHTMLAttributes } from 'react'

/** The option value that stands for "+ New …". Never a real id. */
export const PICKER_NEW_VALUE = '__citefox_new__'

export interface PickerOption {
  value: string
  label: string
  disabled?: boolean
}

export interface PickerGroup {
  label: string
  options: readonly PickerOption[]
}

export type PickerSelectProps = Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'value' | 'onChange' | 'children'
> & {
  value: string
  onChange: (value: string) => void
  /** Flat options, or groups ("Topics", "Pages"). */
  options: readonly (PickerOption | PickerGroup)[]
  /** First, empty option such as "Pick a topic". Absent: none. */
  placeholder?: string
  /**
   * "+ New topic…": the last option. Choosing it calls `onCreate` (open the
   * create drawer stacked on top) and leaves the value as it was; the caller
   * sets the created item's id when the drawer hands it back.
   */
  createLabel?: string
  onCreate?: () => void
}

function isGroup(option: PickerOption | PickerGroup): option is PickerGroup {
  return 'options' in option
}

function renderOption(option: PickerOption): JSX.Element {
  return (
    <option key={option.value} value={option.value} disabled={option.disabled}>
      {option.label}
    </option>
  )
}

/**
 * A select that picks an existing item and can make a new one (deep audit
 * setup F6, "pickers create"): every picker of a topic, page, market,
 * competitor or key ends with "+ New {thing}…".
 */
export function PickerSelect({
  value,
  onChange,
  options,
  placeholder,
  createLabel,
  onCreate,
  className,
  ...rest
}: PickerSelectProps): JSX.Element {
  return (
    <select
      {...rest}
      className={className ?? 'ui-input'}
      value={value}
      onChange={(event) => {
        const next = event.target.value
        if (next === PICKER_NEW_VALUE) {
          // Keep showing the old choice until the new item comes back.
          event.target.value = value
          onCreate?.()
          return
        }
        onChange(next)
      }}
    >
      {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
      {options.map((option) =>
        isGroup(option) ? (
          <optgroup key={option.label} label={option.label}>
            {option.options.map(renderOption)}
          </optgroup>
        ) : (
          renderOption(option)
        )
      )}
      {createLabel && onCreate ? <option value={PICKER_NEW_VALUE}>{createLabel}</option> : null}
    </select>
  )
}
