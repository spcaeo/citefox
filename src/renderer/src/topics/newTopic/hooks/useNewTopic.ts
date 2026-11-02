import { useCallback, useEffect, useRef, useState } from 'react'
import type { TopicDraft, TopicDraftPrompt, TopicStage } from '@shared/domain'
import type {
  HelpFillResult,
  TopicDraftPatch,
  TopicPageCandidate,
  TopicStep,
  TopicTarget
} from '@shared/ipc'
import { errorText } from '../../../components/errorText'
import { navigateHash, replaceHash, topicsHash } from '../../../shell/routes'
import { notifyTopicsChanged } from '../../clusters/events'
import type { ClustersSource } from '../../clusters/source'
import type { HelpFillSource } from '../../../ui'
import { answerPlan, targetFor } from '../utils/answer'
import type { NewTopicClient, NewTopicStep, NewTopicWay } from '../types'
import { includedQuestions, pathFor, PREVIEW_PER_STAGE, wayOfDraft } from '../utils/plan'
import { clearedNewTopicHash, useNewTopicUrl } from './useNewTopicUrl'
import { useTopicHelp, type TopicHelpActions, type TopicHelpState } from './useTopicHelp'
import { useTrackedQuestions, type TrackedQuestions } from './useTrackedQuestions'
import type { NewTopicUrl } from '../utils/url'

export type NewTopicBusy = 'write' | 'name' | 'create' | 'match' | null

/** A target picked for a question of a topic made from tracked questions. */
type TopicTargets = Readonly<Record<string, string | null>>

export interface NewTopicState {
  url: NewTopicUrl
  /** The step shown: the URL's, or Start while there is nothing to review yet. */
  step: NewTopicStep
  way: NewTopicWay
  draft: TopicDraft | null
  /** The URL names a draft that cannot be opened. */
  draftMissing: boolean
  loadingDraft: boolean
  /** My own questions with only tracked ones picked: the topic is made by moving them. */
  fromQuestions: boolean
  situation: string
  pasted: string
  competitorUrl: string
  pageUrl: string | null
  name: string
  /** The name the topic gets: the typed one, else one made from the situation. */
  topicName: string
  nameSuggested: boolean
  candidates: readonly TopicPageCandidate[]
  /** Expected seconds of the way's Claude step; null while unknown or for no step. */
  seconds: number | null
  busy: NewTopicBusy
  error: string | null
  tracked: TrackedQuestions
  topicTargets: TopicTargets
  /** ✦ Help me fill under "A buyer problem": Describe (the box) or the user's own chatbot. */
  help: TopicHelpState
  /** The preview's questions came from a pasted chatbot answer. */
  fromAnswer: boolean
}

export interface NewTopicActions {
  setWay: (way: NewTopicWay) => void
  setSituation: (value: string) => void
  setPasted: (value: string) => void
  setCompetitorUrl: (value: string) => void
  setPageUrl: (value: string | null) => void
  setName: (value: string) => void
  /** Writes (or reads, or imports) the questions for the preview. */
  write: () => Promise<void>
  suggestName: () => Promise<void>
  goStep: (step: NewTopicStep) => void
  goPages: () => Promise<void>
  toggleInclude: (prompt: TopicDraftPrompt) => Promise<void>
  editText: (prompt: TopicDraftPrompt, text: string) => Promise<void>
  setStage: (prompt: TopicDraftPrompt, stage: TopicStage | null) => Promise<void>
  remove: (prompt: TopicDraftPrompt) => Promise<void>
  add: (text: string, stage: TopicStage | null) => Promise<void>
  setTarget: (promptId: string, url: string | null) => Promise<void>
  create: () => Promise<void>
  createFromQuestions: () => Promise<void>
  /** Opens the new topic on the Topics screen and closes the dialog. */
  finish: (topicId: string) => void
  close: () => void
  startAgain: () => void
  help: TopicHelpActions
}

const STEP_OF_WAY: Readonly<Record<NewTopicWay, TopicStep | null>> = {
  problem: 'journey_questions',
  page: 'journey_questions',
  questions: null,
  competitor: 'competitor_questions'
}

function seedFor(way: NewTopicWay, situation: string, page: TopicPageCandidate | null): string {
  const typed = situation.trim()
  if (typed.length > 0 || way !== 'page' || page === null) return typed
  return `Questions buyers ask that ${page.title ?? page.url} should answer`
}

