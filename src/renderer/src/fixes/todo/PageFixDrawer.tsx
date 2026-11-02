import { useEffect, useMemo, useState, type JSX, type ReactNode } from 'react'
import type { SavedPageFixBrief } from '@shared/ipc'
import { PAGE_FIX_KIND_COPY, type PageFix } from '@shared/page-fixes'
import { pluralize } from '@shared/pluralize'
import { resolveTargetPage } from '@shared/target-page'
import { CONNECTIONS_HREF } from '../../assistant/drawer/model'
import { useAiContext } from '../../assistant/context/useAiContext'
import { errorText } from '../../components/errorText'
import { DrillButton, useDrill } from '../../drill'
import { signalGuide } from '../../guide/signals'
import { notifyChanged } from '../../shell/changes'
import { ScreenDrawerLevel } from '../../shell/DrawerLevel'
import { openDrawer } from '../../shell/drawers'
import { pagesHash, topicHash } from '../../shell/routes'
import { WriteWithCard } from '../../sponsors/WriteWithCard'
import { notifyTopicsChanged } from '../../topics/clusters/events'
import {
  IconButton,
  Button,
  CopyText,
  Drawer,
  DrawerFacts,
  DrawerGrid,
  DrawerMain,
  DrawerRail,
  DrawerSection,
  LinkButton,
  SuggestionCard,
  Tabs,
  UrlText,
  showUndo
} from '../../ui'
import { useCopyFeedback } from '../../ui/useCopyFeedback'
import { newFixValues } from '../drawer/model'
import { pathOf } from '../model'
import type { ProjectFixesSource } from '../source'
import { RESULT_LABEL, fixDrill, fixTitle } from './model'
import { changeSummaryText } from '@shared/page-edit'
import { ownerWhyContext } from '@shared/owner-why'
import { OwnerChoice, OwnerWhySection } from './ownerWhy/OwnerWhy'
import { useOwnerWhy } from './ownerWhy/useOwnerWhy'
import { PublishedSection } from './Published'
import {
  editsText,
  publishedPageUrl,
  publishMarkets,
  publishPrefill,
  publishRequest,
  publishSubject,
  publishText
} from './publish'
import { usePublish } from './usePublish'
import { PageEditMain, PageEditRail } from './pageEdit/PageEditTab'
import { usePageEditPanel } from './pageEdit/usePageEditPanel'
import type { PageFixTab } from './pageFixTab'
import { usePageFixBrief, type PageFixBrief } from './usePageFixBrief'

/** Searches listed in the drawer; the drill lists them all. */
const LISTED = 8

type DrawerSource = Pick<
  ProjectFixesSource,
  | 'fixes:draftPageEdit'
  | 'fixes:pageEdit'
  | 'fixes:savePageEditHtml'
  | 'fixes:draftOwnerWhy'
  | 'fixes:ownerWhy'
  | 'topics:draftFix'
  | 'topics:draftPageBrief'
  | 'topics:setTarget'
  | 'assist:run'
  | 'fixes:saveBrief'
  | 'fixes:listProject'
  | 'fixes:create'
  | 'fixes:delete'
  | 'prompts:addTargets'
>

/** The drawer's props past the fix itself. */
interface FixDrawerProps {
  fix: PageFix
  projectId: string
  domain: string
  source: DrawerSource
  /** Start the brief at once (the row's button was pressed). */
  autoStart?: boolean
  /** The brief saved for this fix before, shown at once. */
  saved?: PageFixBrief | null
  /** A brief was written and saved: the fix's Status turns "Brief ready". */
  onSaved?: (saved: SavedPageFixBrief) => void
  onClose: () => void
  /** An owner was picked: reload the searches. */
  onChanged: () => void
  /** The open tab (kept in the URL by the screen). Default the brief. */
  tab?: PageFixTab
  onTab?: (tab: PageFixTab) => void
  /**
   * True when the shell's drawer stack holds it (`drawer=page-fix`, over any screen):
   * the host's DrawerLevel places it. Default: a drawer kept in the screen's URL.
   */
  stacked?: boolean
  /** Left of ✕: "Fix 1 of 3" and its arrows, when one brief covers several fixes. */
  status?: ReactNode
}

