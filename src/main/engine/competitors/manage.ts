import { competitorDomainOf, type ProductCompetitor } from '@shared/domain'
import type {
  CompetitorChangeResult,
  CompetitorsList,
  MergeCompetitorsRequest,
  RemoveCompetitorsRequest,
  RestoreCompetitorsRequest,
  SaveCompetitorRequest,
  SavedCompetitor,
  SetSiteKindRequest,
  SetSiteKindResult
} from '@shared/ipc'
import { IpcRequestError } from '../../ipc-request'
import type { SqliteDatabase } from '../../storage/database'
import { listProductCompetitors, listProducts, replaceProductCatalog } from '../../storage/products'
import { readProjectProfile } from '../../storage/project-profile'
import { saveSiteKinds } from '../../storage/site-kinds'
import { competitorKey, siteId } from './tally'

/**
 * Competitor CRUD on the saved rows (`product_competitors`, one per company per
 * product). A company is every row with the same name; its id is the Competitors row
 * id (`siteId(competitorKey(name))`), so the screen, the drawer and the URL share it.
 * Every change keeps the competitors as they were before under an undo token for this
 * app session, and `restore` puts them back.
 */

/** Undo tokens kept per manager, oldest dropped first. */
const MAX_UNDO = 20

export interface CompetitorManager {
  list(db: SqliteDatabase, projectId: string): CompetitorsList
  save(db: SqliteDatabase, request: SaveCompetitorRequest): CompetitorChangeResult
  remove(db: SqliteDatabase, request: RemoveCompetitorsRequest): CompetitorChangeResult
  merge(db: SqliteDatabase, request: MergeCompetitorsRequest): CompetitorChangeResult
  restore(db: SqliteDatabase, request: RestoreCompetitorsRequest): CompetitorsList
  setSiteKind(db: SqliteDatabase, request: SetSiteKindRequest, now: string): SetSiteKindResult
}

export function competitorIdOf(name: string): string {
  return siteId(competitorKey(name))
}

export function createCompetitorManager(createId: () => string): CompetitorManager {
  const undo = new Map<string, { projectId: string; rows: ProductCompetitor[] }>()

  function remember(projectId: string, rows: ProductCompetitor[]): string {
    const token = `undo-${createId()}`
    undo.set(token, { projectId, rows })
    while (undo.size > MAX_UNDO) {
      const oldest = undo.keys().next().value
      if (oldest === undefined) break
      undo.delete(oldest)
    }
    return token
  }

  function write(db: SqliteDatabase, rows: readonly ProductCompetitor[]): void {
    replaceProductCatalog(db, { products: listProducts(db), competitors: [...rows] })
  }

  function list(db: SqliteDatabase, projectId: string): CompetitorsList {
    return {
      projectId,
      competitors: companies(savedRows(db)),
      products: listProducts(db).map((product) => ({ id: product.id, name: product.name }))
    }
  }

  function save(db: SqliteDatabase, request: SaveCompetitorRequest): CompetitorChangeResult {
    const channel = 'competitors:save'
    const before = savedRows(db)
    const products = new Set(listProducts(db).map((product) => product.id))
    for (const id of request.productIds ?? []) {
      if (id !== null && !products.has(id)) {
        throw new IpcRequestError(channel, 'That product is not in this project')
      }
    }
    const others =
      request.id === null ? before : before.filter((row) => !isCompany(row, request.id))
    const clash = others.find(
      (row) =>
        competitorIdOf(row.name) === competitorIdOf(request.name) ||
        (request.domain !== null && domainsOf(row).includes(request.domain))
    )
    if (clash !== undefined) {
      throw new IpcRequestError(channel, `${clash.name} is already a saved competitor`)
    }
    const own = request.id === null ? [] : before.filter((row) => isCompany(row, request.id))
    if (request.id !== null && own.length === 0) {
      throw new IpcRequestError(channel, 'That competitor was not found')
    }
    const productIds =
      request.productIds ?? (own.length > 0 ? own.map((row) => row.productId) : [null])
    const rows = productIds.map((productId): ProductCompetitor => {
      const kept = own.find((row) => row.productId === productId)
      return {
        name: request.name,
        domain: request.domain,
        productId,
        tier: request.tier,
        startingPrice: kept?.startingPrice ?? null,
        sources: kept?.sources ?? [],
        aliases: request.aliases
      }
    })
    const at = own.length > 0 ? before.indexOf(own[0] as ProductCompetitor) : before.length
    const next = [...others]
    next.splice(Math.min(at, next.length), 0, ...rows)
    const undoToken = remember(request.projectId, before)
    write(db, next)
    return {
      competitor:
        companies(savedRows(db)).find((item) => item.id === competitorIdOf(request.name)) ?? null,
      names: [request.name],
      undoToken
    }
  }

  function remove(db: SqliteDatabase, request: RemoveCompetitorsRequest): CompetitorChangeResult {
    const before = savedRows(db)
    const gone = before.filter((row) => request.ids.includes(competitorIdOf(row.name)))
    if (gone.length === 0) {
      throw new IpcRequestError('competitors:remove', 'Those competitors were not found')
    }
    const undoToken = remember(request.projectId, before)
    write(
      db,
      before.filter((row) => !gone.includes(row))
    )
    return { competitor: null, names: uniqueNames(gone), undoToken }
  }

  function merge(db: SqliteDatabase, request: MergeCompetitorsRequest): CompetitorChangeResult {
    const channel = 'competitors:merge'
    const before = savedRows(db)
    const into = before.filter((row) => isCompany(row, request.intoId))
    const first = into[0]
    if (first === undefined) throw new IpcRequestError(channel, 'That competitor was not found')
    const merging = before.filter(
      (row) => request.ids.includes(competitorIdOf(row.name)) && !into.includes(row)
    )
    if (merging.length === 0) {
      throw new IpcRequestError(channel, 'Pick two or more competitors to merge')
    }
    const name = request.name ?? first.name
    const domain = first.domain ?? merging.find((row) => row.domain !== null)?.domain ?? null
    const aliases = [...new Set([...into, ...merging].flatMap(domainsOf))].filter(
      (host) => host !== domain
    )
    const tier = [...into, ...merging].some((row) => row.tier === 'direct') ? 'direct' : 'partial'
    const productIds = [...new Set([...into, ...merging].map((row) => row.productId))]
    const merged = productIds.map((productId): ProductCompetitor => {
      const kept =
        into.find((row) => row.productId === productId) ??
        merging.find((row) => row.productId === productId)
      return {
        name,
        domain,
        productId,
        tier,
        startingPrice: kept?.startingPrice ?? null,
        sources: kept?.sources ?? [],
        aliases
      }
    })
    const at = before.indexOf(first)
    const rest = before.filter((row) => !into.includes(row) && !merging.includes(row))
    const ahead = before.slice(0, at).filter((row) => rest.includes(row)).length
    rest.splice(ahead, 0, ...merged)
    const undoToken = remember(request.projectId, before)
    write(db, rest)
    return {
      competitor: companies(savedRows(db)).find((item) => item.id === competitorIdOf(name)) ?? null,
      names: uniqueNames(merging),
      undoToken
    }
  }

  function restore(db: SqliteDatabase, request: RestoreCompetitorsRequest): CompetitorsList {
    const kept = undo.get(request.undoToken)
    if (kept === undefined || kept.projectId !== request.projectId) {
      throw new IpcRequestError('competitors:restore', 'That change can no longer be undone')
    }
    const products = new Set(listProducts(db).map((product) => product.id))
    write(
      db,
      kept.rows.filter((row) => row.productId === null || products.has(row.productId))
    )
    undo.delete(request.undoToken)
    return list(db, request.projectId)
  }

  function setSiteKind(
    db: SqliteDatabase,
    request: SetSiteKindRequest,
    now: string
  ): SetSiteKindResult {
    saveSiteKinds(db, [{ domain: request.domain, kind: request.kind }], now)
    return { domain: request.domain, kind: request.kind }
  }

  return { list, save, remove, merge, restore, setSiteKind }
}

