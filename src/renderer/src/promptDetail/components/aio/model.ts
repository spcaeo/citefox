import { createContext, useContext } from 'react'
import type { AioSource } from '@shared/aio-overview'
import type { BrandLens } from '@shared/brand-mentions'
import { isOwnHost } from '@shared/own-site'
import type { AioReference } from '@shared/domain'
import { pluralize } from '@shared/pluralize'
import { safeExternalUrl } from '../../../drill'

/** A Google reference with the name Google shows and, when CiteFox scored it, its source line. */
export interface SourceView {
  source: AioSource
  /** Site name, such as "Example Co". */
  name: string
  /** The scored reference with the same URL. Null when CiteFox has none. */
  reference: AioReference | null
}

/** Pairs each Google reference with the scored reference that has the same URL. */
export function sourceViews(
  sources: readonly AioSource[],
  references: readonly AioReference[]
): SourceView[] {
  const byUrl = new Map<string, AioReference>()
  for (const reference of references) {
    const key = urlKey(safeExternalUrl(reference.url))
    if (key && !byUrl.has(key)) byUrl.set(key, reference)
  }
  return sources.map((source) => {
    const reference = byUrl.get(urlKey(source.url) ?? '') ?? null
    return { source, name: sourceName(source, reference), reference }
  })
}

function urlKey(url: string | null): string | null {
  return url ? url.replace(/\/+$/, '') : null
}

function sourceName(source: AioSource, reference: AioReference | null): string {
  if (source.source) return source.source
  if (reference) return reference.domain
  if (source.url) return new URL(source.url).hostname.replace(/^www\./, '')
  return source.title ?? 'Source'
}

/**
 * True for a source on the own site: This page or another own page, as the check
 * classified it. A source the check did not score reads the same own-site rule.
 */
export function isOwnSource(view: SourceView, lens: BrandLens | null): boolean {
  if (view.reference) {
    const kind = view.reference.classification
    return kind === 'target' || kind === 'own'
  }
  if (lens === null || view.source.url === null) return false
  try {
    const host = new URL(view.source.url).hostname.toLowerCase().replace(/^www\./, '')
    return isOwnHost(host, lens.ownDomain, lens.includeSubdomains)
  } catch {
    return false
  }
}

/** The letter in the circle shown in place of a favicon (remote images are blocked by CSP). */
export function sourceLetter(name: string): string {
  const match = /[\p{L}\p{N}]/u.exec(name)
  return match ? match[0].toLocaleUpperCase('en-US') : '?'
}

/** One of five circle tints, the same for a name every time. */
export function sourceTint(name: string): number {
  let hash = 0
  for (const char of name.toLowerCase()) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 9973
  return hash % 5
}

/** "3 sources: Koha, Example Co, Twilio". Names repeat once only. */
export function citationLabel(views: readonly SourceView[]): string {
  const names = [...new Set(views.map((view) => view.name))]
  return `${pluralize(views.length, 'source')}: ${names.join(', ')}`
}

export function sameRefs(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

/** What a citation chip needs from the overview around it. */
export interface CitationContextValue {
  sources: ReadonlyMap<number, SourceView>
  /** The references the last clicked chip marked in the sources rail. */
  active: readonly number[]
  onCite: (refs: readonly number[]) => void
  /** Brand names and the own site, marked in yellow. Null marks nothing. */
  lens: BrandLens | null
}

export const CitationContext = createContext<CitationContextValue>({
  sources: new Map(),
  active: [],
  onCite: () => undefined,
  lens: null
})

export function useCitations(): CitationContextValue {
  return useContext(CitationContext)
}
