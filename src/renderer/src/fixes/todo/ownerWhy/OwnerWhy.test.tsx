// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { rollupPageFixes } from '@shared/page-fixes'
import { ownerWhyContext } from '@shared/owner-why'
import { fakeLoopSource, NOW, ownerWhyResult } from '../../fixtures'
import { FixesScreen } from '../../index'
import { projectSearches } from '../../searchFixtures'
import { UndoToastHost } from '../../../ui/UndoToast'
import { resetUndoToastForTests } from '../../../ui/undoStore'
import { changesText, verdictLine } from './ownerWhyCopy'
import { whySearches } from './useOwnerWhy'

afterEach(() => {
  cleanup()
  act(() => resetUndoToastForTests())
  window.location.hash = ''
  window.localStorage.clear()
})

const OWNER = rollupPageFixes(projectSearches().searches).fixes.find(
  (fix) => fix.kind === 'owner' && fix.page !== null && fix.citedUrl !== null
)

function hashParams(): URLSearchParams {
  const hash = window.location.hash
  const at = hash.indexOf('?')
  return new URLSearchParams(at < 0 ? '' : hash.slice(at + 1))
}

describe('Fixes · Pick which page owns it · Why Google picks', () => {
  it('compares the pages, leads with the recommended option and opens Page edits on that page', async () => {
    if (!OWNER?.page || !OWNER.citedUrl) throw new Error('no owner fix with both pages')
    window.location.hash = `#/fixes?pf=${OWNER.id}`
    const { source, calls } = fakeLoopSource()
    const view = render(
      <>
        <FixesScreen projectId="proj-1" source={source} now={NOW} />
        <UndoToastHost />
      </>
    )
    const drawer = await view.findByRole('dialog', { name: /Pick which page owns it/ })
    const why = await within(drawer).findByTestId('owner-why')
    // Before a comparison: no Page edits tab, and no option leads.
    expect(within(drawer).queryByRole('tab', { name: 'Page edits' })).toBeNull()
    const keep = within(drawer).getByRole('button', { name: /^Keep .*, get its fix brief/ })
    expect(keep.className).not.toMatch(/primary/)

    fireEvent.click(within(why).getByRole('button', { name: 'Compare the pages' }))
    const result = await within(why).findByTestId('owner-why-result')
    const call = calls.briefs.find((item) => item.channel === 'fixes:draftOwnerWhy')
    expect(call?.request).toMatchObject({
      projectId: 'proj-1',
      fixId: OWNER.id,
      target: { url: OWNER.page.url },
      citedUrl: OWNER.citedUrl,
      searches: whySearches(OWNER)
    })
    expect(within(result).getByRole('status').textContent).toContain(
      'Keep the target and strengthen it'
    )
    expect(within(result).getByText('What the answer needs')).toBeTruthy()
    expect(within(result).getByText(/has that the target lacks$/)).toBeTruthy()
    expect(within(result).getByText('Add a short comparison of the three options.')).toBeTruthy()
    expect(within(why).getByRole('button', { name: 'Compare again' })).toBeTruthy()
    // The recommended option is now the primary button.
    expect(
      within(drawer).getByRole('button', { name: /^Keep .*, get its fix brief/ }).className
    ).toMatch(/primary/)

    // Page edits opens on the recommended page, with the comparison as advice.
    fireEvent.click(within(result).getByRole('button', { name: 'Show page edits' }))
    await waitFor(() => expect(hashParams().get('pft')).toBe('edits'))
    fireEvent.click(await within(drawer).findByRole('button', { name: 'Show page edits' }))
    await within(drawer).findByTestId('page-editor')
    const edit = calls.briefs.find((item) => item.channel === 'fixes:draftPageEdit')
    expect(edit?.request).toMatchObject({
      fixId: OWNER.id,
      url: OWNER.page.url,
      context: ownerWhyContext(ownerWhyResult(OWNER.id, OWNER.page.url, OWNER.citedUrl))
    })
  })

  it('reopening shows the saved comparison; a "cited" verdict leads with Google\'s pick', async () => {
    if (!OWNER?.page || !OWNER.citedUrl) throw new Error('no owner fix with both pages')
    const saved = ownerWhyResult(OWNER.id, OWNER.page.url, OWNER.citedUrl, 'cited')
    const { source } = fakeLoopSource(undefined, {
      'fixes:ownerWhy': () => Promise.resolve(saved)
    })
    window.location.hash = `#/fixes?pf=${OWNER.id}&pft=edits`
    const view = render(<FixesScreen projectId="proj-1" source={source} now={NOW} />)
    const drawer = await view.findByRole('dialog', { name: /Pick which page owns it/ })
    // The tab from the link opens once the verdict names the page to edit.
    expect(
      await within(drawer).findByRole('tab', { name: 'Page edits', selected: true })
    ).toBeTruthy()
    fireEvent.click(within(drawer).getByRole('tab', { name: 'Brief' }))
    const result = await within(drawer).findByTestId('owner-why-result')
    expect(within(result).getByRole('status').textContent).toContain(
      verdictLine('cited', OWNER.citedUrl)
    )
    expect(within(drawer).getByRole('button', { name: /^Make .* the owner/ }).className).toMatch(
      /primary/
    )
  })

  it('the copy text names the page and each change with its reason', () => {
    const why = ownerWhyResult('pf-1', 'https://textbolt.com/a/', 'https://textbolt.com/b/')
    expect(changesText(why)).toBe(
      [
        'What to change on https://textbolt.com/a/',
        '',
        '- Opening: Open with the best replacement and who it suits. [check: the price]',
        '  Why: Answers the comparison search first.',
        '- New section after How it works: Add a short comparison of the three options.',
        '  Why: Gives the answer the side-by-side view.'
      ].join('\n')
    )
    expect(ownerWhyContext(why)).toContain('What to change on this page:\n- Opening: Open with')
  })
})
