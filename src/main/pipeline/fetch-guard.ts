import { lookup } from 'node:dns/promises'
import { isIP, isIPv4 } from 'node:net'
import { PipelineError } from './errors'

/** Direct page fetches follow at most this many redirects, checking each hop. */
export const MAX_DIRECT_REDIRECTS = 5

/** Resolves a hostname to every address. Tests pass a fake so they stay offline. */
export interface AddressLookup {
  lookup(hostname: string): Promise<readonly string[]>
}

/** `dns.lookup` with `all: true`, so a mixed public and private answer is visible. */
export function systemAddressLookup(): AddressLookup {
  return {
    async lookup(hostname: string): Promise<readonly string[]> {
      const records = await lookup(hostname, { all: true, verbatim: true })
      return records.map((record) => record.address)
    }
  }
}

/**
 * True for a blocked literal. IPv6 forms that carry an IPv4 address
 * (IPv4-mapped `::ffff:a.b.c.d`, IPv4-compatible `::a.b.c.d`, NAT64
 * `64:ff9b::/96`, and 6to4 `2002::/16`) are judged by that IPv4 address.
 */
export function isBlockedAddress(address: string): boolean {
  if (isIPv4(address)) return isBlockedV4(address)
  if (isIP(address) === 6) return isBlockedV6(address)
  return true
}

/** Reject a blocked literal host or `localhost` without resolving DNS. */
export function rejectBlockedLiteral(pageUrl: string): void {
  const host = hostAddress(parseHttpUrl(pageUrl).hostname)
  if (isLocalHostName(host) || isBlockedLiteral(host)) throw blocked(host)
}

/**
 * Reject a direct-fetch URL whose host is a blocked literal or resolves to one.
 * One blocked address rejects the host, even when another address is public.
 */
export async function assertPublicPageUrl(pageUrl: string, resolve: AddressLookup): Promise<void> {
  rejectBlockedLiteral(pageUrl)
  await resolvePublicAddresses(hostAddress(parseHttpUrl(pageUrl).hostname), resolve)
}

/**
 * Every address `hostname` resolves to, after each one passed the guard.
 * The page transport connects only to these addresses (it does not resolve
 * DNS a second time), so a DNS answer that changes between the check and
 * the connection (rebinding) cannot reach a private address.
 */
export async function resolvePublicAddresses(
  hostname: string,
  resolve: AddressLookup
): Promise<string[]> {
  const host = hostAddress(hostname)
  if (isLocalHostName(host) || isBlockedLiteral(host)) throw blocked(host)
  if (isIP(host) !== 0) return [host]
  let addresses: readonly string[]
  try {
    addresses = await resolve.lookup(host)
  } catch {
    throw new PipelineError('The page host could not be resolved.', {
      code: 'fetch_failed',
      nextStep: 'Check the host name and read the page again.'
    })
  }
  if (addresses.length === 0 || addresses.some((address) => isBlockedAddress(address))) {
    throw blocked(host)
  }
  return [...addresses]
}

function blocked(host: string): PipelineError {
  return new PipelineError(
    `CiteFox will not read ${host} because it is a private or local address.`,
    {
      code: 'fetch_failed',
      nextStep: 'Use the public URL of the page and read again.'
    }
  )
}

function parseHttpUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new PipelineError('The page URL is not valid.', {
      code: 'fetch_failed',
      nextStep: 'Enter an http or https URL and read again.'
    })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new PipelineError('CiteFox only reads public http and https pages.', {
      code: 'fetch_failed',
      nextStep: 'Enter an http or https URL and read again.'
    })
  }
  if (url.username !== '' || url.password !== '') {
    throw new PipelineError('The page URL must not contain a password.', {
      code: 'fetch_failed',
      nextStep: 'Remove the username and password from the URL and read again.'
    })
  }
  return url
}

/** Node reports an IPv6 URL hostname with brackets. `dns` and `isIP` want them off. */
function hostAddress(hostname: string): string {
  const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  return bare.toLowerCase()
}

function isLocalHostName(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return host === 'localhost' || host.endsWith('.localhost')
}

function isBlockedLiteral(hostname: string): boolean {
  return isIP(hostname) !== 0 && isBlockedAddress(hostname)
}

