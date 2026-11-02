// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ChangeLedger } from '@shared/ipc'
import { SpeedChart } from './SpeedChart'

afterEach(() => {
  cleanup()
})

describe('How fast changes get cited', () => {
  it('with no live change, shows the empty state instead of empty bars and "0 of 0"', () => {
    const ledger = { rows: [] } as unknown as ChangeLedger
    const view = render(<SpeedChart ledger={ledger} />)
    expect(view.getByText('No live changes yet.')).toBeTruthy()
    expect(view.queryByRole('list')).toBeNull()
    expect(view.container.textContent).not.toMatch(/0 of 0/)
  })
})
