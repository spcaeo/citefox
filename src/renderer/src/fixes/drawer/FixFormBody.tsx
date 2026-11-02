import { useEffect, useId, useMemo, useState, type JSX } from 'react'
import {
  FIX_KIND_OPTIONS,
  type FixKind,
  type FixPlanPreview,
  type FixRecheckRule,
  type LoggedFix,
  type PromptSetView
} from '@shared/domain'
import { pluralize } from '@shared/pluralize'
import { targetPagePath } from '@shared/target-page'
import {
  RECRAWL_REMINDER,
  cleanError,
  localMidnightIso,
  promptOptions,
  ruleOption,
  searchCostLine
} from '../../progress/model'
import { notifyChanged } from '../../shell/changes'
import { openDrawer, setDrawerParams } from '../../shell/drawers'
import { marketLabel } from '../../shell/model'
import {
  Button,
  createHelpFillSource,
  Drawer,
  DrawerField,
  DrawerFields,
  DrawerGrid,
  DrawerMain,
  DrawerRail,
  DrawerSection,
  PickerSelect,
  showUndo,
  type HelpFillSource
} from '../../ui'
import { useCopyFeedback } from '../../ui/useCopyFeedback'
import {
  FIX_RULES,
  FROM_PAGE_CHANGE,
  formError,
  formForFix,
  newForm,
  planLocked,
  sameForm,
  suggestionText,
  toggled,
  updateRequest,
  type FixDrawerParams,
  type FixForm
} from './model'
import { FixRewrite } from './FixRewrite'
import type { FixDrawerSource } from './source'
import { useAlsoQuestions } from './useAlsoQuestions'
import type { FixDrawerData } from './useFixDrawerData'

/**
 * Log a fix (`fix=new`) or edit one (`fix.mode=edit`): the page or topic it changed
 * (with "+ Track a new page…"), the kind of change (new page, rewrite or fix: the
 * Changes ledger groups by it), the go-live day, when to re-check, the questions it
 * should help, what changed and the markets, with the follow-up's search cost from
 * `fixes:preview`. "✦ Help write it" drafts the new section for a ticked question
 * (FixRewrite) into What changed. The subject, the picked questions and the helper's
 * way, chatbot and question are on the URL. A page fix's questions from its topics
 * (`fix.also`) are listed under the subject's and ticked too; an edited fix lists the
 * pages and topics its searches are asked on.
 */
