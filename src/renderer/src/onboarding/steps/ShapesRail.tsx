import type { JSX } from 'react'
import { BusyMark } from '../../ui'
import { TERMS } from './shapeCopy'

/**
 * Step 8's side panel: "Keyword, question or prompt?" answered once, and what Claude
 * already did (it read the site and wrote this page's examples while the user went
 * through steps 4 to 7).
 */
export function ShapesRail({
  domain,
  claude,
  examplesBusy,
  hasExamples
}: {
  domain: string
  /** Null while CiteFox still asks. */
  claude: boolean | null
  examplesBusy: boolean
  hasExamples: boolean
}): JSX.Element {
  return (
    <div className="obs-rail">
      <section className="ob-card obs-rail-card" aria-labelledby="s8-terms">
        <h2 className="obs-card-title" id="s8-terms">
          Keyword, question or prompt?
        </h2>
        <dl className="obs-terms">
          {TERMS.map((item) => (
            <div key={item.term}>
              <dt>{item.term}</dt>
              <dd>{item.text}</dd>
            </div>
          ))}
        </dl>
        <p className="obs-rail-note">
          You do not have to pick one. Buyers use all three, and a mix shows where AI cites you and
          where it sends them to someone else.
        </p>
        <p className="hint">
          Every engine you ticked checks every prompt. You can add, edit or drop prompts at any time
          after setup.
        </p>
      </section>

      <section className="ob-card obs-rail-card" aria-labelledby="s8-claude">
        <h2 className="obs-card-title" id="s8-claude">
          {claude === false ? 'Without an AI' : 'CiteFox AI is on it'}
        </h2>
        {claude === false ? (
          <p className="obs-rail-note">
            Paste your own list here, or write prompts on the next step with your own ChatGPT.
          </p>
        ) : (
          <ul className="obs-claude-list">
            <li>
              <BusyMark state="done" size="sm" />
              Connected to the AI on this computer
            </li>
            <li>
              <BusyMark state="done" size="sm" />
              Read {domain || 'your site'}, your buyers and your rivals
            </li>
            <li>
              <BusyMark
                state={examplesBusy ? 'running' : hasExamples ? 'done' : 'waiting'}
                size="sm"
              />
              {examplesBusy
                ? 'Writing the examples on this page from your site'
                : hasExamples
                  ? 'Wrote the examples on this page from your site'
                  : 'Examples from your site appear here'}
            </li>
            <li>
              <BusyMark state="waiting" size="sm" />
              Writes your prompts next, from your buyers and what makes them start looking
            </li>
          </ul>
        )}
      </section>
    </div>
  )
}
