/**
 * Pages whose overviews Claude is reading right now, from a check's report
 * step or a re-read. One per process, so the Sentiment tab can say "reading"
 * whichever path started it. Counted, because both paths may overlap.
 */
const reading = new Map<string, number>()

function key(projectId: string, pageId: string): string {
  return `${projectId}\0${pageId}`
}

export function startReading(projectId: string, pageId: string): () => void {
  const name = key(projectId, pageId)
  reading.set(name, (reading.get(name) ?? 0) + 1)
  let done = false
  return () => {
    if (done) return
    done = true
    const left = (reading.get(name) ?? 1) - 1
    if (left <= 0) reading.delete(name)
    else reading.set(name, left)
  }
}

/** Every page of the project: a check's report step, before it knows which pages it reads. */
export const ALL_PAGES = '*'

export function isReading(projectId: string, pageId: string): boolean {
  return (
    (reading.get(key(projectId, pageId)) ?? 0) > 0 ||
    (reading.get(key(projectId, ALL_PAGES)) ?? 0) > 0
  )
}
