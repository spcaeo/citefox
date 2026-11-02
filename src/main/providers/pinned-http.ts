import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP, type LookupFunction } from 'node:net'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import type { Readable } from 'node:stream'
import { redactString } from '../logging/redact'
import { ProviderError, ProviderTimeoutError } from './errors'
import type { HttpRequest, HttpResponse } from './http'

/** Default response cap for a request that does not set `maxBodyBytes`. */
export const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024

export class ResponseTooLargeError extends ProviderError {
  constructor(label: string, maxBytes: number) {
    super(`${label} returned more than ${Math.round(maxBytes / 1024 / 1024)} MB.`, {
      code: 'network',
      state: 'warning',
      nextStep: 'Use a smaller page, or paste the page text instead.'
    })
    this.name = 'ResponseTooLargeError'
  }
}

/**
 * A GET or POST whose connection is pinned to the addresses
 * `request.resolveHost` returned. Node is given a `lookup` that answers from
 * that list, so it never asks DNS again between the guard's check and the
 * connect (DNS rebinding). TLS SNI and the Host header still use the URL
 * host name. Redirects are not followed; the caller re-checks each hop.
 * The body is streamed and cut off past `maxBodyBytes` (after decompression).
 */
export async function pinnedHttpRequest(
  request: HttpRequest,
  label: string
): Promise<HttpResponse> {
  const resolveHost = request.resolveHost
  if (resolveHost === undefined) {
    throw new ProviderError('A pinned request needs resolveHost.', {
      code: 'network',
      state: 'warning',
      nextStep: 'Try again.'
    })
  }
  const url = new URL(request.url)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ProviderError(`Only http and https are fetched, not ${url.protocol}`, {
      code: 'network',
      state: 'warning',
      nextStep: 'Use an http or https URL.'
    })
  }
  const host = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname
  const addresses = await resolveHost(host)
  const first = addresses[0]
  if (first === undefined) {
    throw new ProviderError(`No address for ${label}.`, {
      code: 'network',
      state: 'warning',
      nextStep: 'Check the host name and try again.'
    })
  }
  const maxBytes = request.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest
  return new Promise<HttpResponse>((resolve, reject) => {
    let settled = false
    const fail = (error: unknown): void => {
      if (settled) return
      settled = true
      reject(error)
    }
    const client = send(
      url,
      {
        method: request.method,
        headers: { 'accept-encoding': 'gzip, deflate, br', ...request.headers },
        lookup: pinnedLookup(addresses),
        signal: request.signal
      },
      (response) => {
        readBody(response, maxBytes, label).then(
          (bytes) => {
            if (settled) return
            settled = true
            resolve({
              status: response.statusCode ?? 0,
              body: Buffer.from(bytes).toString('utf8'),
              bytes,
              headers: flatHeaders(response)
            })
          },
          (error: unknown) => {
            client.destroy()
            fail(error)
          }
        )
      }
    )
    client.on('error', (error) => {
      if (request.signal?.aborted) {
        fail(new ProviderTimeoutError(label, request.timeoutMs))
        return
      }
      fail(
        new ProviderError(`Network request failed for ${label}: ${redactString(error.message)}`, {
          code: 'network',
          state: 'warning',
          nextStep: 'Check the network and try again.'
        })
      )
    })
    client.end(request.body)
  })
}

/** `lookup` that answers only from the validated list (both callback shapes). */
function pinnedLookup(addresses: readonly string[]): LookupFunction {
  return (_hostname, options, callback) => {
    const entries = addresses.map((address) => ({ address, family: isIP(address) }))
    const wanted = options.family === 4 || options.family === 6 ? options.family : 0
    const usable = wanted === 0 ? entries : entries.filter((entry) => entry.family === wanted)
    const chosen = usable[0]
    if (chosen === undefined) {
      const error: NodeJS.ErrnoException = new Error('No validated address for this family')
      error.code = 'ENOTFOUND'
      callback(error, '', 0)
      return
    }
    if (options.all === true) {
      callback(null, usable)
      return
    }
    callback(null, chosen.address, chosen.family)
  }
}

function decoded(response: IncomingMessage): Readable {
  const encoding = String(response.headers['content-encoding'] ?? '')
    .trim()
    .toLowerCase()
  if (encoding === 'gzip' || encoding === 'x-gzip') return response.pipe(createGunzip())
  if (encoding === 'deflate') return response.pipe(createInflate())
  if (encoding === 'br') return response.pipe(createBrotliDecompress())
  return response
}

function readBody(response: IncomingMessage, maxBytes: number, label: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    let done = false
    const fail = (error: unknown): void => {
      if (done) return
      done = true
      reject(error)
    }
    const declared = Number(response.headers['content-length'])
    if (Number.isFinite(declared) && declared > maxBytes) {
      fail(new ResponseTooLargeError(label, maxBytes))
      response.destroy()
      return
    }
    const stream = decoded(response)
    const chunks: Buffer[] = []
    let total = 0
    stream.on('data', (chunk: Buffer) => {
      if (done) return
      total += chunk.length
      if (total > maxBytes) {
        fail(new ResponseTooLargeError(label, maxBytes))
        stream.destroy()
        response.destroy()
        return
      }
      chunks.push(chunk)
    })
    stream.on('end', () => {
      if (done) return
      done = true
      resolve(Uint8Array.from(Buffer.concat(chunks)))
    })
    stream.on('error', fail)
    response.on('aborted', () => fail(new Error('The response was cut off.')))
  })
}

function flatHeaders(response: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(response.headers)) {
    if (value === undefined) continue
    headers[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value
  }
  return headers
}
