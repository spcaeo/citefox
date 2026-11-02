import { describe, expect, test } from 'vitest'
import { PipelineError } from './errors'
import { assertPublicPageUrl, isBlockedAddress, resolvePublicAddresses } from './fetch-guard'

describe('blocked addresses', () => {
  test.each([
    '0.0.0.0',
    '0.255.255.255',
    '10.0.0.1',
    '127.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '100.127.255.255',
    '::',
    '::1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'febf::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:a9fe:a9fe',
    '198.18.0.1',
    '198.19.255.255',
    '224.0.0.1',
    '239.255.255.250',
    '240.0.0.1',
    '255.255.255.255',
    '192.0.0.8',
    '192.0.2.1',
    '198.51.100.7',
    '203.0.113.9',
    '64:ff9b::7f00:1',
    '64:ff9b::a00:1',
    '64:ff9b::127.0.0.1',
    '64:ff9b:1::1',
    '2002:7f00:1::1',
    '2002:c0a8:101::1',
    'fec0::1',
    'feff::1',
    'ff02::1',
    '2001:db8::1',
    '2001::1',
    '::127.0.0.1',
    '::7f00:1',
    '100::1'
  ])('blocks %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true)
  })

  test.each([
    '8.8.8.8',
    '1.1.1.1',
    '172.15.0.1',
    '172.32.0.1',
    '100.63.0.1',
    '100.128.0.1',
    '198.17.255.255',
    '198.20.0.1',
    '223.255.255.255',
    '64:ff9b::808:808',
    '64:ff9b::8.8.8.8',
    '2002:808:808::1',
    '2001:4860:4860::8888'
  ])('allows %s', (address) => {
    expect(isBlockedAddress(address)).toBe(false)
  })

  test('rejects a host when any resolved address is blocked', async () => {
    await expect(
      assertPublicPageUrl('https://mixed.example/page', {
        async lookup(): Promise<readonly string[]> {
          return ['8.8.8.8', '10.0.0.1']
        }
      })
    ).rejects.toBeInstanceOf(PipelineError)
  })

  test('allows a host that resolves only to a public address', async () => {
    await expect(
      assertPublicPageUrl('https://public.example/page', {
        async lookup(): Promise<readonly string[]> {
          return ['8.8.8.8']
        }
      })
    ).resolves.toBeUndefined()
  })
})

describe('resolvePublicAddresses', () => {
  test('returns every validated address so the connection can be pinned to them', async () => {
    await expect(
      resolvePublicAddresses('public.example', {
        async lookup(): Promise<readonly string[]> {
          return ['8.8.8.8', '2001:4860:4860::8888']
        }
      })
    ).resolves.toEqual(['8.8.8.8', '2001:4860:4860::8888'])
  })

  test('rejects a blocked literal, a private answer, and an empty answer', async () => {
    const never = {
      async lookup(): Promise<readonly string[]> {
        throw new Error('must not resolve a literal')
      }
    }
    await expect(resolvePublicAddresses('10.0.0.1', never)).rejects.toBeInstanceOf(PipelineError)
    await expect(resolvePublicAddresses('localhost', never)).rejects.toBeInstanceOf(PipelineError)
    await expect(resolvePublicAddresses('8.8.4.4', never)).resolves.toEqual(['8.8.4.4'])
    await expect(
      resolvePublicAddresses('nat64.example', {
        async lookup(): Promise<readonly string[]> {
          return ['64:ff9b::a9fe:a9fe']
        }
      })
    ).rejects.toBeInstanceOf(PipelineError)
    await expect(
      resolvePublicAddresses('empty.example', {
        async lookup(): Promise<readonly string[]> {
          return []
        }
      })
    ).rejects.toBeInstanceOf(PipelineError)
  })
})
