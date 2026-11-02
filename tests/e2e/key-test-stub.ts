import type { ElectronApplication } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const FIXTURES = join(process.cwd(), 'src/main/providers/fixtures')

function recorded(file: string): { status: number; body: string } {
  const parsed = JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')) as {
    status: number
    body: unknown
  }
  return { status: parsed.status, body: JSON.stringify(parsed.body) }
}

/**
 * "Test and save" tests a key straight after `keys:add`. In e2e the main
 * process's `fetch` answers those tests from recorded bodies, so no key test
 * ever reaches SerpApi, cloro or Jina: SerpApi's account check
 * (account-ok.json), cloro's free `/v1/credits` (a 37,500-credit Lite plan)
 * and a Jina read (ok.json). Any other call to those hosts fails loudly.
 */
export async function stubKeyTests(app: ElectronApplication): Promise<void> {
  await app.evaluate(
    (_electron, bodies) => {
      const original = globalThis.fetch.bind(globalThis)
      const respond = (answer: { status: number; body: string }): Response =>
        new Response(answer.body, {
          status: answer.status,
          headers: { 'content-type': 'application/json' }
        })
      globalThis.fetch = async (
        input: RequestInfo | URL,
        init?: RequestInit
      ): Promise<Response> => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (url.startsWith('https://serpapi.com/account')) return respond(bodies.serpapi)
        if (url.startsWith('https://api.cloro.dev/v1/credits')) return respond(bodies.cloro)
        if (url.startsWith('https://r.jina.ai/')) return respond(bodies.jina)
        if (/^https:\/\/([a-z]+\.)?(serpapi\.com|cloro\.dev|jina\.ai)\//.test(url)) {
          return respond({ status: 500, body: JSON.stringify({ error: 'not recorded in e2e' }) })
        }
        return original(input, init)
      }
    },
    {
      serpapi: recorded('serpapi/account-ok.json'),
      cloro: {
        status: 200,
        body: JSON.stringify({ remaining: 37_500, perCycle: 37_500, cycleResetsAt: null })
      },
      jina: recorded('jina/ok.json')
    }
  )
}
