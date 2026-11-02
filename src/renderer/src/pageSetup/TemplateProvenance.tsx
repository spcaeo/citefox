import { useState, type JSX } from 'react'
import { templatesHash } from '../shell/routes'
import { templateProvenanceText, templateProvenanceTooltip } from './model'
import './prompts.css'

/**
 * One provenance phrase. The phrase links to the template in Templates; the
 * "Details" button shows the template id and short hash in place, so
 * keyboard and screen-reader users reach them too (not only a mouse tooltip).
 */
export function TemplateProvenance({
  templateId,
  templateName,
  templateHash,
  edited
}: {
  templateId: string
  templateName: string
  templateHash: string
  edited: boolean
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const ids = templateProvenanceTooltip(templateId, templateHash)
  return (
    <span className="ps-prov">
      <a href={templatesHash(templateId)} title={ids}>
        {templateProvenanceText(templateName, edited)}
      </a>{' '}
      <button
        type="button"
        className="ps-linkbtn ps-prov-more"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        Details<span className="sr-only"> of template {templateName}</span>
      </button>
      {open ? <span className="mono faint ps-prov-ids">{ids}</span> : null}
    </span>
  )
}
