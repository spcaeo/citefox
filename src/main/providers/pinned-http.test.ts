import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, test } from 'vitest'
import { createFetchHttpTransport } from './http'
import { ResponseTooLargeError } from './pinned-http'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve())
        })
    )
  )
})

async function serve(
  handler: (request: IncomingMessage, response: ServerResponse) => void
): Promise<{ port: number; hosts: string[] }> {
  const hosts: string[] = []
  const server = createServer((request, response) => {
    hosts.push(request.headers.host ?? '')
    handler(request, response)
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { port: (server.address() as AddressInfo).port, hosts }
}

describe('pinned page transport', () => {
  test('connects to the validated address without asking DNS, and keeps the Host name', async () => {
    const { port, hosts } = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=windows-1252' })
      response.end(Buffer.from('<p>café</p>', 'latin1'))
    })
    const asked: string[] = []
    const response = await createFetchHttpTransport().request({
      method: 'GET',
      url: `http://pinned-only.invalid:${port}/page`,
      timeoutMs: 5_000,
      resolveHost: async (hostname) => {
        asked.push(hostname)
        return ['127.0.0.1']
      }
    })
    expect(asked).toEqual(['pinned-only.invalid'])
    expect(response.status).toBe(200)
    expect(hosts).toEqual([`pinned-only.invalid:${port}`])
    expect(response.headers?.['content-type']).toBe('text/html; charset=windows-1252')
    expect(Buffer.from(response.bytes ?? new Uint8Array()).toString('latin1')).toBe('<p>café</p>')
  })

  test('does not connect when the guard rejects the host', async () => {
    const { port, hosts } = await serve((_request, response) => {
      response.end('should not be reached')
    })
    await expect(
      createFetchHttpTransport().request({
        method: 'GET',
        url: `http://rebound.invalid:${port}/`,
        timeoutMs: 5_000,
        resolveHost: async () => {
          throw new Error('CiteFox will not read rebound.invalid because it is private.')
        }
      })
    ).rejects.toThrow(/will not read/)
    expect(hosts).toEqual([])
  })

  test('does not follow redirects', async () => {
    const { port } = await serve((_request, response) => {
      response.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' })
      response.end()
    })
    const response = await createFetchHttpTransport().request({
      method: 'GET',
      url: `http://hop.invalid:${port}/`,
      timeoutMs: 5_000,
      resolveHost: async () => ['127.0.0.1']
    })
    expect(response.status).toBe(302)
    expect(response.headers?.location).toBe('http://169.254.169.254/latest/meta-data')
  })

  test('stops reading past maxBodyBytes, including after gzip', async () => {
    const big = Buffer.alloc(2 * 1024 * 1024, 'a')
    const { port } = await serve((request, response) => {
      if (request.url === '/gzip') {
        response.writeHead(200, { 'content-encoding': 'gzip', 'content-type': 'text/html' })
        response.end(gzipSync(big))
        return
      }
      response.writeHead(200, { 'content-type': 'text/html' })
      response.write(big)
      response.end(big)
    })
    const transport = createFetchHttpTransport()
    for (const path of ['/plain', '/gzip']) {
      await expect(
        transport.request({
          method: 'GET',
          url: `http://big.invalid:${port}${path}`,
          timeoutMs: 5_000,
          maxBodyBytes: 1024 * 1024,
          resolveHost: async () => ['127.0.0.1']
        })
      ).rejects.toBeInstanceOf(ResponseTooLargeError)
    }
  })

  test('decompresses gzip within the cap', async () => {
    const { port } = await serve((_request, response) => {
      response.writeHead(200, { 'content-encoding': 'gzip', 'content-type': 'text/html' })
      response.end(gzipSync(Buffer.from('<h1>zipped</h1>')))
    })
    const response = await createFetchHttpTransport().request({
      method: 'GET',
      url: `http://zip.invalid:${port}/`,
      timeoutMs: 5_000,
      resolveHost: async () => ['127.0.0.1']
    })
    expect(response.body).toBe('<h1>zipped</h1>')
  })
})
