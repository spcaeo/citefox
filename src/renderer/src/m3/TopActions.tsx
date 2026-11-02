import { useState, type JSX } from 'react'
import type { PageResults, TopActionScreen } from '@shared/domain'
import { copyText } from '../components/clipboard'
import { Markdown } from '../components/Markdown'
import { DrillLink } from '../drill'
import { AiTag } from '../pageSetup/bits'
import { fixDraftFromActions, planFixHash } from '../progress/model'
import { pageHash, readHash } from '../shell/routes'
import { IconButton, LinkButton, SectionHead, useAssistMenu } from '../ui'
import { Dotted } from './bits'
import type { ResultsAssistScope } from './ResultsAssists'
import type { ResultsDrills } from './results/drills'

type CopyState = 'idle' | 'copied' | 'failed'

/** "Top actions this week" on the results tab (FR-12.9). */
export function TopActions({
  pageId,
  results,
  drills,
  assists
}: {
  pageId: string
  results: PageResults
  /** Turns on "Suggest top actions" (FR-25). */
  assists?: ResultsAssistScope
  /** Prompt links open Prompt detail in this market and check. */
  drills: Pick<ResultsDrills, 'prompt'>
}): JSX.Element {
  const [copy, setCopy] = useState<CopyState>('idle')
  const ai = useAssistMenu({
    label: 'AI actions for top actions',
    scope: {
      projectId: assists?.projectId ?? null,
      pageId: assists?.pageId ?? null,
      marketId: assists?.marketId ?? null,
      ...(assists?.client ? { client: assists.client } : {})
    },
    actions: [{ assistId: 'results.topActions', label: 'Suggest top actions', seconds: 15 }],
    footer: 'Reads saved results only. Uses no searches.'
  })

  async function onCopy(): Promise<void> {
    setCopy((await copyText(topActionsText(results))) ? 'copied' : 'failed')
  }

  if (results.topActions.length === 0) {
    return (
      <section className="card m3-summary" id="m3-actions" aria-labelledby="m3-act-h">
        <SectionHead
          id="m3-act-h"
          title="Top actions this week"
          description="No actions for this check yet. CiteFox AI ranks them after a check that has AI Overviews to learn from. Until then, start from the questions where another site is cited instead."
        />
      </section>
    )
  }

  return (
    <section className="card m3-summary" id="m3-actions" aria-labelledby="m3-act-h">
      <AiTag>
        <Dotted text="CiteFox AI · from this check" />
      </AiTag>
      <SectionHead
        id="m3-act-h"
        title="Top actions this week"
        description={`Ranked by how close each question is to a citation and how soon it matters. All ${results.topActions.length} shown.`}
        actions={
          <>
            <LinkButton variant="text" href={planFixHash(pageId, fixDraftFromActions(results))}>
              Plan as Fix {results.scope.nextFixNumber}
            </LinkButton>
            <IconButton
              size="sm"
              tip
              icon={copy === 'copied' ? 'check' : 'copy'}
              label={copy === 'copied' ? 'Copied' : 'Copy top actions'}
              onClick={() => void onCopy()}
            />
            <span className={copy === 'failed' ? 'hint' : 'sr-only'} role="status">
              {copy === 'failed'
                ? 'Could not copy. Select the list and copy it instead.'
                : copy === 'copied'
                  ? 'Top actions copied.'
                  : ''}
            </span>
          </>
        }
        ai={assists ? ai.menu : undefined}
      />
      {assists ? ai.card : null}
      <ol className="m3-actions">
        {results.topActions.map((action) => {
          const prompt = action.promptId
            ? results.prompts.find((row) => row.promptId === action.promptId)
            : undefined
          const target = prompt ? drills.prompt(prompt) : null
          return (
            <li key={action.rank} className="m3-action">
              <span className="m3-act-n mono" aria-hidden="true">
                {action.rank}
              </span>
              <div className="stack-tight">
                <Markdown className="m3-action-title" baseLevel={3}>
                  {action.text}
                </Markdown>
                <Markdown className="muted" baseLevel={3}>
                  {action.reason}
                </Markdown>
                <div className="ps-row">
                  <a className="m3-action-link" href={destination(pageId, action.screen)}>
                    {action.linkLabel}
                  </a>
                  {prompt && target ? (
                    <DrillLink
                      target={target}
                      className="m3-link"
                      label={`Open question ${prompt.promptPosition}: ${prompt.label.split('**').join('')}`}
                    >
                      Question {prompt.promptPosition}
                    </DrillLink>
                  ) : null}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

/** Plain text for the clipboard: a heading, then one numbered action and its reason per item. */
function topActionsText(results: PageResults): string {
  const lines = results.topActions.map(
    (action) => `${action.rank}. ${action.text}\n   ${action.reason}`
  )
  return ['Top actions this week', ...lines].join('\n')
}

function destination(pageId: string, screen: TopActionScreen): string {
  if (screen === 'page_read') return readHash(pageId)
  if (screen === 'communities') return pageHash(pageId, 'communities')
  return pageHash(pageId, 'gaps')
}
