import type { JSX } from 'react'
import { Chip, Panel, WizardFooter } from '../ui'

const TITLE = 'See whether Google AI Overviews, ChatGPT, Perplexity and more cite your site.'

const NEEDS: readonly { title: string; detail: string; optional?: boolean }[] = [
  {
    title: 'Your website',
    detail: 'Its address, and the country and language of your buyers.'
  },
  {
    title: 'An AI plan you already have',
    detail:
      'CiteFox AI reads your site and drafts the rest on an AI plan you already pay for, on this computer. You pick it in setup, and you can use ChatGPT instead.',
    optional: true
  },
  {
    title: 'CiteFox credits for searches',
    detail:
      'Credits pay for the searches that check Google AI Overviews, ChatGPT, Perplexity, AI Mode, Gemini and Copilot. You can sign up during setup.'
  }
]

/** The first screen before setup (Mockups/Main.dc.html, v2 look). */
export function WelcomeScreen({ onStart }: { onStart: () => void }): JSX.Element {
  return (
    <div className="ob">
      <div className="ob-page setup-width">
        <div className="welcome-wrap">
          <section className="welcome-copy" aria-labelledby="welcome-title">
            <span className="ob-kicker">AI answer tracker</span>
            <h1 id="welcome-title">{TITLE}</h1>
            <p className="welcome-lead">
              CiteFox reads your site, writes the questions your buyers ask, checks what Google AI
              Overviews, ChatGPT, Perplexity and other AI answers say for each one, and re-checks on
              a schedule so you can see whether your edits worked.
            </p>
            <Panel
              title="Setup takes about five minutes, in 8 short steps. You’ll need"
              titleAs="h2"
              padding={0}
            >
              <ol className="need-list">
                {NEEDS.map((need, index) => (
                  <li className="need" key={need.title}>
                    <span className={need.optional ? 'need-num optional' : 'need-num'}>
                      {index + 1}
                    </span>
                    <div>
                      <p className="need-title">
                        {need.title}
                        {need.optional ? <span className="opt"> (optional)</span> : null}
                      </p>
                      <p className="hint">{need.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </Panel>
          </section>
          <aside className="welcome-example" aria-label="Example result">
            <Panel
              title="Example check"
              titleAs="h2"
              actions={
                <Chip tone="fox" dot>
                  Your page cited
                </Chip>
              }
            >
              <div className="example-body">
                <div>
                  <p className="hint">Buyer asks</p>
                  <p className="example-q">
                    What is the easiest way to send appointment reminders by text without switching
                    to new software?
                  </p>
                </div>
                <div className="example-aio">
                  <p className="hint">AI answer</p>
                  <p>
                    Use a reminder service that works with the calendar you already have: each
                    booking sends a text a day before, and replies come back to your inbox. Nothing
                    for customers to install…
                  </p>
                </div>
                <div className="example-refs">
                  <p className="hint">Sources the answer listed</p>
                  <div className="ref">
                    <span className="mono">1</span>
                    <span className="mono">reviews.example.org/…</span>
                  </div>
                  <div className="ref ref-own">
                    <span className="mono">2</span>
                    <span className="mono">example.com/blog/text-reminders/</span>
                    <Chip tone="fox" size="sm">
                      Target
                    </Chip>
                  </div>
                  <div className="ref">
                    <span className="mono">3</span>
                    <span className="mono">competitor.example.com/…</span>
                  </div>
                </div>
              </div>
            </Panel>
          </aside>
        </div>
      </div>
      <WizardFooter
        note="Your SEO data stays on this computer."
        primary={{ label: 'Get started', onClick: onStart }}
      />
    </div>
  )
}
