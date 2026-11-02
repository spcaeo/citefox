import { expect, test } from '@playwright/test'
import { expectMainAccessible, openHash, openTwoMarketApp, shot } from './screens-app'

const PROMPT = 'How do I alert the crew without a developer?'
const FREE = 'Can I send text alerts to employees for free?'
const SHORT = 'Is business texting legal?'

/**
 * Google's results from the stored search (recorded fixture, no live search): the
 * prompt page says where the page ranks and lists People also ask; Track adds one
 * with Undo; the short one is reworded in Add questions, which lists the same
 * questions under "Seen on Google".
 */
test('prompt page shows the Google rank and People also ask; Add questions offers them', async () => {
  test.setTimeout(180_000)
  const { page, close } = await openTwoMarketApp('google-extras')
  try {
    await openHash(page, '#/pages/page-1/prompt/prompt-1')
    const screen = page.getByTestId('prompt-detail')
    await expect(screen.getByRole('heading', { level: 1, name: PROMPT })).toBeVisible()

    const card = screen.getByRole('region', { name: 'Google search' })
    await expect(card.getByTestId('pd-google-rank')).toHaveText(
      "Your page ranks #3 in Google's results."
    )
    const asked = card.getByRole('list', { name: 'People also ask on Google' })
    // Deduped across the US and UK checks; the tracked "Which plan covers scheduled texts?" is left out.
    await expect(asked.getByRole('listitem')).toHaveCount(4)
    await expect(asked).not.toContainText('Which plan covers scheduled texts?')
    // Every question has a Copy icon; only the trackable ones have Track.
    await expect(asked.getByRole('button', { name: /^Copy / })).toHaveCount(4)
    await expect(asked.getByRole('button', { name: /^Track: / })).toHaveCount(3)
    await expect(
      asked
        .getByRole('listitem')
        .filter({ hasText: SHORT })
        .getByRole('button', { name: /^Track: / })
    ).toHaveCount(0)
    await card.scrollIntoViewIfNeeded()
    await expectMainAccessible(page)
    await shot(page, 'prompt-detail-google')

    await card.getByRole('button', { name: `Track: ${FREE}` }).click()
    const toast = page.getByTestId('undo-toast')
    await expect(toast).toContainText('Added 1 question to Alerts.')
    await expect(asked).not.toContainText(FREE)
    await toast.getByRole('button', { name: 'Undo' }).click()
    await expect(toast).toContainText('Undone.')

    await card.getByRole('link', { name: 'Reword them in Add questions' }).click()
    const drawer = page.getByRole('dialog', { name: 'Add questions' })
    await expect(drawer).toBeVisible()
    await expect(page).toHaveURL(/drawer=add-questions/)
    const seen = drawer.getByTestId('aq-seen-google')
    await expect(
      seen.getByRole('list', { name: 'Seen on Google' }).getByRole('listitem')
    ).toHaveCount(4)
    await seen.getByRole('checkbox', { name: SHORT }).check()
    await drawer.getByRole('button', { name: 'Add 1 to the rows' }).click()
    await expect(drawer.getByRole('textbox', { name: 'Question 1', exact: true })).toHaveValue(
      SHORT
    )
    await shot(page, 'add-questions-seen-on-google')
    await expect(page.getByText(/Error invoking remote method/)).toHaveCount(0)
  } finally {
    await close()
  }
})
