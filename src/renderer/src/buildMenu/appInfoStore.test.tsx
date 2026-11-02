// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import type { JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadAppInfo, resetAppInfoCache, useAppInfo } from './appInfoStore'

afterEach(() => {
  cleanup()
  resetAppInfoCache()
})

function Version({
  fetch
}: {
  fetch: () => Promise<{ name: string; version: string }>
}): JSX.Element {
  const info = useAppInfo(fetch)
  return <p>{info ? info.version : 'none'}</p>
}

describe('useAppInfo', () => {
  it('reads the app info once and shares it', async () => {
    const fetch = vi.fn(() => Promise.resolve({ name: 'CiteFox', version: '0.11.0' }))
    const view = render(
      <>
        <Version fetch={fetch} />
        <Version fetch={fetch} />
      </>
    )
    expect(await view.findAllByText('0.11.0')).toHaveLength(2)
    expect(fetch).toHaveBeenCalledTimes(1)
    await expect(loadAppInfo(fetch)).resolves.toEqual({ name: 'CiteFox', version: '0.11.0' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not cache a failed read', async () => {
    const failing = vi.fn(() => Promise.reject(new Error('no bridge')))
    await expect(loadAppInfo(failing)).rejects.toThrow('no bridge')
    const working = vi.fn(() => Promise.resolve({ name: 'CiteFox', version: '1.0.0' }))
    await expect(loadAppInfo(working)).resolves.toMatchObject({ version: '1.0.0' })
    expect(working).toHaveBeenCalledTimes(1)
  })

  it('shows nothing while the info cannot be read', () => {
    const view = render(<Version fetch={() => Promise.reject(new Error('no bridge'))} />)
    expect(view.getByText('none')).toBeTruthy()
  })
})
