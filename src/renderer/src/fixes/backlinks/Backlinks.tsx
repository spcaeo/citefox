import { useEffect, useState, type JSX } from 'react'
import type { ChangeLedger } from '@shared/ipc'
import { useAiContext } from '../../assistant/context/useAiContext'
import { pluralize } from '@shared/pluralize'
import { IndexPill, PageCell, StatusChip } from '../../changes/cells'
import { pageName } from '../../changes/model'
import { copyText } from '../../components/clipboard'
import { cleanError } from '../../progress/model'
import {
  AiMenu,
  Chip,
  COPIED_MS,
  EmptyState,
  ListGrid,
  SectionMenu,
  type ListColumn
} from '../../ui'
import { pathOf } from '../model'
import type { ProjectFixesSource } from '../source'
import {
  backlinkCsv,
  backlinkRows,
  missingAnchorIds,
  PRIORITY_LABELS,
  urlList,
  type BacklinkRow
} from './model'

const PRIORITY_ORDER = { first: 0, next: 1 } as const

/**
 * Backlinks: the ask list for whoever builds links. Pages not cited yet, lost
 * ground or not indexed, First before Next, each with a suggested anchor text.
 * Copy all URLs, Download CSV, and the section's one AI menu writes missing anchors.
 */
export function Backlinks({
  ledger,
  projectId,
  client,
  now,
  reload
}: {
  ledger: ChangeLedger
  projectId: string
  client: ProjectFixesSource
  now: Date
  reload: () => void
}): JSX.Element {
  const rows = backlinkRows(ledger)
  const missing = missingAnchorIds(rows)
  useAiContext({
    numbers: [
      { label: 'Pages on the ask list', value: String(rows.length) },
      {
        label: 'Marked First',
        value: String(rows.filter((item) => item.priority === 'first').length)
      },
      { label: 'Without anchor text', value: String(missing.length) }
    ]
  })
  const [copied, setCopied] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [failures, setFailures] = useState<readonly string[]>([])
  const [writing, setWriting] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS)
    return () => window.clearTimeout(timer)
  }, [copied])

  async function copyAll(): Promise<void> {
    setCopied(await copyText(urlList(rows)))
  }

  async function download(): Promise<void> {
    setStatus(null)
    try {
      const result = await client['grid:exportCsv'](backlinkCsv(rows, ledger.domain, now))
      if (result.ok) setStatus(`Saved ${result.fileName}.`)
      else if (result.reason === 'failed') setStatus(result.message)
    } catch (cause) {
      setStatus(cleanError(cause, 'Could not save the CSV.'))
    }
  }

  async function suggest(): Promise<void> {
    if (missing.length === 0) return
    setWriting(true)
    setFailures([])
    setStatus(`Writing anchor text for ${pluralize(missing.length, 'page')}…`)
    try {
      const result = await client['fixes:suggestAnchors']({
        projectId,
        pageIds: missing,
        refresh: false
      })
      setStatus(`Wrote anchor text for ${pluralize(result.anchors.length, 'page')}.`)
      setFailures(
        result.failed.map((item) => {
          const found = rows.find((entry) => entry.row.pageId === item.pageId)
          return `${found ? pathOf(found.row.url) : item.pageId}: ${item.message}`
        })
      )
    } catch (cause) {
      setStatus(cleanError(cause, 'Could not write the anchor text.'))
    } finally {
      setWriting(false)
      reload()
    }
  }

  const columns: readonly ListColumn<BacklinkRow>[] = [
    {
      id: 'priority',
      label: 'Priority',
      width: 80,
      sort: (item) => PRIORITY_ORDER[item.priority],
      render: (item) => (
        <Chip size="sm" tone={item.priority === 'first' ? 'fox' : 'neutral'}>
          {PRIORITY_LABELS[item.priority]}
        </Chip>
      )
    },
    {
      id: 'page',
      label: 'Page',
      width: 'fill',
      minWidth: 200,
      sort: (item) => pageName(item.row).toLowerCase(),
      render: (item) => <PageCell row={item.row} site={ledger.domain} withKind />
    },
    {
      id: 'anchor',
      label: 'Suggested anchor text',
      width: 200,
      render: (item) =>
        item.anchor ? (
          <span className="mono bl-anchor" title={item.anchor}>
            {item.anchor}
          </span>
        ) : (
          <span className="faint" title="Use “Suggest anchor text” in the AI menu">
            —
          </span>
        )
    },
    {
      id: 'index',
      label: 'Google index',
      width: 116,
      render: (item) => <IndexPill row={item.row} />
    },
    {
      id: 'status',
      label: 'Status',
      width: 104,
      render: (item) => <StatusChip row={item.row} />
    }
  ]

  return (
    <div className="fxp-view bl-view">
      <section className="ui-panel bl-intro" aria-labelledby="bl-intro-h">
        <div>
          <h2 id="bl-intro-h" className="bl-intro-title">
            Build backlinks to these pages
          </h2>
          <p className="muted">
            The page itself covers what it says and how it is structured. Links from other sites
            help Google find a page sooner and treat it as worth citing. Start with the pages marked
            First, and tell CiteFox when links go live so the next measurement shows their effect.
          </p>
        </div>
        <ul className="bl-tips">
          <li>
            <strong>Link to the exact address</strong> in the list, not the home page.
          </li>
          <li>
            <strong>Use the suggested anchor text</strong>, or something close to it.
          </li>
          <li>
            <strong>Relevant sites first:</strong> partners, customers, guest articles and
            directories.
          </li>
          <li>
            <strong>Link between your own pages too:</strong> a link from a strong page helps a new
            one get found.
          </li>
        </ul>
      </section>
      <p className="muted fxp-notice" role="status">
        {status}
      </p>
      {failures.length > 0 ? (
        <ul className="bl-failed" aria-label="Pages without anchor text">
          {failures.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      <ListGrid<BacklinkRow>
        urlKey="links"
        label="Backlink ask list"
        noun={['page', 'pages']}
        rows={rows}
        rowKey={(item) => item.row.fixId}
        rowLabel={(item) => pageName(item.row)}
        columns={columns}
        search={{
          text: (item) => `${pageName(item.row)} ${item.row.url} ${item.anchor ?? ''}`,
          placeholder: 'Search pages'
        }}
        actions={
          <SectionMenu
            label="More actions for the backlink list"
            items={[
              {
                id: 'copy',
                label: copied ? 'Copied' : 'Copy all URLs',
                icon: copied ? 'check' : 'copy',
                ...(copied ? { tone: 'ok' as const } : {}),
                keepOpen: true,
                disabled: rows.length === 0,
                onSelect: () => void copyAll()
              },
              {
                id: 'csv',
                label: 'Download CSV',
                icon: 'download',
                disabled: rows.length === 0,
                onSelect: () => void download()
              }
            ]}
          />
        }
        ai={
          <AiMenu
            label="AI actions for the backlink list"
            actions={[
              {
                id: 'anchors',
                label:
                  missing.length === 0
                    ? 'Suggest anchor text (every page has one)'
                    : `Suggest anchor text for ${pluralize(missing.length, 'page')}`,
                seconds: 10,
                disabled: writing || missing.length === 0,
                onSelect: () => void suggest()
              }
            ]}
          />
        }
        empty={
          <EmptyState
            icon="check"
            title="No pages need backlinks right now."
            body="Pages not cited yet, lost ground or not indexed show up here."
          />
        }
      />
    </div>
  )
}