export function FixFormBody({
  client,
  projectId,
  depth,
  now,
  data,
  fix,
  params,
  onTargets,
  onClose,
  helpSource,
  openLink
}: {
  client: FixDrawerSource
  projectId: string
  depth: number
  now: Date
  data: FixDrawerData
  /** Null when logging a new fix. */
  fix: LoggedFix | null
  params: FixDrawerParams
  /** Reloads the pages and topics (a page was just tracked). */
  onTargets: () => void
  onClose: (result?: unknown) => void
  /** Tests only: the helper's channels and the browser opener. */
  helpSource?: HelpFillSource
  openLink?: (url: string) => void
}): JSX.Element {
  const base = useId()
  const targets = data.targets.targets.filter((target) => target.status !== 'removed')
  const subjectId = fix?.pageId ?? params.pageId
  const target = targets.find((item) => item.id === subjectId) ?? null
  const subjectMarkets = data.targets.markets.filter((market) =>
    target?.marketIds.includes(market.id)
  )
  const suggestion = data.list.suggestions.find((gap) => gap.id === params.from)
  // The form starts once (the drawer is keyed by the fix); a new subject resets its
  // questions and markets below.
  const [initial, setInitial] = useState<FixForm>(() =>
    fix === null
      ? newForm(now, {
          promptIds:
            params.promptIds.length > 0
              ? params.promptIds
              : suggestion
                ? [suggestion.promptId]
                : [],
          marketIds: subjectMarkets.map((market) => market.id),
          description: suggestion ? suggestionText(suggestion) : params.text,
          kind: params.kind,
          goLive: params.liveOn
        })
      : formForFix(fix)
  )
  const [form, setForm] = useState<FixForm>(initial)
  // Markets follow the subject (every one picked) until the person changes them.
  const [marketsTouched, setMarketsTouched] = useState(fix !== null)
  const [loaded, setLoaded] = useState<{
    pageId: string
    view: PromptSetView | null
    error: string | null
  } | null>(null)
  const prompts = loaded !== null && loaded.pageId === subjectId ? loaded.view : null
  const promptsError = loaded !== null && loaded.pageId === subjectId ? loaded.error : null
  const [preview, setPreview] = useState<FixPlanPreview | null>(null)
  const [tried, setTried] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The text a helper draft replaced, so Undo can put it back.
  const [replaced, setReplaced] = useState<string | null>(null)
  const help = useMemo(() => helpSource ?? createHelpFillSource(), [helpSource])
  const copySection = useCopyFeedback(form.description)
  const locked = fix !== null && planLocked(fix)

  useEffect(() => {
    if (subjectId === null) return
    let live = true
    void Promise.resolve()
      .then(() => client['prompts:list']({ projectId, pageId: subjectId }))
      .then(
        (view) => {
          if (live) setLoaded({ pageId: subjectId, view, error: null })
        },
        (cause: unknown) => {
          if (live) {
            setLoaded({
              pageId: subjectId,
              view: null,
              error: cleanError(cause, 'Could not load its questions.')
            })
          }
        }
      )
    return () => {
      live = false
    }
  }, [client, projectId, subjectId])

  const options = promptOptions(prompts, target?.marketIds[0] ?? null)

  // "Is this a fix?" on Pages: the change was to the whole page, so every one of its
  // questions starts ticked once they load (the start state, so closing asks nothing).
  const tickAll = fix === null && params.from === FROM_PAGE_CHANGE && params.promptIds.length === 0
  const allIds = tickAll && subjectId === params.pageId ? options.map((item) => item.id) : []
  const allKey = allIds.join(',')
  // Tick them while rendering when the list (or drawer level) changes, not in an
  // effect (react-hooks/set-state-in-effect); the URL is updated in the effect below.
  const tickKey = `${depth}|${allKey}`
  const [tickedKey, setTickedKey] = useState('')
  if (tickKey !== tickedKey) {
    setTickedKey(tickKey)
    if (allKey.length > 0) {
      const ids = allKey.split(',')
      setForm((current) =>
        current.promptIds.length > 0 ? current : { ...current, promptIds: ids }
      )
      setInitial((current) => ({ ...current, promptIds: ids }))
    }
  }
  useEffect(() => {
    if (allKey.length === 0) return
    setDrawerParams(depth, { 'fix.prompts': allKey })
  }, [allKey, depth])
  const alsoIds =
    fix === null
      ? params.also
      : [
          ...new Set(
            (fix.measure?.questions ?? [])
              .map((question) => question.sourceId)
              .filter((id) => id !== fix.pageId)
          )
        ]
  const also = useAlsoQuestions(client, projectId, alsoIds, data.targets.targets)
  const allOptions = [...options, ...also.groups.flatMap((group) => group.options)]
  const known = new Set(allOptions.map((item) => item.id))
  // While other topics' questions load, their picks stay (a save never drops them).
  const pickedIds = [
    ...allOptions.filter((item) => form.promptIds.includes(item.id)).map((item) => item.id),
    ...(also.loading
      ? form.promptIds.filter((id) => !known.has(id) && !options.some((item) => item.id === id))
      : [])
  ]
  const marketIds = subjectMarkets
    .filter((market) => !marketsTouched || form.marketIds.includes(market.id))
    .map((market) => market.id)
  const goLiveAt = localMidnightIso(form.goLive)
  const previewKey = `${subjectId ?? ''}|${goLiveAt ?? ''}|${pickedIds.join(',')}|${marketIds.join(',')}`

  useEffect(() => {
    const [page, at, promptPart, marketPart] = previewKey.split('|')
    if (!page || !at) return
    let live = true
    void Promise.resolve()
      .then(() =>
        client['fixes:preview']({
          projectId,
          pageId: page,
          goLiveAt: at,
          promptIds: promptPart ? promptPart.split(',') : [],
          marketIds: marketPart ? marketPart.split(',') : []
        })
      )
      .then(
        (next) => {
          if (live) setPreview(next)
        },
        () => {
          if (live) setPreview(null)
        }
      )
    return () => {
      live = false
    }
  }, [client, projectId, previewKey])

  const checked = { ...form, promptIds: pickedIds, marketIds }
  const problem = formError(checked, subjectId !== null && target !== null)
  const dirty = !sameForm(form, initial) || (fix === null && subjectId !== params.pageId)

  /** A new subject: none of its questions picked yet, every one of its markets. */
  function pickSubject(id: string): void {
    setForm((current) => ({ ...current, promptIds: [], marketIds: [] }))
    setMarketsTouched(false)
    // Another page or topic: the page fix's address and topic questions no longer apply.
    setDrawerParams(depth, {
      'fix.page': id || null,
      'fix.prompts': null,
      'fix.also': null,
      'fix.url': null
    })
  }

  function togglePrompt(id: string): void {
    const next = toggled(form.promptIds, id)
    setForm((current) => ({ ...current, promptIds: next }))
    // The picks are on the URL, so a copied link logs the same fix.
    if (fix === null) setDrawerParams(depth, { 'fix.prompts': next.join(',') || null })
  }

  /** A helper draft becomes the description; typed text it replaces can come back. */
  function takeDraft(text: string): void {
    const before = form.description.trim()
    setReplaced(before.length > 0 && before !== text.trim() ? form.description : null)
    setForm((current) => ({ ...current, description: text }))
  }

  function pickKind(kind: FixKind): void {
    setForm((current) => ({ ...current, kind }))
    if (fix === null) setDrawerParams(depth, { 'fix.kind': kind === 'fix' ? null : kind })
  }

  async function save(): Promise<void> {
    setTried(true)
    if (problem !== null || subjectId === null || goLiveAt === null) return
    setSaving(true)
    setError(null)
    try {
      if (fix === null) {
        const saved = await client['fixes:create']({
          projectId,
          pageId: subjectId,
          description: form.description,
          kind: form.kind,
          goLiveAt,
          rule: form.rule,
          promptIds: pickedIds,
          marketIds,
          ...(params.url ? { url: params.url } : {}),
          ...(params.pageFixId ? { pageFixId: params.pageFixId } : {})
        })
        notifyChanged('fixes')
        onClose(saved.id)
        showUndo({
          message: `Logged Fix ${saved.number}.`,
          effect: 'CiteFox re-checks its questions after it goes live.',
          undoLabel: 'Undo',
          undo: async () => {
            await client['fixes:delete']({ projectId, fixId: saved.id })
            notifyChanged('fixes')
          }
        })
        return
      }
      const request = updateRequest(projectId, fix, checked)
      if (request !== null) await client['fixes:update'](request)
      notifyChanged('fixes')
      setSaving(false)
      // Back to the fix itself, saved.
      setDrawerParams(depth, { 'fix.mode': null })
    } catch (cause) {
      setError(cleanError(cause))
      setSaving(false)
    }
  }

  const pages = targets.filter((item) => item.kind === 'page')
  const topics = targets.filter((item) => item.kind === 'topic')
  return (
    <Drawer
      id="fix"
      title={fix === null ? 'Log a fix' : `Edit Fix ${fix.number}`}
      subtitle={
        fix === null
          ? 'Say what you changed and CiteFox re-checks just the questions it should help.'
          : locked
            ? 'Its follow-up already ran or is running, so only the description and kind can change.'
            : 'Changing the day, the questions or the markets re-plans the follow-up.'
      }
      dirty={dirty && !saving}
      closeDisabled={saving}
      busy={saving}
      onClose={() => onClose()}
      footer={{
        summary:
          error !== null || (tried && problem !== null) ? (
            <span role="alert" className="fxd-error">
              {error ?? problem}
            </span>
          ) : (
            searchCostLine(preview, pickedIds.length, marketIds.length)
          ),
        secondary: {
          label: copySection.state === 'copied' ? 'Copied' : 'Copy section',
          icon: copySection.state === 'copied' ? 'check' : 'copy',
          disabled: form.description.trim().length === 0,
          onClick: copySection.copy,
          testId: 'fxd-copy-section'
        },
        primary: {
          label: fix === null ? 'Log fix' : 'Save changes',
          busy: saving,
          disabled: saving,
          onClick: () => void save()
        }
      }}
    >
      <DrawerGrid>
        <DrawerMain>
          <DrawerSection title="The change">
            <DrawerFields columns={2}>
              <DrawerField
                label="Page or topic"
                htmlFor={`${base}-subject`}
                hint={
                  (params.url && fix === null ? `For ${targetPagePath(params.url)} · ` : '') +
                  (target
                    ? pluralize(target.questions, 'question') +
                      ` · ${subjectMarkets.map(marketLabel).join(', ') || 'no market'}`
                    : 'The page you edited, or the topic it answers.')
                }
              >
                <PickerSelect
                  id={`${base}-subject`}
                  value={subjectId ?? ''}
                  disabled={fix !== null || saving}
                  placeholder="Pick a page or topic"
                  options={[
                    ...(pages.length > 0
                      ? [
                          {
                            label: 'Pages',
                            options: pages.map((item) => ({ value: item.id, label: item.name }))
                          }
                        ]
                      : []),
                    ...(topics.length > 0
                      ? [
                          {
                            label: 'Topics',
                            options: topics.map((item) => ({ value: item.id, label: item.name }))
                          }
                        ]
                      : [])
                  ]}
                  createLabel={fix === null ? '+ Track a new page…' : undefined}
                  onCreate={() =>
                    openDrawer(
                      'track-page',
                      {},
                      {
                        onResult: (pageId) => {
                          if (typeof pageId !== 'string') return
                          onTargets()
                          pickSubject(pageId)
                        }
                      }
                    )
                  }
                  onChange={pickSubject}
                />
              </DrawerField>
              <DrawerField
                label="Kind of change"
                htmlFor={`${base}-kind`}
                hint="The Changes tab measures each kind on its own."
              >
                <select
                  id={`${base}-kind`}
                  className="ui-input"
                  value={form.kind}
                  disabled={saving}
                  onChange={(event) => pickKind(event.target.value as FixKind)}
                >
                  {FIX_KIND_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </DrawerField>
              <DrawerField label="Goes live on" htmlFor={`${base}-live`}>
                <input
                  id={`${base}-live`}
                  className="ui-input"
                  type="date"
                  value={form.goLive}
                  disabled={locked}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, goLive: event.target.value }))
                  }
                />
              </DrawerField>
              <DrawerField label="Re-check the questions" htmlFor={`${base}-rule`}>
                <select
                  id={`${base}-rule`}
                  className="ui-input"
                  value={form.rule}
                  disabled={locked}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      rule: event.target.value as FixRecheckRule
                    }))
                  }
                >
                  {FIX_RULES.map((rule) => (
                    <option key={rule} value={rule}>
                      {ruleOption(rule, preview)}
                    </option>
                  ))}
                </select>
              </DrawerField>
            </DrawerFields>
          </DrawerSection>
          <DrawerSection
            title="Questions it should help"
            count={pickedIds.length > 0 ? `${pickedIds.length} of ${allOptions.length}` : undefined}
            loading={
              (subjectId !== null && prompts === null && promptsError === null) || also.loading
            }
            error={promptsError}
          >
            {subjectId === null ? (
              <p className="muted">Pick the page or topic first.</p>
            ) : options.length === 0 ? (
              <p className="muted">It has no questions to pick yet.</p>
            ) : (
              <fieldset className="fxd-checks">
                <legend className="sr-only">Questions it should help</legend>
                {options.map((prompt) => (
                  <label key={prompt.id} className="fxd-check" title={prompt.text}>
                    <input
                      type="checkbox"
                      checked={form.promptIds.includes(prompt.id)}
                      disabled={locked}
                      onChange={() => togglePrompt(prompt.id)}
                    />
                    {/* A short tag (Q3, K2) only; a label that is the question itself isn't repeated. */}
                    {shortTag(prompt) ? <span className="fxd-num">{shortTag(prompt)}</span> : null}
                    <span className="fxd-check-text">{prompt.text || prompt.label}</span>
                  </label>
                ))}
              </fieldset>
            )}
            {also.groups.map((group) =>
              group.options.length === 0 ? null : (
                <fieldset key={group.id} className="fxd-checks fxd-also">
                  <legend className="fxd-also-name">
                    {group.kind === 'topic' ? 'From the topic' : 'From the page'} {group.name}
                  </legend>
                  {group.options.map((prompt) => (
                    <label key={prompt.id} className="fxd-check" title={prompt.text}>
                      <input
                        type="checkbox"
                        checked={form.promptIds.includes(prompt.id)}
                        disabled={locked}
                        onChange={() => togglePrompt(prompt.id)}
                      />
                      {shortTag(prompt) ? (
                        <span className="fxd-num">{shortTag(prompt)}</span>
                      ) : null}
                      <span className="fxd-check-text">{prompt.text || prompt.label}</span>
                    </label>
                  ))}
                </fieldset>
              )
            )}
          </DrawerSection>
          <DrawerSection
            title="The new text"
            description="Write what you changed, or let ✦ draft the new section from what Google cites."
            testId="fxd-what"
          >
            <FixRewrite
              projectId={projectId}
              pageId={subjectId}
              questions={allOptions.filter((item) => pickedIds.includes(item.id))}
              forPromptId={params.forPromptId}
              onFor={(id) => setDrawerParams(depth, { 'fix.for': id })}
              source={help}
              way={params.help}
              bot={params.bot}
              onWay={(way) => setDrawerParams(depth, { 'fix.help': way }, { push: true })}
              onBot={(bot) => setDrawerParams(depth, { 'fix.bot': bot })}
              disabled={saving}
              onText={takeDraft}
              openLink={openLink}
            />
            <DrawerField label="What changed" htmlFor={`${base}-what`} wide>
              <textarea
                id={`${base}-what`}
                className="ui-input fxd-text"
                rows={6}
                value={form.description}
                placeholder="Describe the edit in a sentence or two, or paste the new section."
                onChange={(event) => {
                  setReplaced(null)
                  setForm((current) => ({ ...current, description: event.target.value }))
                }}
              />
            </DrawerField>
            {replaced !== null ? (
              <p className="faint fxd-replaced" role="status">
                The draft replaced your text.{' '}
                <Button
                  variant="text"
                  size="sm"
                  onClick={() => {
                    setForm((current) => ({ ...current, description: replaced }))
                    setReplaced(null)
                  }}
                >
                  Undo
                </Button>
              </p>
            ) : null}
          </DrawerSection>
        </DrawerMain>
        <DrawerRail label="Follow-up">
          {subjectMarkets.length > 1 ? (
            <DrawerSection title="Markets">
              <fieldset className="fxd-checks">
                <legend className="sr-only">Markets</legend>
                {subjectMarkets.map((market) => (
                  <label key={market.id} className="fxd-check">
                    <input
                      type="checkbox"
                      checked={marketIds.includes(market.id)}
                      disabled={locked}
                      onChange={() => {
                        setMarketsTouched(true)
                        setForm((current) => ({
                          ...current,
                          marketIds: toggled(marketIds, market.id)
                        }))
                      }}
                    />
                    <span>{marketLabel(market)}</span>
                  </label>
                ))}
              </fieldset>
            </DrawerSection>
          ) : null}
          <DrawerSection title="Before the follow-up">
            <p className="muted">{RECRAWL_REMINDER}</p>
          </DrawerSection>
        </DrawerRail>
      </DrawerGrid>
    </Drawer>
  )
}

/** The question's short tag, such as "Q3": null when its label is the question's own words. */
function shortTag(prompt: { label: string; text: string; n: number }): string | null {
  const label = prompt.label.trim()
  if (label === '') return `Q${prompt.n}`
  return label.length <= 6 && label !== prompt.text.trim() ? label : null
}
