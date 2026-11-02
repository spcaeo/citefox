import type { FormEvent, JSX, ReactNode } from 'react'
import { WizardFooter, type WizardPrimary } from '../ui'

/**
 * One setup step in the v2 wizard layout (Theme "Layouts", Seed-Input.png):
 * the page head, an 8 + 4 grid (the step's cards and a right context rail)
 * in the setup width the first-run journey shares (`.setup-width`),
 * and the sticky footer with Back (ghost), a one-line note, and the step's
 * one primary action.
 *
 * With `onSubmit` the step is a form: Enter in a field submits it (a hidden
 * submit button keeps implicit submission with several fields) and the footer
 * primary runs the same handler.
 *
 * `alert` is a visible message under the heading, for a problem the user must
 * see (Finish setup sent them back here), not only hear.
 */
export function StepPage({
  kicker,
  title,
  sub,
  rail,
  railLabel,
  onSubmit,
  onBack,
  note,
  primary,
  alert = null,
  children
}: {
  /** The small line above the heading, such as "Step 3 of 8". */
  kicker?: string
  title: string
  sub?: ReactNode
  rail?: ReactNode
  /** Accessible name of the rail landmark. */
  railLabel?: string
  onSubmit?: () => void
  onBack?: () => void
  note?: ReactNode
  primary: WizardPrimary
  alert?: string | null
  children: ReactNode
}): JSX.Element {
  const body = (
    <>
      <div className="ob-page setup-width">
        <div className="ob-head">
          {kicker ? <span className="ob-kicker">{kicker}</span> : null}
          <h1>{title}</h1>
          {sub ? <div className="ob-sub">{sub}</div> : null}
        </div>
        {alert ? (
          <div className="panel-warn ob-alert" role="alert">
            <p>{alert}</p>
          </div>
        ) : null}
        <div className={rail ? 'ob-grid' : 'ob-grid ob-grid-single'}>
          <div className="ob-main">{children}</div>
          {rail ? (
            <aside className="ob-rail" aria-label={railLabel}>
              {rail}
            </aside>
          ) : null}
        </div>
      </div>
      <WizardFooter {...(onBack ? { onBack } : {})} {...(note ? { note } : {})} primary={primary} />
    </>
  )

  if (!onSubmit) return <div className="ob">{body}</div>
  const submit = onSubmit

  function handle(event: FormEvent): void {
    event.preventDefault()
    submit()
  }

  return (
    <form className="ob" onSubmit={handle} noValidate>
      <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
      {body}
    </form>
  )
}
