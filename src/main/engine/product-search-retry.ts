import type { ProductCompetitorsRequest, ProductCompetitorsResult } from '@shared/ipc'
import { IpcRequestError } from '../ipc-request'
import { getProject } from '../storage/records'
import { competitorsByProduct } from './competitors-by-product'
import type { EngineHost } from './host'
import { homepageReader } from './site-page'

/**
 * `projects:searchProductCompetitors`: setup step 3's "Try again" for one product whose
 * web search did not finish. The same question, guard and domain check as Fill from my
 * website (`competitorsByProduct`), for this one product only; the product keeps its id,
 * so its competitors land under the line the screen already shows. Nothing is saved.
 */
export async function searchProductCompetitors(
  host: EngineHost,
  request: ProductCompetitorsRequest
): Promise<ProductCompetitorsResult> {
  const channel = 'projects:searchProductCompetitors'
  if (request.projectId !== null && getProject(host.storage.db, request.projectId) === null) {
    throw new IpcRequestError(channel, 'That project was not found')
  }
  let note: string | null = null
  const found = await competitorsByProduct(host, {
    channel,
    projectId: request.projectId,
    domain: request.domain,
    summary: request.summary,
    products: [{ ...request.product, evidence: null }],
    market: request.market,
    comparedWith: request.comparedWith,
    brandNames: request.brandNames,
    notCompetitors: request.notCompetitors,
    readHomepage: homepageReader(host),
    onSearch: (event) => {
      if (event.state === 'failed') note = event.note
    }
  })
  const ok = found.products[0]?.searchNote === null
  return {
    productId: request.product.id,
    ok,
    competitors: found.competitors,
    note: ok ? null : (note ?? 'Claude did not finish this search.')
  }
}
