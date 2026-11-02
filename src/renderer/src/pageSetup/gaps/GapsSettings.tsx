import type { JSX } from 'react'
import type { CoverageMatrix } from '@shared/domain'
import { TemplatePickerField } from '../../generate/TemplatePicker'
import type { TemplatesClient } from '../../templates/client'
import { Drawer, DrawerFacts, DrawerGrid, DrawerSection, ExpertOptions } from '../../ui'
import { formatReadStamp } from '../model'
import { TemplateProvenance } from '../TemplateProvenance'

/**
 * "Content gaps settings" (`?drawer=gp-settings`): what wrote this matrix,
 * and "Write content gaps again" with a template under Expert options. Off the
 * main surface; setup writes the matrix again by itself when the page changes.
 */
export function GapsSettingsDrawer({
  matrix,
  templatesClient,
  templateId,
  onTemplate,
  busy,
  error,
  onRewrite,
  onClose
}: {
  matrix: CoverageMatrix
  templatesClient: TemplatesClient
  templateId: string
  onTemplate: (templateId: string) => void
  busy: boolean
  /** Why the last rewrite failed. */
  error: string | null
  onRewrite: () => void
  onClose: () => void
}): JSX.Element {
  return (
    <Drawer
      id="gp-settings"
      title="Content gaps settings"
      subtitle="This page · how CiteFox AI writes the coverage matrix again"
      busy={busy}
      closeDisabled={busy}
      onClose={onClose}
      testId="gaps-settings-drawer"
      footer={{
        summary: 'Runs on your AI plan · uses no searches',
        primary: {
          label: 'Write content gaps again',
          icon: 'refresh',
          busy,
          onClick: onRewrite
        }
      }}
    >
      <DrawerGrid>
        <DrawerSection
          title="This matrix"
          span={6}
          description="CiteFox writes it again by itself when the page content changes."
        >
          <DrawerFacts
            label="This matrix"
            items={[
              { label: 'Written', value: formatReadStamp(matrix.recordedAt) },
              {
                label: 'Template',
                value: (
                  <span className="gp-tag">
                    <TemplateProvenance
                      templateId={matrix.templateId}
                      templateName={matrix.templateName}
                      templateHash={matrix.templateHash}
                      edited={matrix.templateUpdatedAt !== null}
                    />
                  </span>
                )
              },
              {
                label: 'Page changed',
                value: matrix.stale ? 'Yes, since this was written' : 'No'
              }
            ]}
          />
        </DrawerSection>
        <DrawerSection
          title="Write it again"
          span={6}
          description="CiteFox AI compares each buyer question with the page again and lists what to add."
        >
          {error ? (
            <p className="ps-error" role="alert">
              {error}
            </p>
          ) : null}
        </DrawerSection>
        <ExpertOptions summary="Template: the page's default unless you pick one">
          <TemplatePickerField
            client={templatesClient}
            kind="coverage_matrix"
            value={templateId}
            onChange={onTemplate}
          />
        </ExpertOptions>
      </DrawerGrid>
    </Drawer>
  )
}
