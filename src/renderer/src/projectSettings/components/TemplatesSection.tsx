import { useEffect, useId, useState, type JSX } from 'react'
import { Button, LinkButton } from '../../ui'
import type { GenerationTemplate, ProjectTemplateOverride } from '@shared/domain'
import { sectionHash } from '../../shell/routes'
import type { TemplatesClient } from '../../templates/client'
import { TEMPLATE_KINDS } from '../constants'
import { useSave } from '../hooks/useSave'
import type { SectionProps } from '../types'
import { errorText } from '../utils/model'
import { SaveStatus, Section } from './bits'

/** TPL-1. The app defaults are shared; a project may pick another named template per kind. */
export function TemplatesSection({
  view,
  admin,
  refresh,
  templatesClient
}: SectionProps & { templatesClient: TemplatesClient }): JSX.Element {
  const base = useId()
  const [templates, setTemplates] = useState<readonly GenerationTemplate[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [choice, setChoice] = useState<Record<string, string>>(() =>
    Object.fromEntries(view.templateOverrides.map((item) => [item.kind, item.templateId]))
  )
  const save = useSave()

  useEffect(() => {
    let cancelled = false
    templatesClient.list().then(
      (list) => {
        if (!cancelled) setTemplates(list)
      },
      (cause: unknown) => {
        if (!cancelled) setLoadError(errorText(cause, 'Could not load the templates.'))
      }
    )
    return () => {
      cancelled = true
    }
  }, [templatesClient])

  async function onSave(): Promise<void> {
    const overrides: ProjectTemplateOverride[] = TEMPLATE_KINDS.flatMap(({ kind }) => {
      const id = choice[kind]
      return id ? [{ kind, templateId: id }] : []
    })
    await save.run(async () => {
      await admin.updateProjectSettings({
        projectId: view.project.id,
        templateOverrides: overrides
      })
      await refresh()
    }, 'Template choices saved.')
  }

  return (
    <Section
      id={'ps-templates'}
      title="Templates"
      intro={`The app defaults are shared. Choose another named template here and only ${view.project.name} uses it.`}
      action={
        <LinkButton variant="text" href={sectionHash('templates')}>
          Open template editor
        </LinkButton>
      }
    >
      {templates === null ? (
        <p role="status">{loadError ?? 'Loading templates…'}</p>
      ) : (
        <>
          <div className="ps-grid3">
            {TEMPLATE_KINDS.map(({ kind, label }) => {
              const options = templates.filter((item) => item.kind === kind)
              const fallback = options.find((item) => item.isDefault)
              const value = choice[kind] ?? ''
              return (
                <div className="field" key={kind}>
                  <label className="field-label" htmlFor={`${base}-${kind}`}>
                    {label}
                  </label>
                  <select
                    id={`${base}-${kind}`}
                    className="select"
                    aria-describedby={`${base}-${kind}-h`}
                    value={value}
                    onChange={(event) =>
                      setChoice((current) => ({ ...current, [kind]: event.target.value }))
                    }
                  >
                    <option value="">
                      Uses app default{fallback ? ` (${fallback.name})` : ''}
                    </option>
                    {options
                      .filter((item) => !item.isDefault)
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                  </select>
                  <span className="hint" id={`${base}-${kind}-h`}>
                    {value ? 'Chosen for this project' : 'Uses app default'}
                  </span>
                </div>
              )
            })}
          </div>
          <div className="actions">
            <Button
              variant="primary"
              disabled={save.state.kind === 'saving'}
              onClick={() => void onSave()}
            >
              Save template choices
            </Button>
          </div>
          <SaveStatus state={save.state} />
        </>
      )}
    </Section>
  )
}
