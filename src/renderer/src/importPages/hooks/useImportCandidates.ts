import { useCallback, useEffect, useState } from 'react'
import type { ImportCandidateList } from '@shared/ipc'
import type { StructureClient } from '../../structure/client'
import { errorText } from '../../components/errorText'

export interface CandidatesState {
  list: ImportCandidateList | null
  loading: boolean
  error: string | null
  reload: () => Promise<void>
}

export function errorMessage(cause: unknown, fallback: string): string {
  return errorText(cause, fallback)
}

const LOAD_FAILED = 'Could not load the pages CiteFox found.'

/** `import:candidates` for the project, reloaded after a sitemap read or an import. */
export function useImportCandidates(client: StructureClient, projectId: string): CandidatesState {
  const [list, setList] = useState<ImportCandidateList | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    client['import:candidates']({ projectId }).then(
      (next) => {
        if (cancelled) return
        setList(next)
        setError(null)
        setLoading(false)
      },
      (cause: unknown) => {
        if (cancelled) return
        setError(errorMessage(cause, LOAD_FAILED))
        setLoading(false)
      }
    )
    return () => {
      cancelled = true
    }
  }, [client, projectId])

  const reload = useCallback(async (): Promise<void> => {
    try {
      setList(await client['import:candidates']({ projectId }))
      setError(null)
    } catch (cause) {
      setError(errorMessage(cause, LOAD_FAILED))
    }
  }, [client, projectId])

  return { list, loading, error, reload }
}
