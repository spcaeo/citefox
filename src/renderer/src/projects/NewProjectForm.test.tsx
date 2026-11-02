// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { takeProjectCreated } from '../start/createdNotice'
import { createMockShellClient } from './mockClient'
import { NewProjectForm } from './NewProjectForm'

beforeEach(() => {
  window.location.hash = '#/projects/new'
})
afterEach(cleanup)

describe('New project', () => {
  it('creates once on a double click, then opens the new project’s start screen', async () => {
    const base = createMockShellClient()
    let creates = 0
    const client = {
      ...base,
      createProject: async (request: Parameters<typeof base.createProject>[0]) => {
        creates += 1
        return base.createProject(request)
      }
    }
    render(<NewProjectForm client={client} heading="h1" onCreated={async () => undefined} />)
    fireEvent.change(screen.getByLabelText(/Project name/), { target: { value: 'Harbor' } })
    fireEvent.change(screen.getByLabelText(/Website domain/), {
      target: { value: 'harbor.example' }
    })
    fireEvent.change(screen.getByLabelText('Brand names'), { target: { value: 'Harbor' } })
    const create = screen.getByRole('button', { name: 'Create project' })
    fireEvent.click(create)
    fireEvent.click(create)
    await waitFor(() => expect(window.location.hash).toBe('#/start/choose'))
    expect(creates).toBe(1)
    expect(takeProjectCreated()).toBe('Harbor')
  })
})
