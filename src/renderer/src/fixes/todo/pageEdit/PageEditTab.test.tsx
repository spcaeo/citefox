// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { rollupPageFixes } from '@shared/page-fixes'
import { fakeLoopSource, NOW } from '../../fixtures'
import { FixesScreen } from '../../index'
import { projectSearches } from '../../searchFixtures'
import { UndoToastHost } from '../../../ui/UndoToast'
import { resetUndoToastForTests } from '../../../ui/undoStore'

afterEach(() => {
  cleanup()
  act(() => resetUndoToastForTests())
  window.location.hash = ''
  window.localStorage.clear()
})

const IMPROVE = rollupPageFixes(projectSearches().searches).fixes.find(
  (fix) => fix.kind === 'improve' && fix.page !== null
)

function hashParams(): URLSearchParams {
  const hash = window.location.hash
  const at = hash.indexOf('?')
  return new URLSearchParams(at < 0 ? '' : hash.slice(at + 1))
}

describe('Fixes · a page fix · Page edits', () => {
  it('the tab is on the URL; it writes the edits, keeps or undoes each one, and downloads them', async () => {
    if (!IMPROVE) throw new Error('no improve fix with a page')
    window.location.hash = `#/fixes?pf=${IMPROVE.id}`
    const { source, calls } = fakeLoopSource()
    const view = render(
      <>
        <FixesScreen projectId="proj-1" source={source} now={NOW} />
        <UndoToastHost />
      </>
    )
    const drawer = await view.findByRole('dialog', { name: /Improve a page/ })
    // The promo card sits in the rail, not inside the brief.
    expect(within(drawer).getByRole('complementary', { name: /1000AIOverviews/ })).toBeTruthy()
    fireEvent.click(within(drawer).getByRole('tab', { name: 'Page edits' }))
    await waitFor(() => expect(hashParams().get('pft')).toBe('edits'))

    fireEvent.click(await within(drawer).findByRole('button', { name: 'Show page edits' }))
    const editor = await within(drawer).findByTestId('page-editor')
    // The review controls sit in the rail, beside the page.
    const review = (): HTMLElement => within(drawer).getByTestId('page-edit-review')
    expect(calls.briefs.find((call) => call.channel === 'fixes:draftPageEdit')).toMatchObject({
      request: { projectId: 'proj-1', fixId: IMPROVE.id, url: IMPROVE.page?.url }
    })
    expect(within(review()).getByRole('status').textContent).toContain('3 changes to review')
    expect(editor.querySelectorAll('.pe-cut')).toHaveLength(2)
    expect(editor.querySelectorAll('.pe-add')).toHaveLength(2)

    // Undo the cut: the paragraph reads as normal again.
    fireEvent.click(within(editor).getByRole('button', { name: /^Undo: Remove “We have been/ }))
    expect(editor.querySelectorAll('.pe-cut')).toHaveLength(1)
    expect(within(review()).getByRole('status').textContent).toContain('2 changes to review')

    fireEvent.click(within(review()).getByRole('button', { name: /^Download/ }))
    fireEvent.click(view.getByRole('menuitem', { name: 'HTML page' }))
    await waitFor(() =>
      expect(calls.briefs.find((call) => call.channel === 'fixes:savePageEditHtml')).toBeTruthy()
    )
    const saved = calls.briefs.find((call) => call.channel === 'fixes:savePageEditHtml')
      ?.request as { fileName: string; html: string }
    expect(saved.fileName).toMatch(/-edits\.html$/)
    expect(saved.html).toContain('<del>Many teams used carrier gateways for years.</del>')
    expect(saved.html).toContain('<p>We have been in business since 2015 and love texting.</p>')
    expect(await view.findByText(/^Saved .*-edits\.html\.$/)).toBeTruthy()

    // The same page as Markdown for docs tools.
    fireEvent.click(within(review()).getByRole('button', { name: /^Download/ }))
    fireEvent.click(view.getByRole('menuitem', { name: 'Markdown (.md)' }))
    await waitFor(() =>
      expect(calls.briefs.filter((call) => call.channel === 'fixes:savePageEditHtml')).toHaveLength(
        2
      )
    )
    const md = calls.briefs.filter((call) => call.channel === 'fixes:savePageEditHtml')[1]
      ?.request as { fileName: string; html: string; format: string }
    expect(md.format).toBe('md')
    expect(md.fileName).toMatch(/-edits\.md$/)
    expect(md.html).toContain('~~Many teams used carrier gateways for years.~~')

    fireEvent.click(within(review()).getByRole('button', { name: /Keep all/ }))
    expect(within(review()).getByRole('status').textContent).toContain('All changes reviewed')
    expect(editor.querySelectorAll('.pe-cut, .pe-add')).toHaveLength(0)

    // Back on the brief, the URL drops the tab.
    fireEvent.click(within(drawer).getByRole('tab', { name: 'Brief' }))
    await waitFor(() => expect(hashParams().get('pft')).toBeNull())
  })

  it('opens straight on saved edits from a link, with the choices kept', async () => {
    if (!IMPROVE) throw new Error('no improve fix with a page')
    const { source } = fakeLoopSource()
    await source['fixes:draftPageEdit']({
      projectId: 'proj-1',
      fixId: IMPROVE.id,
      pageId: null,
      url: IMPROVE.page?.url ?? '',
      searches: [],
      topicId: null
    })
    window.location.hash = `#/fixes?pf=${IMPROVE.id}&pft=edits`
    const view = render(<FixesScreen projectId="proj-1" source={source} now={NOW} />)
    const editor = await view.findByTestId('page-editor')
    const review = (): HTMLElement => view.getByTestId('page-edit-review')
    fireEvent.click(within(editor).getByRole('button', { name: /^Keep: Rewrite/ }))
    expect(within(review()).getByRole('status').textContent).toContain('2 changes to review')
    cleanup()
    const again = render(<FixesScreen projectId="proj-1" source={source} now={NOW} />)
    await again.findByTestId('page-editor')
    expect(within(again.getByTestId('page-edit-review')).getByRole('status').textContent).toContain(
      '2 changes to review'
    )
  })
})
