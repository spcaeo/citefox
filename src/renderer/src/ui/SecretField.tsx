import { useState, type InputHTMLAttributes, type JSX } from 'react'
import { IconButton } from './IconButton'

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'autoComplete' | 'id'>

export type SecretFieldProps = InputProps & {
  /** The input's id, also what the eye button controls (and what a `<label htmlFor>` names). */
  id: string
  /**
   * Shown or hidden from outside (KeyEditor clears it after a save). Leave both
   * unset and the field keeps its own state.
   */
  shown?: boolean
  onShownChange?: (shown: boolean) => void
} & (
    | {
        /**
         * An API key for a service CiteFox calls (Anthropic, cloro, SerpApi…).
         *
         * Owner password rule, 2026-11-02, with the agreed exception for app
         * API keys: the eye button is kept ("Show key" / "Hide key"), but there
         * is no username field, no browser saving and no "Confirm" field. A key
         * is pasted from the provider's dashboard, not typed or remembered, so a
         * second copy only adds a way to paste it wrong; Electron has no
         * password manager to save it to; and CiteFox keeps every key in the
         * system keychain itself. `autoComplete="off"` keeps Chromium from
         * offering other saved text in a key field.
         */
        kind: 'key'
      }
    | {
        /**
         * A real password (such as the email account's app password). The form
         * around it must carry a username field (`autoComplete="username"`).
         * `current-password` when the person enters a password they already
         * have; `new-password` when they set one, together with a Confirm field.
         */
        kind: 'password'
        autoComplete: 'current-password' | 'new-password'
      }
  )

/**
 * The one secret input of the app (owner rule, 2026-11-02): a masked input and
 * an eye button that shows or hides it (`aria-pressed`). Every
 * `type="password"` input in the renderer goes through this component
 * (`SecretField.test.tsx` fails otherwise). It renders the input and the button
 * side by side without a wrapper, so it slots into each form's own row.
 */
export function SecretField(props: SecretFieldProps): JSX.Element {
  const { id, shown: shownProp, onShownChange, kind, ...input } = props
  const autoComplete = props.kind === 'password' ? props.autoComplete : 'off'
  if ('autoComplete' in input) delete (input as { autoComplete?: unknown }).autoComplete
  const [ownShown, setOwnShown] = useState(false)
  const shown = shownProp ?? ownShown
  const noun = kind === 'key' ? 'key' : 'password'

  return (
    <>
      <input
        spellCheck={false}
        {...input}
        id={id}
        type={shown ? 'text' : 'password'}
        autoComplete={autoComplete}
        data-secret-field={kind}
      />
      <IconButton
        icon={shown ? 'eye-off' : 'eye'}
        label={shown ? `Hide ${noun}` : `Show ${noun}`}
        aria-pressed={shown}
        aria-controls={id}
        onClick={() => {
          if (shownProp === undefined) setOwnShown(!shown)
          onShownChange?.(!shown)
        }}
      />
    </>
  )
}
