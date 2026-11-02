// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { announcedText, resetAnnouncerForTests } from './announce'
import { BusyBar, BusyLine, BusyMark } from './Busy'
import { busyTiming, formatUsual, SLOW_TEXT } from './busyModel'
import { Button } from './Button'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  resetAnnouncerForTests()
})

/** Moves the fake clock on and lets the second ticks render. */
function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

describe('busyTiming', () => {
  it('says the elapsed time and the usual range', () => {
    expect(formatUsual([5, 10])).toBe('usually 5–10 s')
    expect(formatUsual([3, 3])).toBe('usually about 3 s')
    expect(busyTiming(4_200, [5, 10])).toEqual({
      elapsed: '4 s',
      usual: 'usually 5–10 s',
      text: '4 s · usually 5–10 s',
      slow: false
    })
    expect(busyTiming(65_000).text).toBe('1 min 5 s')
  })

  it('turns slow at twice the usual top end, never without a usual time', () => {
    expect(busyTiming(19_999, [5, 10]).slow).toBe(false)
    expect(busyTiming(20_000, [5, 10]).slow).toBe(true)
    expect(busyTiming(600_000).slow).toBe(false)
  })
})

describe('BusyMark', () => {
  it.each([
    ['running', null],
    ['waiting', null],
    ['done', 'svg'],
    ['failed', 'svg'],
    ['warning', 'svg'],
    ['skipped', '.dash']
  ] as const)('draws %s', (state, inner) => {
    const view = render(<BusyMark state={state} />)
    const mark = view.container.querySelector('.ui-busy-mark')
    expect(mark?.className).toContain(`is-${state}`)
    expect(mark?.getAttribute('data-state')).toBe(state)
    expect(mark?.getAttribute('aria-hidden')).toBe('true')
    if (inner) expect(mark?.querySelector(inner)).not.toBeNull()
    else expect(mark?.childElementCount).toBe(0)
  })

  it('names itself when given a label, and has a small size', () => {
    const view = render(<BusyMark state="waiting" size="sm" label="Waiting" />)
    const mark = view.getByRole('img', { name: 'Waiting' })
    expect(mark.className).toContain('is-sm')
    expect(mark.getAttribute('aria-hidden')).toBeNull()
  })
})

describe('BusyBar', () => {
  it('shows only while active and stays out of the accessibility tree', () => {
    const view = render(<BusyBar active />)
    expect(view.getByTestId('busy-bar').getAttribute('aria-hidden')).toBe('true')
    view.rerender(<BusyBar active={false} />)
    expect(view.queryByTestId('busy-bar')).toBeNull()
  })
})

describe('BusyLine', () => {
  it('counts the seconds with the usual time, the timer hidden from screen readers', () => {
    const view = render(<BusyLine active label="Waiting for CiteFox AI’s reply" usual={[5, 10]} />)
    advance(0)
    const line = view.container.querySelector('.ui-busy-line')
    expect(line?.querySelector('.ui-busy-mark.is-running')).not.toBeNull()
    expect(line?.querySelector('.ui-busy-label')?.textContent).toBe(
      'Waiting for CiteFox AI’s reply'
    )
    const time = line?.querySelector('.ui-busy-time')
    expect(time?.getAttribute('aria-hidden')).toBe('true')
    expect(time?.textContent).toBe('· 0 s · usually 5–10 s')
    advance(4_000)
    expect(time?.textContent).toBe('· 4 s · usually 5–10 s')
    expect(view.container.textContent).not.toContain(SLOW_TEXT)
  })

  it('says "Taking longer than usual…" after twice the usual time, with the given action', () => {
    const retry = vi.fn()
    const view = render(
      <BusyLine
        active
        label="Waiting for CiteFox AI’s reply"
        usual={[5, 10]}
        slowAction={<Button onClick={retry}>Check again</Button>}
      />
    )
    advance(19_000)
    expect(view.container.querySelector('.ui-busy-slow')).toBeNull()
    expect(view.queryByRole('button', { name: 'Check again' })).toBeNull()
    advance(1_000)
    expect(view.container.querySelector('.ui-busy-slow')?.textContent).toContain(SLOW_TEXT)
    // Said once, politely.
    expect(announcedText()).toBe(SLOW_TEXT)
    expect(view.container.querySelector('.ui-busy')?.getAttribute('data-slow')).toBe('true')
    fireEvent.click(view.getByRole('button', { name: 'Check again' }))
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('starts the clock again on each run and draws nothing while idle', () => {
    const view = render(<BusyLine active label="Testing" />)
    advance(7_000)
    expect(view.container.textContent).toContain('7 s')
    view.rerender(<BusyLine active={false} label="Testing" />)
    expect(view.container.innerHTML).toBe('')
    view.rerender(<BusyLine active label="Testing" />)
    advance(0)
    expect(view.container.textContent).toContain('0 s')
  })

  it('announces the start, the end and the slow turn once each, never the ticks', () => {
    const said: string[] = []
    const announce = (message: string): void => {
      said.push(message)
    }
    const view = render(
      <BusyLine
        active
        label="CiteFox AI is looking for more competitors"
        usual={[1, 2]}
        end="Done."
        announce={announce}
      />
    )
    advance(10_000)
    view.rerender(
      <BusyLine
        active={false}
        label="CiteFox AI is looking for more competitors"
        usual={[1, 2]}
        end="Done."
        announce={announce}
      />
    )
    expect(said).toEqual(['CiteFox AI is looking for more competitors…', SLOW_TEXT, 'Done.'])
  })

  it('uses the kit live region by default, and says nothing when told not to', () => {
    const view = render(<BusyLine active label="Testing your cloro key" />)
    expect(announcedText()).toBe('Testing your cloro key…')
    view.unmount()
    resetAnnouncerForTests()
    render(<BusyLine active label="Quiet" announce={false} />)
    expect(announcedText()).toBe('')
  })
})

describe('a working card', () => {
  it('marks the region aria-busy while it runs', () => {
    function Card({ busy }: { busy: boolean }): React.JSX.Element {
      return (
        <section className="ui-busy-host" aria-label="Key" aria-busy={busy || undefined}>
          <BusyBar active={busy} />
          <BusyLine active={busy} label="Testing your key" usual={[1, 3]} announce={false} />
        </section>
      )
    }
    const view = render(<Card busy />)
    const region = view.getByRole('region', { name: 'Key' })
    expect(region.getAttribute('aria-busy')).toBe('true')
    expect(region.querySelector('.ui-busy-bar')).not.toBeNull()
    view.rerender(<Card busy={false} />)
    expect(region.getAttribute('aria-busy')).toBeNull()
    expect(region.querySelector('.ui-busy-bar, .ui-busy')).toBeNull()
  })
})