/**
 * The saved rows. A project file whose rows are missing reads its flat list as rows
 * for the whole business (as `competitorContext` does), so the first edit writes them.
 */
function savedRows(db: SqliteDatabase): ProductCompetitor[] {
  const rows = listProductCompetitors(db)
  if (rows.length > 0) return rows
  const flat = readProjectProfile(db)?.competitors ?? []
  const seen = new Set<string>()
  return flat.flatMap((entry): ProductCompetitor[] => {
    const name = entry.trim()
    const id = competitorIdOf(name)
    if (name.length === 0 || seen.has(id)) return []
    seen.add(id)
    return [
      {
        name,
        domain: competitorDomainOf(name),
        productId: null,
        tier: 'direct',
        startingPrice: null,
        sources: []
      }
    ]
  })
}

function isCompany(row: ProductCompetitor, id: string | null): boolean {
  return id !== null && competitorIdOf(row.name) === id
}

function domainsOf(row: ProductCompetitor): string[] {
  return [...(row.domain === null ? [] : [row.domain]), ...(row.aliases ?? [])]
}

function uniqueNames(rows: readonly ProductCompetitor[]): string[] {
  return [...new Set(rows.map((row) => row.name))]
}

/** Rows grouped by company, in saved order. */
function companies(rows: readonly ProductCompetitor[]): SavedCompetitor[] {
  const order: string[] = []
  const found = new Map<
    string,
    SavedCompetitor & { aliases: string[]; productIds: (string | null)[] }
  >()
  for (const row of rows) {
    const id = competitorIdOf(row.name)
    const current = found.get(id)
    if (current === undefined) {
      order.push(id)
      found.set(id, {
        id,
        name: row.name,
        domain: row.domain,
        aliases: [...(row.aliases ?? [])],
        tier: row.tier,
        productIds: [row.productId]
      })
      continue
    }
    if (row.tier === 'direct') current.tier = 'direct'
    if (current.domain === null) current.domain = row.domain
    for (const host of domainsOf(row)) {
      if (host !== current.domain && !current.aliases.includes(host)) current.aliases.push(host)
    }
    if (!current.productIds.includes(row.productId)) current.productIds.push(row.productId)
  }
  return order.flatMap((id) => {
    const item = found.get(id)
    return item === undefined ? [] : [item]
  })
}
