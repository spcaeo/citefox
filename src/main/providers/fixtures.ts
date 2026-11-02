import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ProviderError } from './errors'
import type { HttpRequest, HttpResponse, HttpTransport } from './http'

const FIXTURE_NAME = /^[a-z0-9/-]+\.(json|txt)$/

/**
 * SERP-5 and NFR-9. A developer or test passes a directory of recorded
 * responses. The app does not read fixtures unless that directory is set.
 * AppSettings has no fixtures field yet (see the PR contract notes).
 */
export interface FixtureSource {
  read(name: string): string
}

export function createFileFixtureSource(directory: string): FixtureSource {
  return {
    read(name: string): string {
      if (!FIXTURE_NAME.test(name)) {
        throw new ProviderError('Invalid fixture name', {
          code: 'validation',
          state: 'warning',
          nextStep: 'Choose a recorded fixture file.'
        })
      }
      return readFileSync(join(directory, name), 'utf8')
    }
  }
}

export interface FixtureEnvelope {
  status: number
  body: unknown
}

export function readFixtureEnvelope(source: FixtureSource, name: string): FixtureEnvelope {
  const parsed: unknown = JSON.parse(source.read(name))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ProviderError(`Fixture ${name} is not a JSON object`, {
      code: 'malformed',
      state: 'warning',
      nextStep: 'Replace the recorded fixture.'
    })
  }
  const record = parsed as Record<string, unknown>
  if (typeof record.status !== 'number' || !('body' in record)) {
    throw new ProviderError(`Fixture ${name} is missing status or body`, {
      code: 'malformed',
      state: 'warning',
      nextStep: 'Replace the recorded fixture.'
    })
  }
  return { status: record.status, body: record.body }
}

/** Replays one recorded HTTP body. No socket is opened. */
export function createFixtureHttpTransport(
  source: FixtureSource,
  select: (request: HttpRequest) => string
): HttpTransport {
  return {
    async request(request: HttpRequest): Promise<HttpResponse> {
      const envelope = readFixtureEnvelope(source, select(request))
      return { status: envelope.status, body: JSON.stringify(envelope.body) }
    }
  }
}
