import { useEffect, useId, useState, type JSX } from 'react'
import {
  SHIPPED_TEMPLATE_NAME,
  type GenerationTemplate,
  type GenerationTemplateKind
} from '@shared/domain'
import type { TemplatesClient } from '../templates/client'
import './generate.css'

/** True when a template name already says "default", so the label needs no marker. */
function namesDefault(name: string): boolean {
  return /\bdefault\b/i.test(name)
}

/** Optional per-run template. An empty value omits `templateId`. */
export function TemplatePicker({
  id,
  templates,
  value,
  onChange
}: {
  id: string
  templates: readonly GenerationTemplate[]
  value: string
  onChange: (templateId: string) => void
}): JSX.Element {
  const fallback = templates.find((item) => item.isDefault) ?? templates[0]
  const fallbackName = fallback?.name ?? SHIPPED_TEMPLATE_NAME
  const selected = templates.find((item) => item.id === value) ?? null
  const status =
    value.trim().length === 0 || !selected
      ? 'No template picked. The default applies.'
      : `This run uses ${selected.name}.`
  return (
    <div className="gen-pick">
      <label className="gen-pick-field" htmlFor={id}>
        <span className="gen-pick-label">Template</span>
        <select
          id={id}
          className="ui-input ui-input-sm gen-pick-select"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">
            {namesDefault(fallbackName) ? 'Use the default' : `Use the default (${fallbackName})`}
          </option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
              {template.isDefault && !namesDefault(template.name) ? ' (default)' : ''}
            </option>
          ))}
        </select>
      </label>
      <p className="gen-pick-status" role="status">
        {status}
      </p>
    </div>
  )
}

/** Loads the live templates of one kind and lets the run omit `templateId`. */
export function TemplatePickerField({
  client,
  kind,
  value,
  onChange
}: {
  client: TemplatesClient
  kind: GenerationTemplateKind
  value: string
  onChange: (templateId: string) => void
}): JSX.Element {
  const id = useId()
  const [templates, setTemplates] = useState<readonly GenerationTemplate[]>([])

  useEffect(() => {
    let cancelled = false
    void client.list({ kind }).then(
      (list) => {
        if (!cancelled) setTemplates(list)
      },
      () => {
        if (!cancelled) setTemplates([])
      }
    )
    return () => {
      cancelled = true
    }
  }, [client, kind])

  return <TemplatePicker id={id} templates={templates} value={value} onChange={onChange} />
}
