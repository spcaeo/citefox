import { useCallback, useEffect, useRef, useState } from 'react'
import type { TopicStage } from '@shared/domain'
import type {
  ImportDefaults,
  ImportPreview,
  ImportReadResult,
  ImportRules,
  ImportSource as ReadSource
} from '@shared/ipc'
import type { ImportEntity } from '@shared/import-fields'
import { errorText } from '../components/errorText'
import { fileToBase64 } from './model'
import type { ImportSource } from './source'

/** Wait after a change before the rows are checked again. */
export const PREVIEW_DELAY_MS = 250

export interface ImportFlowState {
  read: ImportReadResult | null
  mapping: readonly (string | null)[]
  stageWords: Readonly<Record<string, TopicStage | null>>
  defaults: ImportDefaults
  /** "Rows without a page use …" is ticked. */
  usePageDefault: boolean
  saveMapping: boolean
  preview: ImportPreview | null
  previewing: boolean
  busy: 'pick' | 'read' | 'markets' | null
  error: string | null
}

export interface ImportFlowActions {
  pickFile: () => Promise<boolean>
  dropFile: (file: File) => Promise<boolean>
  usePaste: (text: string) => Promise<boolean>
  chooseSheet: (sheet: string) => void
  setHasHeader: (hasHeader: boolean) => void
  setMapping: (column: number, field: string | null) => void
  setStageWord: (key: string, stage: TopicStage | null) => void
  setDefaults: (patch: Partial<ImportDefaults>) => void
  setUsePageDefault: (on: boolean) => void
  setSaveMapping: (on: boolean) => void
  /** Adds the markets rows name to the project and the page or topic, then checks again. */
  addMarkets: (codes: readonly string[]) => Promise<void>
  /** Imports the market column's rows in the default market (the column is left out). */
  dropMarketColumn: () => void
  template: (format: 'csv' | 'xlsx') => Promise<void>
  reset: () => void
}

export interface ImportFlowInput {
  source: ImportSource
  projectId: string
  entity: ImportEntity
  targetId: string | null
  rules: ImportRules
  /** The default page for rows without one (Add questions' "Default page to be cited"). */
  defaultPage: string | null
}

const EMPTY_DEFAULTS: ImportDefaults = { stage: null, page: null, market: null }

