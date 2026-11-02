// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { axeViolations } from './axe.test-helper'
import { WizardFooter } from './WizardFooter'

afterEach(cleanup)

describe('WizardFooter', () => {
  it('has a white Back, a cost note and one green primary', () => {
    const onBack = vi.fn()
    const onNext = vi.fn()
    const view = render(
      <WizardFooter
        onBack={onBack}
        note="118 keywords need 118–236 searches · you have 13"
        noteTone="warn"
        primary={{ label: 'Match pages', onClick: onNext }}
      />
    )
    const back = view.getByRole('button', { name: 'Back' })
    expect(back.className).toContain('ui-btn-secondary')
    fireEvent.click(back)
    expect(onBack).toHaveBeenCalledTimes(1)
    const primary = view.getByRole('button', { name: 'Match pages' })
    expect(primary.className).toContain('ui-btn-primary')
    expect(view.container.querySelectorAll('.ui-btn-primary')).toHaveLength(1)
    fireEvent.click(primary)
    expect(onNext).toHaveBeenCalledTimes(1)
    const note = view.getByRole('status')
    expect(note.className).toContain('ui-wizard-note-warn')
    expect(note.textContent).toContain('118 keywords need')
  })

  it('leaves out Back and the note when not given and respects disabled', () => {
    const onNext = vi.fn()
    const view = render(
      <WizardFooter primary={{ label: 'Start', onClick: onNext, disabled: true, icon: null }} />
    )
    expect(view.queryByRole('button', { name: 'Back' })).toBeNull()
    expect(view.queryByRole('status')).toBeNull()
    const start = view.getByRole('button', { name: 'Start' })
    expect(start.querySelector('svg')).toBeNull()
    fireEvent.click(start)
    expect(onNext).not.toHaveBeenCalled()
  })

  it('is axe clean', async () => {
    const view = render(
      <WizardFooter
        onBack={() => {}}
        note="Next: CiteFox AI writes 30 questions · about 40 s"
        primary={{ label: 'Write questions', onClick: () => {} }}
      />
    )
    expect(await axeViolations(view.container)).toEqual([])
  })
})