/** A name for the topic when none was typed: the situation's first clause, short. */
export function defaultName(draft: TopicDraft | null, situation: string): string {
  const named = draft?.name.trim() ?? ''
  if (named.length > 0) return named
  const text =
    (draft?.seed || situation)
      .trim()
      .split(/[.?!\n]/)[0]
      ?.trim() ?? ''
  return text.length > 60 ? `${text.slice(0, 57).trimEnd()}…` : text
}

/** The New topic dialog's state and actions (URL, draft, picks and the three steps). */
export function useNewTopic(options: {
  projectId: string
  client: NewTopicClient
  source: ClustersSource
  onClose: () => void
  /** Replaces "open it on Topics and close" when the topic is made. */
  onFinish?: (topicId: string) => void
  /** The ✦ Help me fill channels (the chatbot prompt and reading its answer). */
  helpSource: HelpFillSource
}): [NewTopicState, NewTopicActions] {
  const { projectId, client, source, onClose, onFinish, helpSource } = options
  const [url, setUrl] = useNewTopicUrl()
  const tracked = useTrackedQuestions(source, projectId, url.questions)
  const [loaded, setLoaded] = useState<TopicDraft | null>(null)
  const [missingId, setMissingId] = useState<string | null>(null)
  const [situation, setSituation] = useState('')
  const [pasted, setPasted] = useState('')
  const [competitorUrl, setCompetitorUrl] = useState('')
  const [pageUrl, setPageUrl] = useState<string | null>(null)
  const [name, setNameValue] = useState('')
  const [nameSuggested, setNameSuggested] = useState(false)
  const [candidates, setCandidates] = useState<readonly TopicPageCandidate[]>([])
  const [seconds, setSeconds] = useState<Partial<Record<TopicStep, number>>>({})
  const [busy, setBusy] = useState<NewTopicBusy>(null)
  const [error, setError] = useState<string | null>(null)
  const [topicTargets, setTopicTargets] = useState<TopicTargets>({})
  // The draft whose questions came from a pasted answer (the preview says so).
  const [answerDraftId, setAnswerDraftId] = useState<string | null>(null)
  const draftRef = useRef<TopicDraft | null>(null)
  const matched = useRef(new Set<string>())
  const suggested = useRef(false)
  const [openedFromQuestions] = useState(() => url.questions.length > 0)

  const keep = useCallback((next: TopicDraft) => {
    draftRef.current = next
    setLoaded(next)
  }, [])

  // The draft shown is the one the URL names; a draft made here is kept before its URL.
  const draft = loaded !== null && loaded.id === url.draftId ? loaded : null
  const draftMissing = url.draftId !== null && missingId === url.draftId

  const way: NewTopicWay =
    url.way ?? (openedFromQuestions ? 'questions' : draft !== null ? wayOfDraft(draft) : 'problem')

  /** Target pages: match every question not set by the user, once per draft. */
  const match = useCallback(
    async (current: TopicDraft) => {
      if (matched.current.has(current.id)) return
      if (!includedQuestions(current).some((prompt) => prompt.matchStatus === 'unmatched')) return
      matched.current.add(current.id)
      setBusy('match')
      try {
        const result = await client['topics:matchPages']({
          projectId,
          draftId: current.id,
          promptIds: null
        })
        keep(result.draft)
      } catch (caught) {
        setError(errorText(caught, 'Could not match pages.'))
      } finally {
        setBusy(null)
      }
    },
    [client, projectId, keep]
  )

  // Open the draft the URL names (a copied link, Back and Forward).
  const openAtPages = url.step === 'pages'
  useEffect(() => {
    const id = url.draftId
    if (id === null) {
      draftRef.current = null
      return
    }
    if (draftRef.current?.id === id) return
    let alive = true
    client['topics:getDraft']({ projectId, draftId: id }).then(
      (opened) => {
        if (!alive) return
        if (opened.projectId !== projectId) {
          setMissingId(id)
          return
        }
        keep(opened)
        setSituation((value) => value || opened.seed)
        setNameValue((value) => value || opened.name)
        setCompetitorUrl((value) => value || (opened.competitorUrl ?? ''))
        if (openAtPages) void match(opened)
      },
      () => {
        if (alive) setMissingId(id)
      }
    )
    return () => {
      alive = false
    }
  }, [client, projectId, url.draftId, keep, match, openAtPages])

  useEffect(() => {
    let alive = true
    source['topics:pageCandidates']({ projectId }).then(
      (result) => {
        if (alive) setCandidates(result.candidates)
      },
      () => undefined
    )
    return () => {
      alive = false
    }
  }, [source, projectId])

  const assistStep = STEP_OF_WAY[way]
  useEffect(() => {
    if (assistStep === null || seconds[assistStep] !== undefined) return
    let alive = true
    client['topics:describeStep']({ projectId, step: assistStep }).then(
      (result) => {
        if (alive)
          setSeconds((current) => ({ ...current, [assistStep]: result.label.expectedSeconds }))
      },
      () => undefined
    )
    return () => {
      alive = false
    }
  }, [client, projectId, assistStep, seconds])

  const fromQuestions =
    url.topicId !== null ||
    (way === 'questions' && pasted.trim() === '' && tracked.picked.size > 0 && draft === null)

  const suggestName = useCallback(async () => {
    const items = tracked.refs()
    if (items.length === 0) return
    setBusy('name')
    setError(null)
    try {
      const result = await source['topics:suggestName']({ projectId, items })
      setNameValue(result.name)
      setSituation((value) => value || result.situation)
      setNameSuggested(true)
    } catch (caught) {
      setError(errorText(caught, 'Could not suggest a name. Type one instead.'))
    } finally {
      setBusy(null)
    }
  }, [source, projectId, tracked])

  // Opened with questions ticked on the Questions screen: suggest a name once.
  const { list, refs } = tracked
  useEffect(() => {
    if (!openedFromQuestions || suggested.current || list === null || url.topicId !== null) return
    const items = refs()
    if (items.length === 0) return
    // Once only, so not cancelled on a re-run: the name lands even after StrictMode's remount.
    suggested.current = true
    source['topics:suggestName']({ projectId, items }).then(
      (result) => {
        setNameValue((value) => value || result.name)
        setSituation((value) => value || result.situation)
        setNameSuggested(true)
      },
      () => undefined
    )
  }, [openedFromQuestions, list, refs, url.topicId, source, projectId])

  const step: NewTopicStep = url.topicId !== null ? 'pages' : draft === null ? 'start' : url.step

  async function ensureDraft(given: { seed?: string; name?: string } = {}): Promise<TopicDraft> {
    const current = draftRef.current
    const path = pathFor(way)
    if (current !== null && current.path === path) return current
    const page = candidates.find((item) => item.url === pageUrl) ?? null
    const seed = given.seed ?? seedFor(way, situation, page)
    const named = given.name ?? name.trim()
    const created = await client['topics:createDraft']({
      projectId,
      path,
      ...(path === 'seed' && seed ? { seed } : {}),
      ...(named ? { name: named } : {})
    })
    keep(created)
    setUrl({ draftId: created.id, way }, { replace: true })
    return created
  }

  async function write(): Promise<void> {
    setBusy('write')
    setError(null)
    setAnswerDraftId(null)
    try {
      let current = await ensureDraft()
      const draftId = current.id
      // Fresh questions get matched to pages again on Target pages.
      matched.current.delete(draftId)
      if (way === 'competitor') {
        const read = await client['topics:readCompetitorPage']({
          projectId,
          draftId,
          url: competitorUrl.trim()
        })
        current = read.draft
        if (!read.page.ok) {
          keep(current)
          setError(read.page.message ?? 'Could not read that page. Check the address.')
          return
        }
        current = (
          await client['topics:competitorQuestions']({ projectId, draftId, marketId: null })
        ).draft
      } else if (way === 'questions') {
        current = (
          await client['topics:importQuestions']({
            projectId,
            draftId,
            text: pasted,
            append: false
          })
        ).draft
      } else {
        const page = candidates.find((item) => item.url === pageUrl) ?? null
        await client['topics:updateDraft']({
          projectId,
          draftId,
          patch: {
            seed: seedFor(way, situation, page),
            questionDepth: { preset: 'custom', perStage: PREVIEW_PER_STAGE }
          }
        })
        current = await client['topics:generateQuestions']({ projectId, draftId, replace: true })
        const ids = includedQuestions(current).map((prompt) => prompt.id)
        if (way === 'page' && page !== null && ids.length > 0) {
          const set = await client['topics:setTarget']({
            projectId,
            draftId,
            promptIds: ids,
            target: { pageId: page.pageId, url: page.url }
          })
          if (set.draft) current = set.draft
        }
      }
      keep(current)
      if (way !== 'questions')
        void tracked.findFit({
          name: name.trim() || defaultName(current, situation),
          situation: current.seed || situation
        })
    } catch (caught) {
      setError(errorText(caught, 'Could not write the questions. Try again.'))
    } finally {
      setBusy(null)
    }
  }

  /**
   * A pasted chatbot answer into the draft: its topic name (unless one was typed), its
   * questions with their stage in place of the draft's, and each question's page as its
   * target. The preview and Review questions then show them; nothing is a topic yet.
   */
  async function adopt(result: HelpFillResult): Promise<void> {
    const plan = answerPlan(result.rows)
    if (plan.questions.length === 0) return
    setBusy('write')
    setError(null)
    try {
      const typed = name.trim()
      const seed = situation.trim() || plan.name
      let current = await ensureDraft({ seed, name: typed || plan.name })
      const draftId = current.id
      matched.current.delete(draftId)
      current = await client['topics:updateDraft']({
        projectId,
        draftId,
        patch: {
          ...(seed ? { seed } : {}),
          ...(typed || plan.name ? { name: typed || plan.name } : {}),
          removePromptIds: current.prompts
            .filter((prompt) => prompt.kind === 'question')
            .map((prompt) => prompt.id),
          upsertPrompts: plan.questions.map((question) => ({
            kind: 'question' as const,
            text: question.text,
            stage: question.stage,
            source: 'imported' as const,
            included: true
          }))
        }
      })
      // One call per page: the questions that page should be cited for.
      const groups = new Map<string, { target: TopicTarget; ids: string[] }>()
      for (const question of plan.questions) {
        const target = targetFor(question.page, candidates)
        const prompt = current.prompts.find(
          (item) => item.kind === 'question' && item.text === question.text
        )
        if (target === null || prompt === undefined) continue
        const key = `${target.pageId ?? ''}|${target.url ?? ''}`
        const group = groups.get(key) ?? { target, ids: [] }
        group.ids.push(prompt.id)
        groups.set(key, group)
      }
      for (const group of groups.values()) {
        const set = await client['topics:setTarget']({
          projectId,
          draftId,
          promptIds: group.ids,
          target: group.target
        })
        if (set.draft) current = set.draft
      }
      keep(current)
      setAnswerDraftId(draftId)
      if (!typed && plan.name) {
        setNameValue(plan.name)
        setNameSuggested(true)
      }
      void tracked.findFit({
        name: typed || plan.name || defaultName(current, situation),
        situation: current.seed || situation
      })
    } catch (caught) {
      setError(errorText(caught, 'Could not use that answer. Try again.'))
    } finally {
      setBusy(null)
    }
  }

  const [help, helpActions] = useTopicHelp({
    source: helpSource,
    projectId,
    url,
    setUrl,
    open: way === 'problem',
    onAnswer: adopt
  })

  async function patch(change: TopicDraftPatch): Promise<void> {
    const current = draftRef.current
    if (current === null) return
    setError(null)
    try {
      keep(await client['topics:updateDraft']({ projectId, draftId: current.id, patch: change }))
    } catch (caught) {
      setError(errorText(caught, 'Could not save that change.'))
    }
  }

  const topicName = name.trim() || defaultName(draft, situation)

  async function saveName(): Promise<void> {
    const typed = topicName
    const current = draftRef.current
    if (current === null || typed.length === 0 || typed === current.name) return
    await patch({ name: typed })
  }

  async function setTarget(promptId: string, target: string | null): Promise<void> {
    const candidate = target === null ? null : candidates.find((item) => item.url === target)
    const value = { pageId: candidate?.pageId ?? null, url: target }
    setError(null)
    try {
      if (url.topicId !== null) {
        await source['topics:setTarget']({
          projectId,
          topicId: url.topicId,
          promptIds: [promptId],
          target: value
        })
        setTopicTargets((current) => ({ ...current, [promptId]: target }))
      } else if (draftRef.current !== null) {
        const result = await client['topics:setTarget']({
          projectId,
          draftId: draftRef.current.id,
          promptIds: [promptId],
          target: value
        })
        if (result.draft) keep(result.draft)
      }
    } catch (caught) {
      setError(errorText(caught, 'Could not set that page.'))
    }
  }

  function finish(topicId: string): void {
    if (onFinish) {
      onFinish(topicId)
      return
    }
    navigateHash(topicsHash({ row: topicId }))
    onClose()
  }

  async function create(): Promise<void> {
    const current = draftRef.current
    if (current === null) return
    setBusy('create')
    setError(null)
    try {
      await saveName()
      const result = await source['topics:createFromDraft']({
        projectId,
        draftId: current.id,
        moveIn: tracked.refs()
      })
      notifyTopicsChanged()
      finish(result.topicId)
    } catch (caught) {
      setError(errorText(caught, 'Could not create the topic. Try again.'))
      setBusy(null)
    }
  }

  async function createFromQuestions(): Promise<void> {
    const items = tracked.refs()
    const typed = topicName
    if (items.length === 0 || typed.length === 0) return
    setBusy('create')
    setError(null)
    try {
      const result = await source['topics:moveQuestions']({
        projectId,
        items,
        to: { kind: 'new', name: typed }
      })
      if (result.topicId === null) throw new Error(result.message)
      notifyTopicsChanged()
      await tracked.reload()
      setUrl({ topicId: result.topicId, step: 'pages', way: 'questions', questions: [] })
    } catch (caught) {
      setError(errorText(caught, 'Could not create the topic. Try again.'))
    } finally {
      setBusy(null)
    }
  }

  const state: NewTopicState = {
    url,
    step,
    way,
    draft,
    draftMissing,
    loadingDraft: url.draftId !== null && draft === null && !draftMissing,
    fromQuestions,
    situation,
    pasted,
    competitorUrl,
    pageUrl,
    name,
    topicName,
    nameSuggested,
    candidates,
    seconds: assistStep === null ? null : (seconds[assistStep] ?? null),
    busy,
    error,
    tracked,
    topicTargets,
    help,
    fromAnswer: draft !== null && draft.id === answerDraftId
  }

  const actions: NewTopicActions = {
    setWay: (next) => {
      const current = draftRef.current
      const keepDraft = current !== null && current.path === pathFor(next)
      setError(null)
      setUrl({ way: next, ...(keepDraft ? {} : { draftId: null }) }, { replace: true })
    },
    setSituation,
    setPasted,
    setCompetitorUrl,
    setPageUrl,
    setName: (value) => {
      setNameValue(value)
      setNameSuggested(false)
    },
    write,
    suggestName,
    goStep: (next) => setUrl({ step: next }),
    goPages: async () => {
      await saveName()
      setUrl({ step: 'pages' })
      if (draftRef.current !== null) await match(draftRef.current)
    },
    toggleInclude: (prompt) =>
      patch({
        upsertPrompts: [
          { id: prompt.id, kind: prompt.kind, text: prompt.text, included: !prompt.included }
        ]
      }),
    editText: async (prompt, text) => {
      const typed = text.trim()
      if (typed.length === 0 || typed === prompt.text) return
      await patch({ upsertPrompts: [{ id: prompt.id, kind: prompt.kind, text: typed }] })
    },
    setStage: (prompt, stage) =>
      patch({ upsertPrompts: [{ id: prompt.id, kind: prompt.kind, text: prompt.text, stage }] }),
    remove: (prompt) => patch({ removePromptIds: [prompt.id] }),
    add: async (text, stage) => {
      const typed = text.trim()
      if (typed.length === 0) return
      await patch({
        upsertPrompts: [{ kind: 'question', text: typed, stage, source: 'user', included: true }]
      })
    },
    setTarget,
    create,
    createFromQuestions,
    finish,
    close: () => {
      replaceHash(clearedNewTopicHash(window.location.hash))
      onClose()
    },
    startAgain: () => {
      setError(null)
      setUrl({ draftId: null, step: 'start' }, { replace: true })
    },
    help: helpActions
  }

  return [state, actions]
}
