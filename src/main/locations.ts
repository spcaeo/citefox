/**
 * One row of a SerpApi location list (FR-9.5).
 * `country` is matched as stored. `UK` does not match `GB`.
 */
export interface LocationMatch {
  country: string
  query: string
  canonicalName: string
}

/**
 * City matching for a market save. An empty catalogue, or no case-insensitive
 * hit in that country, is null: the city was not matched.
 */
export function matchSerpApiLocation(
  location: string | null,
  country: string,
  catalogue: readonly LocationMatch[]
): string | null {
  if (location === null) return null
  const needle = location.toLowerCase()
  const hit = catalogue.find(
    (entry) => entry.country === country && entry.query.toLowerCase() === needle
  )
  return hit?.canonicalName ?? null
}
