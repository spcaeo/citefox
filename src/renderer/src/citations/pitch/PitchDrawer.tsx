import { useMemo, useState, type JSX } from 'react'
import type { CitedPageRow, CitedPagesData } from '@shared/ipc'
import { CopyDraft } from '../../assistant/drawer/CopyDraft'
import type { DrawerEntry } from '../../shell/drawerUrl'
import { closeDrawer, setDrawerParams } from '../../shell/drawers'
import {
  botParam,
  createHelpFillSource,
  DomainText,
  Drawer,
  DrawerGrid,
  DrawerMain,
  DrawerRail,
  DrawerSection,
  HelpFill,
  UrlText,
  wayParam,
  type HelpFillSource
} from '../../ui'
import { useCitedPages } from '../hooks/useCitedPages'
import { createCitationsSource, type CitationsSource } from '../source'
import '../../assistant/drawer/ask-drawer.css'
import './pitch.css'

/**
 * Citations → "✦ Draft a pitch" (HelpFill.dc.html panel 7): a short email to a site
 * Google's AI Overview cites next to competitors for one question, and not you.
 * "Draft it for me" runs the `citations.pitch` assist; "Write it with my ChatGPT"
 * copies a prompt with the site, its cited page, the question and your page. The
 * pitch shows with Copy. CiteFox never sends it.
 *
 * On the URL: `pitch.row` (the cited page's opaque id), `pitch.page` and
 * `pitch.prompt` (the question), `pitch.help` and `pitch.bot` (✦'s way and chatbot).
 */
export function PitchDrawer({
  projectId,
  entry,
  depth,
  source,
  helpSource,
  openLink
}: {
  projectId: string
  entry: DrawerEntry
  depth: number
  /** Tests only: the cited pages, ✦'s channels and the browser opener. */
  source?: CitationsSource
  helpSource?: HelpFillSource
  openLink?: (url: string) => void
}): JSX.Element {
  const client = useMemo(() => source ?? createCitationsSource(), [source])
  const help = useMemo(() => helpSource ?? createHelpFillSource(), [helpSource])
  const state = useCitedPages(client, projectId)
  const params = entry.params
  const rowId = params['pitch.row'] ?? null
  const pageId = params['pitch.page'] ?? null
  const promptId = params['pitch.prompt'] ?? null
  const close = (): void => closeDrawer(depth)
  const facts = useMemo(
    () =>
      state.data === null || rowId === null || pageId === null || promptId === null
        ? null
        : pitchFacts(state.data, rowId, `${pageId}|${promptId}`),
    [state.data, rowId, pageId, promptId]
  )
  const [pitch, setPitch] = useState<string | null>(null)

  if (state.data === null) {
    return (
      <Drawer
        id="pitch"
        title="Draft a pitch"
        loading={state.error === null}
        error={state.error === null ? undefined : { message: state.error, onRetry: state.reload }}
        onClose={close}
      />
    )
  }
  if (facts === null || pageId === null || promptId === null || rowId === null) {
    return (
      <Drawer
        id="pitch"
        title="Draft a pitch"
        onClose={close}
        error={{
          message:
            'That cited page is not in the latest checks any more, or is not available to you.'
        }}
      />
    )
  }
  return (
    <Drawer
      id="pitch"
      title="Draft a pitch"
      subtitle={`An email to ${facts.row.domain}. CiteFox never sends it: copy it into your email.`}
      onClose={close}
      footer={{ cancel: 'Close' }}
    >
      <DrawerGrid>
        <DrawerMain>
          <DrawerSection
            title="The pitch"
            description="Ask them to cite your page next to the competitors they already name."
            testId="pitch-main"
          >
            <HelpFill
              kind="pitch"
              projectId={projectId}
              scope={{ pageId, promptId, subject: rowId }}
              source={help}
              way={wayParam(params['pitch.help'])}
              onWay={(way) => setDrawerParams(depth, { 'pitch.help': way }, { push: true })}
              bot={botParam(params['pitch.bot'])}
              onBot={(bot) => setDrawerParams(depth, { 'pitch.bot': bot })}
              ways={{
                describe: {
                  title: 'Draft it for me',
                  text: 'CiteFox writes a short pitch email from the facts here.'
                },
                chatbot: {
                  title: 'Write it with my ChatGPT',
                  text: 'The prompt includes the site, its cited page, the question and your page.'
                }
              }}
              describe={{
                label: 'Anything to add? (optional)',
                placeholder: 'For example: we can offer their readers a free month.',
                buttonLabel: () => 'Draft the pitch'
              }}
              chatbot={{
                pastePlaceholder: (name) => `Paste the email ${name} wrote…`,
                tip: 'It shows below with Copy. Nothing is sent.'
              }}
              onRows={(result) => setPitch(result.text ?? null)}
              {...(openLink ? { openLink } : {})}
              testId="pitch-hf"
            />
            {pitch ? (
              <div className="pitch-draft" data-testid="pitch-draft">
                <CopyDraft text={pitch} label="Pitch email" />
              </div>
            ) : null}
          </DrawerSection>
        </DrawerMain>
        <DrawerRail label="What the pitch is about">
          <DrawerSection title="The facts" testId="pitch-facts">
            <dl className="pitch-facts">
              <dt>The site</dt>
              <dd>
                <DomainText domain={facts.row.domain} />
              </dd>
              <dt>Its cited page</dt>
              <dd>
                {facts.row.title ? (
                  <UrlText url={facts.row.url} label={facts.row.title} plain />
                ) : (
                  <UrlText url={facts.row.url} />
                )}
              </dd>
              <dt>The question</dt>
              <dd>{facts.question}</dd>
              <dt>Cited next to it</dt>
              <dd className="pitch-domains">
                {facts.competitors.map((domain) => (
                  <DomainText key={domain} domain={domain} />
                ))}
              </dd>
              <dt>You</dt>
              <dd>Not cited for this question.</dd>
              <dt>Your matching page</dt>
              <dd>{facts.yourPage}</dd>
            </dl>
          </DrawerSection>
        </DrawerRail>
      </DrawerGrid>
    </Drawer>
  )
}

interface PitchFactsView {
  row: CitedPageRow
  question: string
  yourPage: string
  /** Competitor domains Google cites in the same overviews. */
  competitors: string[]
}

/** The rail's facts from the cited pages; null when the page or question is not there. */
function pitchFacts(
  data: CitedPagesData,
  rowId: string,
  questionId: string
): PitchFactsView | null {
  const row = data.rows.find((item) => item.id === rowId && item.whose === 'other')
  const question = row?.questions.find((item) => item.id === questionId)
  if (row === undefined || question === undefined) return null
  const overviews = new Set(
    row.overviews.filter((item) => item.questionId === questionId).map((item) => item.id)
  )
  const competitors = [
    ...new Set(
      data.rows
        .filter(
          (item) =>
            item.whose === 'competitor' &&
            item.overviews.some((overview) => overviews.has(overview.id))
        )
        .map((item) => item.domain)
    )
  ]
  return { row, question: question.promptText, yourPage: question.pageLabel, competitors }
}
