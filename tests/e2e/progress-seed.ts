import {
  finishOnboarding,
  openProgressSeed,
  PROGRESS_SEED
} from '../../src/main/handlers/progress.test-helper'

/**
 * The TextBolt page from the Progress handler tests, driven through the real
 * IPC handlers with recorded SerpApi bodies (no network):
 * - Oct 5 baseline in 🇺🇸 US · EN and 🇬🇧 UK · EN,
 * - Fix 1 (live Oct 8) targets prompt 2 in the US; its follow-up ran Oct 12
 *   with "Run follow-up now" as a partial check and the page is now cited,
 * - the page was read again Oct 15 with two new FAQs,
 * - Oct 19 full check (prompt 3 moved),
 * - a note dated Oct 16.
 */
export async function seedProgressProject(userDataDir: string): Promise<void> {
  const seed = openProgressSeed(userDataDir)
  const [, two, three] = PROGRESS_SEED.prompts
  try {
    await seed.check(PROGRESS_SEED.first)
    seed.setClock('2026-10-08T09:00:00.000Z')
    const fix = await seed.handlers['fixes:create']({
      projectId: PROGRESS_SEED.projectId,
      pageId: PROGRESS_SEED.pageId,
      description: 'Added a **pricing** FAQ for scheduled texts.',
      goLiveAt: '2026-10-08T12:00:00.000Z',
      rule: 'after_3_days',
      promptIds: [two.id],
      marketIds: [PROGRESS_SEED.us]
    })
    seed.bodies.set(`us|${two.text}`, 'google-ai-overview.json')
    seed.setClock('2026-10-12T09:00:00.000Z')
    await seed.handlers['fixes:runFollowUp']({ projectId: PROGRESS_SEED.projectId, fixId: fix.id })
    await waitForFollowUp(seed.handlers)
    seed.readPage('snap-2', '2026-10-15T12:00:00.000Z', {
      body: 'TextBolt sends text alerts from email. Schedule them for Saturday morning. No developer required.',
      faqs: [
        { question: 'Does it work with Gmail?', answer: 'Yes, and with Outlook.', typo: null },
        {
          question: 'Can staff reply to an alert?',
          answer: 'Yes, replies come back by email.',
          typo: null
        }
      ]
    })
    seed.bodies.set(`us|${three.text}`, 'google-own-page.json')
    await seed.check(PROGRESS_SEED.second)
    await seed.handlers['history:addNote']({
      projectId: PROGRESS_SEED.projectId,
      pageId: PROGRESS_SEED.pageId,
      date: '2026-10-16',
      text: 'Rewrote the intro and added two FAQs.'
    })
    finishOnboarding(seed.storage)
  } finally {
    seed.close()
  }
}

async function waitForFollowUp(
  handlers: ReturnType<typeof openProgressSeed>['handlers']
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const list = await handlers['fixes:list']({
      projectId: PROGRESS_SEED.projectId,
      pageId: PROGRESS_SEED.pageId
    })
    if (list.fixes[0]?.status === 'completed') return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('The seeded follow-up did not finish')
}
