/**
 * Products and competitors by product (Docs/PROMPT-AUDIT.md section 2.3, package PC).
 * Settings › General edits the catalog; the page header and the topic wizard pick the
 * product a page or a topic is about.
 */

import type { ProductCompetitor, ProjectProduct } from '../domain'
import { invokeWith, type InvokeChannelSpecs } from './contract'
import type { HelpFillEstimate } from './helpfill'
import type { FillFromWebsiteResult } from './projects'

/** `products:get` and every catalog write. */
export interface ProductCatalogView {
  projectId: string
  products: readonly ProjectProduct[]
  /** One row per competitor per product; `productId` null is the whole business. */
  competitors: readonly ProductCompetitor[]
}

export interface ProductsProjectRequest {
  projectId: string
}

/**
 * `products:save`: replaces the products and every competitor row. The flat competitor
 * list is rewritten as their union. A page pinned to a removed product goes back to
 * automatic.
 */
export interface SaveProductCatalogRequest {
  projectId: string
  products: readonly ProjectProduct[]
  competitors: readonly ProductCompetitor[]
}

/**
 * `products:saveFill`: saves a Fill from my website read's products, and its competitors
 * that are in the project's saved list, by product (New project, after create).
 */
export interface SaveFillProductsRequest {
  projectId: string
  fill: Pick<FillFromWebsiteResult, 'products' | 'competitors'>
}

export interface PageProductRequest {
  projectId: string
  /** A page id, or a topic's id (a topic is a page row). */
  pageId: string
}

/** `products:page` and `products:setPage`. */
export interface PageProductView {
  pageId: string
  /** The product prompts use. Null: the whole business. */
  productId: string | null
  /** True when picked; false when automatic. */
  pinned: boolean
  /** What automatic picks, and why. */
  suggestedId: string | null
  reason: string
  products: readonly ProjectProduct[]
}

/**
 * `products:setPage`: `mode` `auto` returns the page to automatic; `pick` pins
 * `productId` (null pins "whole business").
 */
export interface SetPageProductRequest {
  projectId: string
  pageId: string
  mode: 'auto' | 'pick'
  productId: string | null
}

/**
 * `products:fillRow`: CiteFox AI writes the job (and the matching tracked page) for a
 * product the person added by name only. Nothing is saved; the renderer saves.
 */
export interface FillProductRowRequest {
  projectId: string
  name: string
}

export interface FillProductRowResult {
  /** '' when CiteFox AI did not know the product. */
  job: string
  /** A tracked page path of the project, or null. */
  evidencePath: string | null
}

export const productsChannels = {
  'products:get': invokeWith<ProductsProjectRequest, ProductCatalogView>(),
  'products:save': invokeWith<SaveProductCatalogRequest, ProductCatalogView>(),
  'products:saveFill': invokeWith<SaveFillProductsRequest, ProductCatalogView>(),
  'products:page': invokeWith<PageProductRequest, PageProductView>(),
  'products:setPage': invokeWith<SetPageProductRequest, PageProductView>(),
  /** Is CiteFox AI ready for this project's product fill? Never calls the AI. */
  'products:fillEstimate': invokeWith<ProductsProjectRequest, HelpFillEstimate>(),
  'products:fillRow': invokeWith<FillProductRowRequest, FillProductRowResult>()
} as const satisfies InvokeChannelSpecs
