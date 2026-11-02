import { useEffect, useState, type JSX } from 'react'
import type { PageDetail, PageReadProgress, PageReadResult } from '@shared/ipc'
import type { AssistClient } from '../assist/client'
import { DrillHost } from '../drill'
import { LoadError } from '../components/LoadError'
import { errorText as loadErrorText } from '../components/errorText'
import { displayUrl } from '../projects/copy'
import type { ShellClient } from '../projects/client'
import { marketLabel } from '../shell/model'
import { navigateHash, pageHash } from '../shell/routes'
import { ScreenHeader } from '../components/Header'
import { Button, Panel, RightRail, Stepper, UrlText, WizardFooter, useAssistMenu } from '../ui'
import { autoReadKey, takeAutoRead } from './autoRead'
import { errorText } from './text'
import { readFailed } from './model'
import { usePromptContext } from './readContext'
import { ReadHead } from './ReadHead'
import { ReadFaqs, ReadOutline } from './ReadOutline'
import { PROMISES_ACTION, ReadBody, ReadOk, ReadPromises } from './ReadRail'
import { FailedRead, ProgressList } from './ReadStatus'
import { PAGE_SETUP_STEPS } from './setupSteps'
import './readScreen.css'

/**
 * Page read (FR-2, Mockups/PageRead.dc.html in the v2 wizard look): step 1 of
 * page setup. What Google sees first, the outline and FAQs as list grids, and a
 * rail with the read status, the page's promises and the body text. One AI
 * menu holds the page assists; the sticky footer goes on to the buyer profile.
 */