/** State and actions of the import steps: read, match, check (a dry run until commit). */
export function useImportFlow(input: ImportFlowInput): [ImportFlowState, ImportFlowActions] {
  const { source, projectId, entity, targetId, rules, defaultPage } = input
  const [read, setRead] = useState<ImportReadResult | null>(null)
  const [origin, setOrigin] = useState<ReadSource | null>(null)
  const [mapping, setMappingState] = useState<readonly (string | null)[]>([])
  const [stageWords, setStageWords] = useState<Readonly<Record<string, TopicStage | null>>>({})
  const [defaults, setDefaultsState] = useState<ImportDefaults>({
    ...EMPTY_DEFAULTS,
    page: defaultPage
  })
  const [usePageDefault, setUsePageDefault] = useState(defaultPage !== null)
  const [saveMapping, setSaveMapping] = useState(false)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [busy, setBusy] = useState<ImportFlowState['busy']>(null)
  const [error, setError] = useState<string | null>(null)
  const [round, setRound] = useState(0)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  const load = useCallback(
    async (from: ReadSource, hasHeader: boolean | null): Promise<boolean> => {
      setBusy('read')
      setError(null)
      try {
        const result = await source['import:read']({ projectId, entity, source: from, hasHeader })
        if (!live.current) return false
        setOrigin(from.kind === 'file' ? { ...from, sheet: result.sheet } : from)
        setRead(result)
        setMappingState(result.mapping)
        setStageWords(result.stageWords)
        setSaveMapping(result.mappingSaved)
        setPreview(null)
        return true
      } catch (cause) {
        if (live.current)
          setError(errorText(cause, 'Could not read that file.', { sentence: true }))
        return false
      } finally {
        if (live.current) setBusy(null)
      }
    },
    [source, projectId, entity]
  )

  // Every change checks the rows again, a moment after the last one.
  const rulesKeywords = rules.keywords
  const pageDefault = usePageDefault ? defaults.page : null
  useEffect(() => {
    if (read === null) return
    let current = true
    const timer = window.setTimeout(() => {
      setPreviewing(true)
      source['import:preview']({
        projectId,
        entity,
        sourceId: read.sourceId,
        mapping,
        stageWords,
        defaults: { ...defaults, page: pageDefault },
        rules: { keywords: rulesKeywords },
        targetId,
        saveMapping
      }).then(
        (next) => {
          if (!current) return
          setPreview(next)
          setError(null)
          setPreviewing(false)
        },
        (cause: unknown) => {
          if (!current) return
          setError(errorText(cause, 'Could not check the rows.', { sentence: true }))
          setPreviewing(false)
        }
      )
    }, PREVIEW_DELAY_MS)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [
    source,
    projectId,
    entity,
    targetId,
    read,
    mapping,
    stageWords,
    defaults,
    pageDefault,
    rulesKeywords,
    saveMapping,
    round
  ])

  const pickFile = useCallback(async (): Promise<boolean> => {
    setBusy('pick')
    setError(null)
    try {
      const picked = await source['import:pickFile']({ entity })
      if (!live.current || picked.cancelled) return false
      return await load({ kind: 'file', token: picked.token, sheet: null }, null)
    } catch (cause) {
      if (live.current) setError(errorText(cause, 'Could not open that file.', { sentence: true }))
      return false
    } finally {
      if (live.current) setBusy((value) => (value === 'pick' ? null : value))
    }
  }, [source, entity, load])

  const dropFile = useCallback(
    async (file: File): Promise<boolean> => {
      if (file.size > 10 * 1024 * 1024) {
        setError(`That file is ${(file.size / (1024 * 1024)).toFixed(1)} MB. The limit is 10 MB.`)
        return false
      }
      const data = await fileToBase64(file)
      return load({ kind: 'dropped', name: file.name, data, sheet: null }, null)
    },
    [load]
  )

  const usePaste = useCallback((text: string) => load({ kind: 'paste', text }, null), [load])

  const chooseSheet = useCallback(
    (sheet: string) => {
      if (origin === null || origin.kind === 'paste') return
      void load({ ...origin, sheet }, null)
    },
    [origin, load]
  )

  const setHasHeader = useCallback(
    (hasHeader: boolean) => {
      if (origin !== null) void load(origin, hasHeader)
    },
    [origin, load]
  )

  const setMapping = useCallback((column: number, field: string | null) => {
    setMappingState((current) =>
      current.map((value, index) => {
        if (index === column) return field
        // Each field fills from one column.
        return field !== null && value === field ? null : value
      })
    )
  }, [])

  const setStageWord = useCallback((key: string, stage: TopicStage | null) => {
    setStageWords((current) => ({ ...current, [key]: stage }))
  }, [])

  const setDefaults = useCallback((patch: Partial<ImportDefaults>) => {
    setDefaultsState((current) => ({ ...current, ...patch }))
  }, [])

  const addMarkets = useCallback(
    async (codes: readonly string[]) => {
      if (codes.length === 0) return
      setBusy('markets')
      setError(null)
      try {
        await source['import:commit']({
          projectId,
          entity: 'markets',
          targetId,
          rules: { keywords: true },
          rows: codes.map((code) => ({ values: { country: code }, keep: false }))
        })
        if (live.current) setRound((value) => value + 1)
      } catch (cause) {
        if (live.current)
          setError(errorText(cause, 'Could not add those markets.', { sentence: true }))
      } finally {
        if (live.current) setBusy(null)
      }
    },
    [source, projectId, targetId]
  )

  const dropMarketColumn = useCallback(() => {
    setMappingState((current) => current.map((value) => (value === 'market' ? null : value)))
  }, [])

  const template = useCallback(
    async (format: 'csv' | 'xlsx') => {
      setError(null)
      try {
        await source['import:template']({ entity, format })
      } catch (cause) {
        if (live.current)
          setError(errorText(cause, 'Could not save the template.', { sentence: true }))
      }
    },
    [source, entity]
  )

  const reset = useCallback(() => {
    setRead(null)
    setOrigin(null)
    setPreview(null)
    setMappingState([])
    setError(null)
  }, [])

  return [
    {
      read,
      mapping,
      stageWords,
      defaults,
      usePageDefault,
      saveMapping,
      preview,
      previewing,
      busy,
      error
    },
    {
      pickFile,
      dropFile,
      usePaste,
      chooseSheet,
      setHasHeader,
      setMapping,
      setStageWord,
      setDefaults,
      setUsePageDefault,
      setSaveMapping,
      addMarkets,
      dropMarketColumn,
      template,
      reset
    }
  ]
}
