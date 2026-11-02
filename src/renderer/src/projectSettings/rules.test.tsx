// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import type { ProjectRule, SaveProjectRuleRequest } from '@shared/ipc'
import { RulesSection } from './components/RulesSection'
import type { ProjectRulesSource } from './rulesClient'

afterEach(() => cleanup())

function fakeSource(start: ProjectRule[] = []): {
  source: ProjectRulesSource
  saves: SaveProjectRuleRequest[]
} {
  let rules = [...start]
  const saves: SaveProjectRuleRequest[] = []
  const at = '2026-11-01T10:00:00.000Z'
  return {
    saves,
    source: {
      'projectRules:list': async ({ projectId }) => ({ projectId, rules }),
      'projectRules:save': async (request) => {
        saves.push(request)
        if (request.id === null) {
          rules = [
            ...rules,
            {
              id: `r${rules.length + 1}`,
              text: request.text,
              enabled: true,
              createdAt: at,
              updatedAt: at
            }
          ]
        } else {
          rules = rules.map((rule) =>
            rule.id === request.id
              ? { ...rule, text: request.text, enabled: request.enabled }
              : rule
          )
        }
        return { projectId: request.projectId, rules }
      },
      'projectRules:delete': async ({ projectId, id }) => {
        rules = rules.filter((rule) => rule.id !== id)
        return { projectId, rules }
      }
    }
  }
}

describe('Project settings › Project rules', () => {
  test('adds, turns off, edits and deletes a rule', async () => {
    const { source, saves } = fakeSource([
      {
        id: 'r1',
        text: "Don't call us a cloud service",
        enabled: true,
        createdAt: '2026-10-31T10:00:00.000Z',
        updatedAt: '2026-10-31T10:00:00.000Z'
      }
    ])
    render(<RulesSection projectId="p1" projectName="TextBolt" source={source} />)
    const list = await screen.findByRole('list', { name: 'Project rules' })
    expect(within(list).getByText("Don't call us a cloud service")).toBeTruthy()

    fireEvent.change(screen.getByLabelText('New rule'), {
      target: { value: 'Say SMS, not texting' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    expect(await within(list).findByText('Say SMS, not texting')).toBeTruthy()
    expect(saves[0]).toEqual({
      projectId: 'p1',
      id: null,
      text: 'Say SMS, not texting',
      enabled: true
    })

    fireEvent.click(screen.getByRole('checkbox', { name: /Use the rule: Don't call us/ }))
    await waitFor(() => expect(saves[1]).toMatchObject({ id: 'r1', enabled: false }))

    fireEvent.click(screen.getByRole('button', { name: 'Edit the rule: Say SMS, not texting' }))
    fireEvent.change(screen.getByLabelText('Edit the rule'), { target: { value: 'Say SMS' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await within(list).findByText('Say SMS')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Delete the rule: Say SMS' }))
    await waitFor(() => expect(within(list).queryByText('Say SMS')).toBeNull())
  })

  test('says how to add the first rule', async () => {
    render(<RulesSection projectId="p1" projectName="TextBolt" source={fakeSource().source} />)
    expect(await screen.findByText(/No rules yet/)).toBeTruthy()
  })
})
