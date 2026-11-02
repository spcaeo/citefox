import type { JSX } from 'react'
import { PROVIDER_PLANS, PROVIDER_PLANS_CHECKED } from '../../keys/providerLinks'
import { PROVIDER_LOGOS } from '../../keys/providerLogos'
import { LinkButton } from '../../ui'

const WHY = [
  'One key checks six AI answers: Google AI Overview, AI Mode, ChatGPT, Perplexity, Gemini and Copilot.',
  'It returns the answer as a buyer sees it, with the sources it cites, so CiteFox can tell whether your pages are among them.',
  'You pay per answer checked, in credits, and CiteFox shows the cost before every check.'
] as const

const BETTER = [
  'SerpApi only sees Google AI Overviews, so ChatGPT, Perplexity and the rest stay blind.',
  'A Google AI Overview sometimes needs a second SerpApi search; cloro returns it in one call.'
] as const

const LIMITS = [
  'Credits reset each month and do not roll over. No pay as you go: plans are monthly.',
  'The free plan runs one answer at a time, so a big check is slower.',
  'When the credits run out, checks stop until next month or a bigger plan. Add a second key and CiteFox moves on to it.',
  'Perplexity is sometimes unavailable, and AI answers change from one check to the next.'
] as const

function List({ items }: { items: readonly string[] }): JSX.Element {
  return (
    <ul className="obs-rail-list">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}

/**
 * Step 7's side panel (owner feedback 2026-10-25): why CiteFox uses cloro, why it
 * beats SerpApi, its limits, and what both give free, with their pricing pages.
 * `perQuestion` is the credits one question costs on the ticked engines.
 */
export function EnginesRail({ perQuestion }: { perQuestion: number }): JSX.Element {
  const cloroFree = perQuestion > 0 ? Math.floor(PROVIDER_PLANS.cloro.freeAmount / perQuestion) : 0
  return (
    <div className="obs-rail">
      <section className="ob-card obs-rail-card" aria-labelledby="s7-why">
        <h2 className="obs-card-title obs-rail-head" id="s7-why">
          <img src={PROVIDER_LOGOS.cloro} alt="" width={20} height={20} />
          Why cloro
        </h2>
        <List items={WHY} />
        <h3 className="obs-rail-sub">Why not SerpApi</h3>
        <List items={BETTER} />
        <h3 className="obs-rail-sub">Good to know</h3>
        <List items={LIMITS} />
      </section>

      <section className="ob-card obs-rail-card" aria-labelledby="s7-free">
        <h2 className="obs-card-title" id="s7-free">
          Free to try
        </h2>
        {(['cloro', 'serpapi'] as const).map((provider) => {
          const plan = PROVIDER_PLANS[provider]
          const name = provider === 'cloro' ? 'cloro' : 'SerpApi'
          return (
            <div key={provider} className="obs-plan">
              <p className="obs-plan-name">
                <img src={PROVIDER_LOGOS[provider]} alt="" width={18} height={18} />
                {name}
              </p>
              <p className="obs-plan-line">
                <strong>Free:</strong> {plan.free}
                {provider === 'cloro' && cloroFree > 0
                  ? ` (about ${cloroFree} questions on the engines ticked)`
                  : provider === 'serpapi'
                    ? ' (Google AI Overviews only)'
                    : ''}
              </p>
              <p className="obs-plan-line">{plan.paid}</p>
              <LinkButton
                size="sm"
                variant="text"
                href={plan.pricingUrl}
                external
                iconEnd="external"
                aria-label={`${name} plans and prices (opens in your browser)`}
              >
                Plans and prices
              </LinkButton>
            </div>
          )
        })}
        <p className="hint">Prices checked {PROVIDER_PLANS_CHECKED}.</p>
        <p className="obs-rail-fine">
          The cloro links carry CiteFox&rsquo;s referral code. Signing up through them helps the
          developer keep CiteFox free and open source, at no extra cost to you. Thank you!
        </p>
      </section>
    </div>
  )
}
