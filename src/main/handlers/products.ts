/** Products and competitors by product (Docs/PROMPT-AUDIT.md section 2.3, package PC). */

import type { ProductCompetitor, ProjectProduct } from '@shared/domain'
import type {
  FillFromWebsiteResult,
  IpcHandlersFor,
  PageProductView,
  ProductCatalogView,
  productsChannels,
  SetPageProductRequest
} from '@shared/ipc'
import { knownOutline, type SiteOutline } from '../engine/site-outline'
import { withProject } from '../engine/project-db'
import { readHelpFillContext } from '../helpfill/context'
import { rowFillDef } from '../onboarding/row-fill/defs'
import { estimateRowFill, runRowFill } from '../onboarding/row-fill/service'
import { resolvePageProduct, saveFillCatalog } from '../engine/products'
import { IpcRequestError } from '../ipc-request'
import type { SqliteDatabase } from '../storage/database'
import {
  listProducts,
  readProductCatalog,
  replaceProductCatalog,
  setPageProduct
} from '../storage/products'
import { guard, type EngineContext } from './context'

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/

export function productsHandlers(ctx: EngineContext): IpcHandlersFor<typeof productsChannels> {
  return {
    'products:get': (request) =>
      guard('products:get', ctx, () => {
        const projectId = projectIdOf('products:get', request)
        return withProject(ctx, projectId, 'products:get', ({ db }) => view(db, projectId))
      }),
    'products:save': (request) =>
      guard('products:save', ctx, () => {
        const channel = 'products:save'
        const record = recordOf(channel, request)
        const projectId = projectIdOf(channel, record)
        const products = listOf(channel, record.products) as unknown as ProjectProduct[]
        const competitors = listOf(channel, record.competitors) as unknown as ProductCompetitor[]
        return withProject(ctx, projectId, channel, ({ db }) => {
          // Storage checks every field (ids, names, tiers, domains, sources).
          replaceProductCatalog(db, { products, competitors })
          return view(db, projectId)
        })
      }),
    'products:saveFill': (request) =>
      guard('products:saveFill', ctx, () => {
        const channel = 'products:saveFill'
        const record = recordOf(channel, request)
        const projectId = projectIdOf(channel, record)
        const fill = recordOf(channel, record.fill)
        const products = listOf(channel, fill.products ?? [])
        const competitors = listOf(channel, fill.competitors)
        return withProject(ctx, projectId, channel, ({ db }) => {
          saveFillCatalog(db, {
            products: products as unknown as FillFromWebsiteResult['products'],
            competitors: competitors as unknown as FillFromWebsiteResult['competitors']
          })
          return view(db, projectId)
        })
      }),
    'products:page': (request) =>
      guard('products:page', ctx, () => {
        const channel = 'products:page'
        const record = recordOf(channel, request)
        const projectId = projectIdOf(channel, record)
        const pageId = idOf(channel, record.pageId)
        return withProject(ctx, projectId, channel, ({ db }) => pageView(db, channel, pageId))
      }),
    'products:setPage': (request) =>
      guard('products:setPage', ctx, () => {
        const channel = 'products:setPage'
        const parsed = parseSetPage(channel, request)
        return withProject(ctx, parsed.projectId, channel, ({ db }) => {
          setPageProduct(db, parsed.pageId, parsed.productId, parsed.mode === 'pick')
          return pageView(db, channel, parsed.pageId)
        })
      }),
    'products:fillEstimate': (request) =>
      guard('products:fillEstimate', ctx, () => {
        const channel = 'products:fillEstimate'
        const projectId = projectIdOf(channel, request)
        return withProject(ctx, projectId, channel, () => estimateRowFill(ctx, projectId))
      }),
    'products:fillRow': (request) =>
      guard('products:fillRow', ctx, async () => {
        const channel = 'products:fillRow'
        const record = recordOf(channel, request)
        const projectId = idOf(channel, record.projectId)
        const name = nameOf(channel, record.name)
        // Read the project once and close its file before the AI call.
        const input = await withProject(ctx, projectId, channel, ({ db, project }) => {
          const context = readHelpFillContext(db, project, null)
          const known = knownOutline(ctx, project.domain)
          const site: SiteOutline = {
            pages: [
              ...(context.pages ?? []).map((page) => ({ path: page.path, title: page.name })),
              ...(known?.pages ?? [])
            ],
            menu: known?.menu ?? []
          }
          return {
            name,
            domain: project.domain,
            summary: '',
            brands: context.brands,
            examples: listProducts(db)
              .filter((item) => item.job.trim().length > 0)
              .map((item) => ({ name: item.name, detail: item.job, url: null, tag: null })),
            site
          }
        })
        const filled = await runRowFill(
          ctx,
          channel,
          projectId,
          rowFillDef('products'),
          name,
          input
        )
        return { job: filled.detail, evidencePath: filled.url }
      })
  }
}

function nameOf(channel: string, value: unknown): string {
  if (typeof value !== 'string') throw new IpcRequestError(channel)
  const name = value.replace(/\s+/gu, ' ').trim()
  if (name.length === 0 || name.length > 200) throw new IpcRequestError(channel)
  return name
}

function view(db: SqliteDatabase, projectId: string): ProductCatalogView {
  return { projectId, ...readProductCatalog(db) }
}

function pageView(db: SqliteDatabase, channel: string, pageId: string): PageProductView {
  const products = listProducts(db)
  const resolved = resolvePageProduct(db, pageId, products)
  if (resolved === null) throw new IpcRequestError(channel, 'That page was not found')
  return { ...resolved, products }
}

function parseSetPage(channel: string, request: unknown): SetPageProductRequest {
  const record = recordOf(channel, request)
  const mode = record.mode
  if (mode !== 'auto' && mode !== 'pick') throw new IpcRequestError(channel)
  const productId = record.productId === null ? null : idOf(channel, record.productId)
  return {
    projectId: projectIdOf(channel, record),
    pageId: idOf(channel, record.pageId),
    mode,
    productId
  }
}

function recordOf(channel: string, value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IpcRequestError(channel)
  }
  return value as Record<string, unknown>
}

function projectIdOf(channel: string, value: unknown): string {
  return idOf(channel, recordOf(channel, value).projectId)
}

function idOf(channel: string, value: unknown): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new IpcRequestError(channel)
  return value
}

function listOf(channel: string, value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > 500) throw new IpcRequestError(channel)
  return value.map((item) => recordOf(channel, item))
}