function isBlockedV4(address: string): boolean {
  const parts = address.split('.')
  if (parts.length !== 4) return true
  const numbers = parts.map((part) => Number(part))
  if (numbers.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const a = numbers[0] ?? 0
  const b = numbers[1] ?? 0
  const c = numbers[2] ?? 0
  if (a === 0) return true // 0.0.0.0/8 "this network"
  if (a === 10) return true // private
  if (a === 127) return true // loopback
  if (a === 169 && b === 254) return true // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true // private
  if (a === 192 && b === 168) return true // private
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64/10
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true // IETF 192.0.0/24, TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking 198.18/15
  if (a === 198 && b === 51 && c === 100) return true // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true // TEST-NET-3
  if (a >= 224) return true // multicast 224/4, reserved 240/4, broadcast
  return false
}

function isBlockedV6(address: string): boolean {
  const groups = expandV6(address)
  if (groups === null) return true
  const embedded = embeddedV4(groups)
  if (embedded !== null) return isBlockedV4(embedded)
  if (groups.every((group) => group === 0)) return true // ::
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return true // ::1
  const first = groups[0] ?? 0
  const second = groups[1] ?? 0
  if (first === 0x64 && second === 0xff9b) return true // 64:ff9b:1::/48 local NAT64
  if (first === 0x0100 && groups.slice(1, 4).every((group) => group === 0)) return true // discard
  if (first === 0x2001 && second === 0) return true // Teredo 2001::/32
  if (first === 0x2001 && second === 0x0db8) return true // documentation
  if (first >= 0xfc00 && first <= 0xfdff) return true // unique local fc00::/7
  if (first >= 0xfe80 && first <= 0xfebf) return true // link-local fe80::/10
  if (first >= 0xfec0 && first <= 0xfeff) return true // site-local fec0::/10
  if (first >= 0xff00) return true // multicast ff00::/8
  return false
}

/**
 * The IPv4 address inside an IPv6 address, for the forms that route to it:
 * IPv4-mapped `::ffff:0:0/96`, IPv4-compatible `::/96` (except `::` and
 * `::1`), NAT64 `64:ff9b::/96`, and 6to4 `2002::/16`. Null otherwise.
 */
function embeddedV4(groups: readonly number[]): string | null {
  const word = (index: number): number => groups[index] ?? 0
  const zero = (from: number, to: number): boolean => groups.slice(from, to).every((g) => g === 0)
  if (zero(0, 5) && word(5) === 0xffff) return v4From(word(6), word(7))
  if (zero(0, 6) && (word(6) !== 0 || word(7) > 1)) return v4From(word(6), word(7))
  if (word(0) === 0x64 && word(1) === 0xff9b && zero(2, 6)) return v4From(word(6), word(7))
  if (word(0) === 0x2002) return v4From(word(1), word(2))
  return null
}

function v4From(hi: number, lo: number): string {
  return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`
}

/** Eight 16-bit groups, or null when the text is not an IPv6 address. */
function expandV6(address: string): number[] | null {
  let bare = address.toLowerCase().split('%')[0] ?? ''
  const dotted = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(bare)
  if (dotted?.[1] !== undefined && dotted[2] !== undefined) {
    if (!isIPv4(dotted[2])) return null
    const [a, b, c, d] = dotted[2].split('.').map((part) => Number(part))
    const hi = (((a ?? 0) << 8) | (b ?? 0)).toString(16)
    const lo = (((c ?? 0) << 8) | (d ?? 0)).toString(16)
    bare = `${dotted[1]}${hi}:${lo}`
  }
  const halves = bare.split('::')
  if (halves.length > 2) return null
  const parse = (value: string): number[] | null => {
    if (value.length === 0) return []
    const groups: number[] = []
    for (const part of value.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null
      groups.push(Number.parseInt(part, 16))
    }
    return groups
  }
  const left = parse(halves[0] ?? '')
  if (left === null) return null
  if (halves.length === 1) return left.length === 8 ? left : null
  const right = parse(halves[1] ?? '')
  if (right === null || left.length + right.length > 7) return null
  return [...left, ...Array<number>(8 - left.length - right.length).fill(0), ...right]
}
