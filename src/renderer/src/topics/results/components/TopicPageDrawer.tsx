import { useEffect, useRef, useState, type JSX } from 'react'
import type { TopicPageCandidate } from '@shared/ipc'
import { resolveTargetPage, sameTargetPage, targetPagePath } from '@shared/target-page'
import { errorText } from '../../../components/errorText'
import {
  Drawer,
  DrawerFacts,
  DrawerField,
  DrawerGrid,
  DrawerMain,
  DrawerRail,
  DrawerSection,
  SearchBox,
  UrlText
} from '../../../ui'
import { useTargetSuggestions } from '../hooks/useTargetSuggestions'
import type { TopicResultsSource } from '../source'
import { SuggestedPages } from './SuggestedPages'

/** Shown at most; typing in the field narrows the list. */
const SHOWN_MAX = 40

/**
 * The topic's target page (`drawer=topic-page` over a topic's results): the page on
 * the own site its questions should be cited from. "Suggested" ranks the own pages
 * the topic's latest checks already cite, and ✦ Suggest with AI adds CiteFox AI's
 * picks with a reason; with no target set, a clear winner is preselected and says
 * why (the user still saves). Or pick one of the project's pages, or type a path
 * such as `/pricing`; an empty field clears it. Saved with `topics:update`
 * (`targetPage`); main resolves the path on the project's domain. Questions with a
 * target page of their own keep it. Unsaved changes ask before closing, except an
 * untouched preselection.
 */