export function PageReadScreen({
  client,
  projectId,
  page,
  assistClient
}: {
  client: ShellClient
  projectId: string
  page: PageDetail
  /** Defaults to the assist client for this window. */
  assistClient?: AssistClient
}): JSX.Element {
  const [result, setResult] = useState<PageReadResult | null | undefined>(undefined)
  const [phases, setPhases] = useState<readonly PageReadProgress[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const context = usePromptContext(client, projectId, page, attempt)
  const titleFlag = result?.flags.some((flag) => flag.code === 'title_long') ?? false
  const failed = result ? readFailed(result) : false
  const readOk = Boolean(result) && !failed
  const { menu, card } = useAssistMenu({
    label: 'AI actions for this page',
    scope: { projectId, pageId: page.id, client: assistClient },
    actions: [
      ...(titleFlag
        ? [
            {
              assistId: 'page.shorterTitle',
              label: 'Suggest a shorter title',
              seconds: 8,
              disabled: busy
            }
          ]
        : []),
      {
        assistId: 'page.promises',
        label: PROMISES_ACTION,
        seconds: 15,
        disabled: busy || !readOk,
        // The answer is saved as the read's summary: reload it so the rail panel fills.
        onResult: () => {
          void client.getRead({ projectId, pageId: page.id }).then(
            (read) => setResult(read),
            () => undefined
          )
        }
      },
      {
        assistId: 'page.checkFacts',
        label: 'Check facts on the page',
        seconds: 20,
        disabled: busy || !readOk
      },
      {
        // Opt-in web search (prompt audit P7): only the claims go out, never the page.
        assistId: 'page.verifyClaims',
        label: 'Check the claims online',
        seconds: 60,
        disabled: busy || !readOk
      }
    ]
  })

  useEffect(() => {
    return client.onReadProgress((payload) => {
      if (payload.pageId !== page.id) return
      setPhases((current) => [...current, payload])
    })
  }, [client, page.id])

  useEffect(() => {
    let cancelled = false
    const key = autoReadKey(projectId, page.id)
    void client.getRead({ projectId, pageId: page.id }).then(
      (read) => {
        if (cancelled) return
        setResult(read)
        const claim = takeAutoRead(key, read, () =>
          client.readStart({
            projectId,
            pageId: page.id,
            reader: 'auto',
            suppliedText: null
          })
        )
        if (claim === null) return
        if (claim.owner) {
          setError(null)
          setPhases([])
        }
        setBusy(true)
        void claim.promise.then(
          (next) => {
            if (cancelled) return
            setResult(next)
            setBusy(false)
          },
          (cause: unknown) => {
            if (cancelled) return
            setError(errorText(cause, 'Could not read the page.'))
            setBusy(false)
          }
        )
      },
      (cause: unknown) => {
        if (!cancelled) setLoadError(loadErrorText(cause, 'Could not load the page read.'))
      }
    )
    return () => {
      cancelled = true
    }
  }, [client, projectId, page.id, attempt])

  async function runRead(reader: 'auto' | 'jina' | 'file', suppliedText?: string): Promise<void> {
    setError(null)
    setBusy(true)
    setPhases([])
    try {
      const next = await client.readStart({
        projectId,
        pageId: page.id,
        reader,
        suppliedText: suppliedText ?? null
      })
      setResult(next)
    } catch (cause: unknown) {
      setError(errorText(cause, 'Could not read the page.'))
    } finally {
      setBusy(false)
    }
  }

  async function onFile(file: File | undefined): Promise<void> {
    if (!file) return
    const text = await file.text()
    await runRead('file', text)
  }

  const pageUrl = page.url ?? ''

  return (
    <DrillHost>
      <div className="rd">
        {/* The wizard pattern: the back row, the title, then the stepper. */}
        <ScreenHeader
          nav={{
            back: { href: pageHash(page.id, 'results'), label: 'Results' },
            ...(pageUrl ? { detail: <UrlText url={pageUrl} label={displayUrl(pageUrl)} /> } : {})
          }}
          title="Check what CiteFox read"
          meta={
            <div className="rd-markets" role="group" aria-label="Markets">
              {page.markets.map((market) => (
                <a
                  key={market.id}
                  className="rd-market"
                  href={pageHash(page.id, 'markets', { marketId: market.id })}
                  aria-label={`${marketLabel(market)}${market.id === page.defaultMarketId ? ' (default)' : ''}: open in Markets`}
                >
                  {marketLabel(market)}
                  {market.id === page.defaultMarketId ? (
                    <span className="rd-faint"> (default)</span>
                  ) : null}
                </a>
              ))}
            </div>
          }
          actions={menu}
        />
        <Stepper label="Setup steps" steps={PAGE_SETUP_STEPS} current="read" />

        {card}

        {error ? (
          <p className="rd-error" role="alert">
            {error}
          </p>
        ) : null}

        {result === undefined && !busy && loadError ? (
          <LoadError
            title="CiteFox could not load what it read on this page."
            message={loadError}
            onRetry={() => {
              setLoadError(null)
              setAttempt((current) => current + 1)
            }}
          />
        ) : null}
        {result === undefined && !busy && !loadError ? (
          <p role="status">Loading the page read…</p>
        ) : null}
        {busy && (result === null || result === undefined) ? (
          <section className="rd-card" aria-label="Read status" role="status">
            <p>Reading this page…</p>
            <ProgressList phases={phases} />
          </section>
        ) : null}
        {result === null && !busy ? (
          <Panel label="Read status">
            <p>CiteFox has not read this page yet.</p>
            <div className="rd-actions">
              <Button size="sm" onClick={() => void runRead('auto')}>
                Read again
              </Button>
            </div>
          </Panel>
        ) : null}

        {result && failed ? (
          <FailedRead
            result={result}
            busy={busy}
            phases={phases}
            onAgain={() => void runRead('auto')}
            onJina={() => void runRead('jina')}
            onFile={(file) => void onFile(file)}
          />
        ) : null}

        {result && !failed ? (
          <div className="rd-layout">
            <div className="rd-main">
              <ReadHead result={result} pageUrl={pageUrl} />
              <ReadOutline result={result} context={context} />
              <ReadFaqs result={result} pageId={page.id} context={context} />
            </div>
            <RightRail label="About this read">
              <ReadOk
                result={result}
                pageId={page.id}
                busy={busy}
                phases={phases}
                onAgain={() => void runRead('auto')}
                onJina={() => void runRead('jina')}
              />
              <ReadPromises result={result} context={context} />
              <ReadBody result={result} pageId={page.id} />
            </RightRail>
          </div>
        ) : null}

        <WizardFooter
          onBack={() => navigateHash(pageHash(page.id, 'results'))}
          note="Next: CiteFox AI writes a buyer profile from this read · no searches"
          primary={{
            label: 'Continue: build buyer profile',
            onClick: () => navigateHash(pageHash(page.id, 'audience'))
          }}
        />
      </div>
    </DrillHost>
  )
}
