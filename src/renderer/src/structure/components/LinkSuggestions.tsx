import { useState, type JSX } from 'react'
import type { InternalLinkSuggestion } from '@shared/ipc'
import { copyText } from '../../components/clipboard'
import { pageHash } from '../../shell/routes'
import { IconButton, Panel, UrlText } from '../../ui'
import type { LinkSuggestionsState } from '../hooks/useLinkSuggestions'
import { pagePath } from '../utils/model'

/** Says what made the list: rules over the cluster's pages, not Claude. */
const RULE_NOTE =
  'Rule-based: a link from each orphan and supporting page to the cluster’s main page. No searches · copy a link to add it on your site.'

/**
 * The suggested links as one small panel. They come from rules, not Claude, so
 * the panel is plain (no AI card). Nothing changes on the site; each link copies.
 */
export function LinkSuggestionsCard({
  state
}: {
  state: LinkSuggestionsState
}): JSX.Element | null {
  const [copied, setCopied] = useState<string | null>(null)
  const { links, status } = state
  if (status === 'idle' && links === null) return null

  async function copy(link: InternalLinkSuggestion): Promise<void> {
    const ok = await copyText(
      `From ${link.fromUrl} to ${link.toUrl}. Anchor text "${link.anchor}". ${link.where}`
    )
    setCopied(ok ? `${link.fromPageId}>${link.toPageId}` : null)
  }

  const title =
    links === null
      ? 'Suggest internal links'
      : links.length === 0
        ? 'No links to suggest in this cluster.'
        : `${links.length} internal ${links.length === 1 ? 'link' : 'links'} to add in this cluster`

  return (
    <Panel
      title={title}
      titleAs="h3"
      padding={16}
      actions={
        <IconButton
          icon="x"
          label="Close the link suggestions"
          data-tip="Close the link suggestions"
          onClick={state.close}
        />
      }
    >
      {status === 'loading' ? <p role="status">Finding links…</p> : null}
      {status === 'error' ? <p role="alert">Could not suggest links. Try again.</p> : null}
      {links && links.length > 0 ? (
        <ul className="str-links" role="status">
          {links.map((link) => {
            const key = `${link.fromPageId}>${link.toPageId}`
            return (
              <li key={key} className="str-link-row">
                <UrlText url={link.fromUrl} label={pagePath(link.fromUrl)}>
                  <a className="str-path-link" href={pageHash(link.fromPageId)}>
                    {pagePath(link.fromUrl)}
                  </a>
                </UrlText>
                <span aria-hidden="true">→</span>
                <span className="sr-only">links to</span>
                <UrlText url={link.toUrl} label={pagePath(link.toUrl)}>
                  <a className="str-path-link" href={pageHash(link.toPageId)}>
                    {pagePath(link.toUrl)}
                  </a>
                </UrlText>
                <span className="str-muted">
                  Anchor text “{link.anchor}” · {link.where}
                </span>
                <IconButton
                  size="sm"
                  tip
                  icon={copied === key ? 'check' : 'copy'}
                  label={copied === key ? 'Copied' : `Copy the link from ${pagePath(link.fromUrl)}`}
                  onClick={() => void copy(link)}
                />
              </li>
            )
          })}
        </ul>
      ) : null}
      <p className="str-muted">{RULE_NOTE}</p>
    </Panel>
  )
}