export function TopicPageDrawer({
  projectId,
  topicId,
  marketId = null,
  current,
  domain,
  source,
  onClose,
  onSaved
}: {
  projectId: string
  topicId: string
  /** The market on screen, whose checks the suggestions read. */
  marketId?: string | null
  /** The saved target page, or null. */
  current: string | null
  /** The project's own domain, so a typed path shows the full address before saving. */
  domain: string | null
  source: TopicResultsSource
  onClose: () => void
  onSaved: () => void
}): JSX.Element {
  const [value, setValue] = useState(current ?? '')
  const [candidates, setCandidates] = useState<readonly TopicPageCandidate[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const suggest = useTargetSuggestions({ source, projectId, topicId, marketId })
  const [picked, setPicked] = useState<{ url: string; note: string } | null>(null)
  // A choice of the user's (typing, a pick, a clear) is never overwritten by the preselection.
  const touched = useRef(current !== null)
  const pick = suggest.cited?.pick ?? null

  useEffect(() => {
    if (touched.current || pick === null) return
    touched.current = true
    setValue(pick.url)
    setPicked(pick)
  }, [pick])

  function choose(next: string): void {
    touched.current = true
    setValue(next)
  }

  useEffect(() => {
    let cancelled = false
    source.pageCandidates(projectId).then(
      (result) => {
        if (cancelled) return
        setCandidates(result.candidates)
        setLoadError(null)
      },
      (cause: unknown) => {
        if (!cancelled) setLoadError(errorText(cause, 'Could not list your pages.'))
      }
    )
    return () => {
      cancelled = true
    }
  }, [source, projectId, attempt])

  const typed = value.trim()
  // Without the domain, main checks the value on save.
  const resolved = typed === '' ? null : domain ? resolveTargetPage(typed, domain) : typed
  const problem =
    typed !== '' && resolved === null
      ? `Use a page on ${domain ?? 'your site'}, or a path such as /pricing.`
      : null
  const dirty = resolved === null ? current !== null : !sameTargetPage(resolved, current)
  const pickNote = picked !== null && sameTargetPage(resolved, picked.url) ? picked.note : null

  async function save(): Promise<void> {
    if (problem !== null) return
    setSaving(true)
    setError(null)
    try {
      await source.update({ projectId, topicId, targetPage: typed === '' ? null : typed })
      onSaved()
      onClose()
    } catch (cause) {
      setError(errorText(cause, 'Could not save the target page.'))
      setSaving(false)
    }
  }

  const needle = search.trim().toLowerCase()
  const shown = (candidates ?? []).filter(
    (candidate) =>
      needle === '' ||
      candidate.url.toLowerCase().includes(needle) ||
      (candidate.title ?? '').toLowerCase().includes(needle)
  )

  return (
    <Drawer
      id="topic-page"
      title="Target page"
      subtitle="The page on your site this topic's questions should be cited from."
      dirty={dirty && pickNote === null}
      busy={saving}
      closeDisabled={saving}
      onClose={onClose}
      testId="topic-page-drawer"
      footer={{
        summary: error ? (
          <span className="ui-drawer-error" role="alert">
            {error}
          </span>
        ) : (
          <>{resolved === null ? 'No target page' : targetPagePath(resolved)} · No new searches</>
        ),
        primary: {
          label: resolved === null && current !== null ? 'Clear target page' : 'Save target page',
          busy: saving,
          disabled: !dirty || problem !== null,
          guide: 'target-save',
          onClick: () => void save()
        }
      }}
    >
      <DrawerGrid className="tr-retarget">
        <DrawerMain>
          <SuggestedPages
            state={suggest}
            domain={domain}
            current={current}
            selected={resolved}
            pickNote={pickNote}
            disabled={saving}
            onUse={choose}
          />
          <DrawerSection title="Page or path">
            <DrawerField
              label="Target page"
              hint={
                resolved !== null && problem === null && domain ? (
                  <>
                    Saves as <UrlText url={resolved} />
                  </>
                ) : (
                  'Type a path such as /pricing, or pick a page above or below. Leave it empty for none.'
                )
              }
              error={problem}
            >
              {({ id, describedBy }) => (
                <input
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={problem !== null || undefined}
                  className="ui-input"
                  placeholder="/pricing"
                  value={value}
                  maxLength={2000}
                  disabled={saving}
                  onChange={(event) => choose(event.target.value)}
                />
              )}
            </DrawerField>
          </DrawerSection>
          <DrawerSection
            title="All your pages"
            {...(candidates !== null ? { count: candidates.length } : {})}
            description="Your tracked pages first, then pages from your sitemap."
            loading={candidates === null && loadError === null}
            error={loadError}
            onRetry={() => {
              setLoadError(null)
              setAttempt((n) => n + 1)
            }}
          >
            {candidates !== null ? (
              <>
                {candidates.length > SHOWN_MAX / 4 ? (
                  <SearchBox
                    className="tr-targets-search"
                    label="Search your pages"
                    value={search}
                    onChange={(value) => setSearch(value.slice(0, 200))}
                  />
                ) : null}
                <fieldset className="tr-targets" data-guide="target-pages">
                  <legend className="sr-only">Pick a page</legend>
                  {shown.slice(0, SHOWN_MAX).map((candidate) => (
                    <label key={candidate.url} className="tr-target">
                      {/* Named by the path alone, not by the Copy and Open buttons beside it. */}
                      <input
                        type="radio"
                        name="topic-page"
                        value={candidate.url}
                        aria-label={targetPagePath(candidate.url)}
                        checked={sameTargetPage(candidate.url, resolved)}
                        onChange={() => choose(candidate.url)}
                      />
                      <UrlText url={candidate.url} label={targetPagePath(candidate.url)} />
                      {candidate.source === 'sitemap' ? (
                        <span className="tr-target-note">Not tracked</span>
                      ) : null}
                    </label>
                  ))}
                  <label className="tr-target">
                    <input
                      type="radio"
                      name="topic-page"
                      value=""
                      checked={typed === ''}
                      onChange={() => choose('')}
                    />
                    <span>No target page</span>
                  </label>
                </fieldset>
                {shown.length > SHOWN_MAX ? (
                  <p className="faint">
                    {(shown.length - SHOWN_MAX).toLocaleString('en-US')} more. Search to narrow the
                    list.
                  </p>
                ) : null}
              </>
            ) : null}
          </DrawerSection>
        </DrawerMain>
        <DrawerRail label="What it changes">
          <DrawerSection title="What it changes">
            <DrawerFacts
              label="What it changes"
              items={[
                { label: 'This page cited', value: 'Cited by the right page' },
                { label: 'Another page of yours', value: 'Cited your site, not the target page' },
                { label: 'Questions', value: 'Those without their own target page aim here' }
              ]}
            />
            <p className="faint">
              This screen reads your saved results against it at once. Other screens count it from
              the next check. Nothing is searched now.
            </p>
          </DrawerSection>
        </DrawerRail>
      </DrawerGrid>
    </Drawer>
  )
}