/**
 * One page fix (`?pf=<id>`, a drawer kept in the screen's URL): what to do, the
 * searches it can win, and its button. Get fix brief and Get page brief write a
 * brief with the existing brief features (saved checks only, no search); Choose
 * owner keeps Google's pick as the target (`topics:setTarget`, with Undo) or keeps
 * the target and gets its fix brief. "I published this" logs the fix live today in
 * one click (with Undo), on the page it is about (an owner fix: the page "Why Google
 * picks" recommends) with every one of its searches, topic questions included; "Pick
 * another date" opens the full Log a fix form filled the same way. Once logged, the
 * drawer says "Live since …" and, after the wait, whether it worked.
 */
export function PageFixDrawer(props: FixDrawerProps): JSX.Element {
  if (props.stacked) return <FixDrawerBody key={props.fix.id} {...props} />
  return (
    <ScreenDrawerLevel onClose={props.onClose}>
      <FixDrawerBody key={props.fix.id} {...props} />
    </ScreenDrawerLevel>
  )
}

function FixDrawerBody({
  fix,
  projectId,
  domain,
  source,
  autoStart = false,
  saved = null,
  onSaved,
  onClose,
  onChanged,
  tab = 'brief',
  onTab,
  status
}: FixDrawerProps): JSX.Element {
  const brief = usePageFixBrief(source, projectId, fix, {
    saved,
    ...(onSaved ? { onSaved } : {})
  })
  const { start } = brief
  // With no AI connected, a press shows the notice instead of a run that would fail.
  const noAi =
    brief.state.phase === 'no-ai' ||
    (brief.state.phase === 'idle' && brief.readiness === 'not-ready')
  // The row's button opened the drawer: its brief starts at once (once per open),
  // unless a brief is saved already.
  useEffect(() => {
    if (autoStart && fix.kind !== 'owner' && saved === null) start()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, [])
  const [owner, setOwner] = useState<{ busy: boolean; error: string | null }>({
    busy: false,
    error: null
  })
  const drill = useDrill()
  const searchesDrill = useMemo(() => fixDrill(fix, projectId, domain), [fix, projectId, domain])
  const copy = PAGE_FIX_KIND_COPY[fix.kind]
  const title = fixTitle(fix)
  const topics = fix.sources.filter((item) => item.kind === 'topic')
  const pageId = fix.page?.pageId ?? null
  const ownerWhy = useOwnerWhy(source, projectId, fix)
  const verdict = ownerWhy.state.phase === 'done' ? ownerWhy.state.why : null
  // An owner fix marks up the page "Why Google picks" recommends, with its findings as advice.
  const editTarget = useMemo(
    () =>
      verdict === null
        ? null
        : {
            pageId: verdict.ownerUrl === fix.page?.url ? fix.page.pageId : null,
            url: verdict.ownerUrl,
            context: ownerWhyContext(verdict)
          },
    [verdict, fix.page]
  )
  // Page edits need a page of the site to read: an improve fix, or an owner fix once
  // the comparison names the page that should own the searches. Never a new page.
  const hasEdits =
    fix.kind === 'owner' ? editTarget !== null : fix.kind !== 'new' && fix.page !== null
  const shown: PageFixTab = hasEdits ? tab : 'brief'
  const pageEdit = usePageEditPanel(source, projectId, fix, editTarget)
  const reviewing = shown === 'edits' && pageEdit.page.state.phase === 'done'
  const publishing = usePublish(source, projectId, fix.id)
  // A new page has no address until it is live: the person types it.
  const [typedUrl, setTypedUrl] = useState('')
  const newUrl = fix.kind === 'new' ? resolveTargetPage(typedUrl, domain) : null
  const pageUrl = publishedPageUrl(fix, verdict?.ownerUrl ?? null, newUrl)
  const subject =
    publishing.targets === null || (fix.kind === 'new' && newUrl === null)
      ? null
      : publishSubject(fix, pageUrl, publishing.targets)
  useAiContext({
    ...(pageId ? { pageId } : {}),
    entities: [{ kind: 'page', id: pageId ?? fix.id, label: title }],
    numbers: [{ label: 'Searches this fix can win', value: String(fix.searches.length) }]
  })

  /** What the fix is logged with: the kept page edits, else the written brief, else a line. */
  function logText(): string {
    const page = pageEdit.page
    return publishText(fix, pageUrl, {
      edits:
        page.state.phase === 'done'
          ? editsText(changeSummaryText(page.state.edit, page.edits))
          : null,
      brief: brief.state.phase === 'done' ? brief.state.brief.text : null
    })
  }

  /** The full Log a fix form: the fix's page, every one of its searches, the words. */
  function logFix(text: string): void {
    onClose()
    // A new page with no address yet: the form starts on its topic, the address left out.
    const formSubject =
      subject ??
      (publishing.targets === null ? null : publishSubject(fix, null, publishing.targets))
    openDrawer('fix', newFixValues(publishPrefill({ fix, subject: formSubject, text })))
  }

  /** "I published this": logged live today in one click, with Undo. */
  function publishNow(): void {
    if (subject === null || publishing.targets === null) return
    const target = publishing.targets.find((item) => item.id === subject.pageId)
    publishing.publish(
      publishRequest({
        projectId,
        fix,
        subject,
        marketIds: publishMarkets(fix, target),
        text: logText(),
        now: new Date()
      })
    )
  }

  /** Makes the page Google cites the target of these searches, topic by topic. */
  async function keepGooglesPick(): Promise<void> {
    if (fix.citedUrl === null) return
    setOwner({ busy: true, error: null })
    const before = fix.page
    try {
      for (const topic of topics) {
        const promptIds = fix.searches
          .filter((search) => search.sourceId === topic.id)
          .map((search) => search.promptId)
        await source['topics:setTarget']({
          projectId,
          topicId: topic.id,
          promptIds,
          target: { pageId: null, url: fix.citedUrl }
        })
      }
      setOwner({ busy: false, error: null })
      notifyTopicsChanged()
      notifyChanged('fixes')
      showUndo({
        message: `${pathOf(fix.citedUrl)} now owns ${pluralize(fix.searches.length, 'search', 'searches')}.`,
        effect: 'The next check counts it as the target page.',
        ...(before
          ? {
              undo: async () => {
                for (const topic of topics) {
                  await source['topics:setTarget']({
                    projectId,
                    topicId: topic.id,
                    promptIds: fix.searches
                      .filter((search) => search.sourceId === topic.id)
                      .map((search) => search.promptId),
                    target: { pageId: before.pageId, url: before.url }
                  })
                }
                notifyTopicsChanged()
                notifyChanged('fixes')
                onChanged()
              }
            }
          : {})
      })
      onChanged()
      onClose()
    } catch (cause) {
      setOwner({ busy: false, error: errorText(cause, 'Could not change the target page.') })
    }
  }

  const card =
    brief.state.phase === 'idle' || brief.state.phase === 'no-ai' ? null : (
      <SuggestionCard
        // The section heading already says the action; the card names the brief.
        title={
          brief.state.phase === 'done'
            ? brief.state.brief.title
            : fix.kind === 'new'
              ? 'Page brief'
              : 'Fix brief'
        }
        status={
          brief.state.phase === 'running'
            ? 'running'
            : brief.state.phase === 'error'
              ? 'error'
              : 'ready'
        }
        reads="Reads your saved checks. No searches."
        expectedSeconds={fix.kind === 'new' ? 15 : 12}
        error={brief.state.phase === 'error' ? brief.state.message : null}
        body={brief.state.phase === 'done' ? brief.state.brief.summary : undefined}
        items={brief.state.phase === 'done' ? brief.state.brief.items : []}
        footnote={brief.state.phase === 'done' ? brief.state.brief.note : undefined}
        {...(brief.state.phase === 'done' && publishing.published === null
          ? {
              applyLabel: 'Log as a fix',
              onApply: () => logFix(brief.state.phase === 'done' ? brief.state.brief.text : '')
            }
          : {})}
        onRetry={() => brief.start()}
        onClose={brief.reset}
      />
    )

  return (
    <Drawer
      id="page-fix"
      title={`${copy.title} · ${title}`}
      subtitle={`What to do: ${copy.todo}`}
      {...(status ? { status } : {})}
      focusOnOpen="close"
      onClose={onClose}
      footer={
        publishing.published !== null
          ? { cancel: 'Close' }
          : {
              cancel: 'Close',
              summary: publishing.error ? (
                <span role="alert">{publishing.error}</span>
              ) : fix.kind === 'new' && newUrl === null ? (
                'Type the new page’s address once it is live.'
              ) : undefined,
              secondary: {
                label: 'Pick another date',
                disabled: publishing.busy,
                onClick: () => logFix(logText()),
                testId: 'fxt-pick-date'
              },
              primary: {
                label: 'I published this',
                icon: 'check',
                busy: publishing.busy,
                disabled: subject === null || publishing.busy,
                onClick: publishNow,
                testId: 'fxt-published-btn',
                guide: 'pagefix-publish'
              }
            }
      }
    >
      <DrawerGrid>
        <DrawerMain>
          {publishing.published !== null ? (
            <PublishedSection fix={publishing.published} domain={domain} now={new Date()} />
          ) : null}
          {hasEdits ? (
            <div className="fxt-tabs" data-guide="pagefix-tabs">
              <Tabs
                label="Page fix"
                size="sm"
                tabs={[
                  { id: 'brief', label: 'Brief' },
                  { id: 'edits', label: 'Page edits' }
                ]}
                value={shown}
                onChange={(next) => onTab?.(next)}
              />
            </div>
          ) : null}
          {shown === 'edits' ? (
            <div className="fxt-edits" data-guide="pagefix-edits">
              <PageEditMain panel={pageEdit} noAiNotice={<ConnectAiNotice />} />
            </div>
          ) : (
            <>
              {fix.kind === 'owner' ? (
                <OwnerWhySection
                  fix={fix}
                  domain={domain}
                  why={ownerWhy}
                  noAiNotice={<ConnectAiNotice />}
                  onEdits={onTab ? () => onTab('edits') : null}
                />
              ) : null}
              <DrawerSection
                title={copy.action}
                guide="pagefix-brief"
                actions={
                  fix.kind === 'owner' ? null : (
                    <CopyBriefButton
                      text={brief.state.phase === 'done' ? brief.state.brief.text : null}
                    />
                  )
                }
              >
                {fix.kind === 'owner' ? (
                  <OwnerChoice
                    fix={fix}
                    domain={domain}
                    topicCount={topics.length}
                    busy={owner.busy}
                    error={owner.error}
                    verdict={verdict?.verdict ?? null}
                    comparable={ownerWhy.state.phase !== 'off'}
                    onKeepPick={() => void keepGooglesPick()}
                    onKeepTarget={brief.start}
                  />
                ) : noAi ? null : brief.state.phase === 'idle' ? (
                  <div className="fxt-action">
                    <p className="muted">
                      {fix.kind === 'new'
                        ? 'CiteFox AI outlines the page these searches need, from your saved checks.'
                        : 'CiteFox AI writes what to add to the page, from your saved checks.'}
                    </p>
                    <Button variant="primary" size="sm" icon="sparkle" onClick={brief.start}>
                      {copy.action}
                    </Button>
                  </div>
                ) : null}
                {noAi ? <ConnectAiNotice /> : card}
              </DrawerSection>
              <DrawerSection
                title="Searches it can win"
                count={fix.searches.length}
                actions={
                  <DrillButton drill={searchesDrill}>
                    See all {fix.searches.length.toLocaleString('en-US')}
                  </DrillButton>
                }
              >
                <ol className="fxt-searches">
                  {fix.searches.slice(0, LISTED).map((search) => (
                    <li key={search.id} className="fxt-search">
                      <button
                        type="button"
                        className="fxt-search-n num"
                        aria-label={`${search.label}: open the searches list`}
                        onClick={() => drill.open(searchesDrill)}
                      >
                        {search.label}
                      </button>
                      <CopyText text={search.text} className="fxt-search-text" />
                      <span className="fxt-search-result">{RESULT_LABEL[search.state]}</span>
                      <span className="fxt-search-odds num">{search.winOdds?.score ?? '—'}</span>
                    </li>
                  ))}
                </ol>
              </DrawerSection>
            </>
          )}
        </DrawerMain>
        <DrawerRail label="The fix">
          {reviewing ? (
            <DrawerSection title="Review" guide="pagefix-review">
              <PageEditRail panel={pageEdit} />
            </DrawerSection>
          ) : null}
          {/* The guide's "Take the page with you" points at Review once the page is marked. */}
          <DrawerSection title="The fix" {...(reviewing ? {} : { guide: 'pagefix-review' })}>
            <DrawerFacts
              label="The fix"
              items={[
                ...(fix.page
                  ? [
                      {
                        label: fix.kind === 'owner' ? 'Target page' : 'Page',
                        value: (
                          <UrlText url={fix.page.url} label={pathOf(fix.page.url)} site={domain} />
                        )
                      }
                    ]
                  : []),
                ...(fix.citedUrl
                  ? [
                      {
                        label: 'Cited instead',
                        value: (
                          <UrlText url={fix.citedUrl} label={pathOf(fix.citedUrl)} site={domain} />
                        )
                      }
                    ]
                  : []),
                ...(fix.proposed ? [{ label: 'New page', value: fix.proposed }] : []),
                {
                  label: fix.sources.length === 1 ? 'Topic' : 'Topics',
                  value: (
                    <span className="fxt-topics">
                      {fix.sources.map((item) => (
                        <a
                          key={item.id}
                          href={item.kind === 'topic' ? topicHash(item.id) : pagesHash()}
                        >
                          {item.name} ({item.searches})
                        </a>
                      ))}
                    </span>
                  )
                },
                { label: 'Searches', value: fix.searches.length.toLocaleString('en-US') },
                { label: 'Best win odds', value: fix.bestOdds ?? '—' },
                { label: 'Average win odds', value: fix.avgOdds ?? '—' }
              ]}
            />
          </DrawerSection>
          {fix.kind === 'new' && publishing.published === null ? (
            <DrawerSection title="Once it is live">
              <label className="fxt-live-url">
                <span>Address of the new page</span>
                <input
                  className="ui-input"
                  type="url"
                  inputMode="url"
                  placeholder={`https://${domain}/new-page`}
                  value={typedUrl}
                  onChange={(event) => setTypedUrl(event.target.value)}
                />
              </label>
            </DrawerSection>
          ) : null}
          {fix.kind === 'owner' ? null : <WriteWithCard />}
        </DrawerRail>
      </DrawerGrid>
    </Drawer>
  )
}

/**
 * Copy brief: the written brief as plain text, for a writer's email or document.
 * Shown before the brief is written too (disabled), so the guide can point at it.
 */
function CopyBriefButton({ text }: { text: string | null }): JSX.Element {
  const copy = useCopyFeedback(text ?? '')
  return (
    <IconButton
      size="sm"
      tip
      icon={copy.state === 'copied' ? 'check' : 'copy'}
      label={copy.state === 'copied' ? 'Copied' : 'Copy brief'}
      disabled={text === null}
      data-guide="pagefix-copy"
      onClick={() => {
        copy.copy()
        signalGuide('fix-brief-copied')
      }}
    />
  )
}

/** No AI connected: one notice and one button, instead of a run that can only fail. */
function ConnectAiNotice(): JSX.Element {
  return (
    <div className="fxt-noai" role="status" data-testid="fxt-no-ai">
      <p>CiteFox AI isn&apos;t connected, so it can&apos;t write this brief yet.</p>
      <LinkButton size="sm" icon="sparkle" href={CONNECTIONS_HREF}>
        Connect CiteFox AI to write this brief
      </LinkButton>
    </div>
  )
}
