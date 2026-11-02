import { useState, type JSX, type ReactNode } from 'react'
import { DomainText, LinkButton, UiIcon } from '../ui'
import { KEY_GUIDES, type GuidedKeyProvider } from './providerLinks'
import './key-steps.css'

/**
 * A key in 3 guided steps (helpfill-board panel 6): make an account (sign-up ↗),
 * copy the API key (dashboard ↗), paste it here. A presentation layer only: the
 * paste field and the one green "Test and save" are the caller's, so the key is
 * stored by the same code as before. Step 1 shows a tick once its link is opened,
 * or when the provider already has a key (the account exists).
 */
export function KeySteps({
  provider,
  hasAccount = false,
  children
}: {
  provider: GuidedKeyProvider
  /** A key of this provider is already saved. */
  hasAccount?: boolean
  /** Step 3's fields: the API key and anything else the form asks. */
  children: ReactNode
}): JSX.Element {
  const guide = KEY_GUIDES[provider]
  const [signedUp, setSignedUp] = useState(hasAccount)
  const [copied, setCopied] = useState(false)
  return (
    <ol className="ks" aria-label={`Connect ${guide.name} in 3 steps`} data-testid="key-steps">
      <li className={signedUp ? 'ks-step done' : 'ks-step'}>
        <StepNumber n={1} done={signedUp} />
        <div className="ks-body">
          <p className="ks-title">
            Make a free {guide.name} account
            {signedUp ? <span className="sr-only"> (done)</span> : null}
          </p>
          <p className="ks-sub">
            <DomainText domain={guide.signupDomain} icon={false} /> · opens in your browser
          </p>
        </div>
        <LinkButton
          size="sm"
          href={guide.signupUrl}
          external
          iconEnd="external"
          aria-label={`Sign up at ${guide.name} (opens in your browser)`}
          onClick={() => setSignedUp(true)}
        >
          Sign up
        </LinkButton>
      </li>
      <li className={copied ? 'ks-step done' : 'ks-step'}>
        <StepNumber n={2} done={copied} />
        <div className="ks-body">
          <p className="ks-title">
            Copy your API key
            {copied ? <span className="sr-only"> (done)</span> : null}
          </p>
          <p className="ks-sub">{guide.dashboardPath}</p>
        </div>
        <LinkButton
          size="sm"
          href={guide.dashboardUrl}
          external
          iconEnd="external"
          aria-label={`Open dashboard at ${guide.name} (opens in your browser)`}
          onClick={() => setCopied(true)}
        >
          Open dashboard
        </LinkButton>
      </li>
      <li className="ks-step ks-paste">
        <StepNumber n={3} done={false} />
        <div className="ks-body">
          <p className="ks-title">Paste it here</p>
          <p className="ks-sub">{guide.testNote}</p>
          <div className="ks-fields">{children}</div>
        </div>
      </li>
    </ol>
  )
}

function StepNumber({ n, done }: { n: number; done: boolean }): JSX.Element {
  return (
    <span className="ks-num" aria-hidden="true">
      {done ? <UiIcon name="check" size={12} /> : n}
    </span>
  )
}
