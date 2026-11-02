/** Shared fixtures for the projects-at-scale handler tests. Test-only. */

import type { CreateProjectRequest } from '@shared/ipc'
import { fixtureResponse, harness, routingHttp } from '../../handlers/test-harness'
import type { HttpRequest, HttpResponse } from '../../providers/http'
import type { EngineHost } from '../host'

export function projectRequest(
  name: string,
  domain: string,
  extra: Partial<CreateProjectRequest> = {}
): CreateProjectRequest {
  return {
    name,
    domain,
    includeSubdomains: false,
    brandNames: [name],
    competitors: ['twilio.com'],
    clientName: null,
    country: 'US',
    language: 'en',
    location: null,
    device: 'desktop',
    ...extra
  }
}

/**
 * The handler harness with the opened engine host and every provider request kept.
 * `respond` answers a request first; unanswered requests use the shared routing fixtures.
 */
export function adminHarness(
  respond?: (request: HttpRequest) => HttpResponse | null
): ReturnType<typeof harness> & { host: () => EngineHost; requests: HttpRequest[] } {
  const requests: HttpRequest[] = []
  const routed = routingHttp()
  let host: EngineHost | null = null
  const opened = harness({
    http: {
      async request(request) {
        requests.push(request)
        const answer = respond?.(request) ?? null
        if (answer !== null) return answer
        return routed.request(request)
      }
    },
    onHost: (value) => {
      host = value
    }
  })
  return {
    ...opened,
    requests,
    host: () => {
      if (host === null) throw new Error('No host')
      return host
    }
  }
}

export function anthropicOk(): HttpResponse {
  return fixtureResponse('anthropic/messages-ok.json')
}
