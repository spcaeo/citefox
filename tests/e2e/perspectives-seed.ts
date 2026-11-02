import {
  finishOnboarding,
  openProgressSeed,
  PROGRESS_SEED
} from '../../src/main/handlers/progress.test-helper'

/**
 * The TextBolt page from the Progress handler tests with two full checks whose
 * recorded SerpApi bodies differ, so the Overview has a before and an after
 * (no network). Only SimpleTexting is a saved competitor, so Twilio is a cited
 * site that no built-in list knows: Competitors asks Claude (the fixture shim)
 * to sort it once.
 *
 * In 🇺🇸 US · EN (the page's default market):
 * - Oct 5: Q1 cites the page, Q2 an own page, Q3 SimpleTexting only.
 * - Oct 19: Q1 only names TextBolt (lost), Q2 still cites (kept), Q3 cites the page (gained).
 * In 🇬🇧 UK · EN, Q1 goes from SimpleTexting only to an own page (gained).
 */
export async function seedPerspectivesProject(userDataDir: string): Promise<void> {
  const seed = openProgressSeed(userDataDir, { competitors: ['simpletexting.com'] })
  const [one, , three] = PROGRESS_SEED.prompts
  try {
    await seed.check(PROGRESS_SEED.first)
    seed.bodies.set(`us|${one.text}`, 'google-brand-named.json')
    seed.bodies.set(`us|${three.text}`, 'google-ai-overview.json')
    seed.bodies.set(`uk|${one.text}`, 'google-own-page.json')
    await seed.check(PROGRESS_SEED.second)
    finishOnboarding(seed.storage)
  } finally {
    seed.close()
  }
}
