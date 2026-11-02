import { describe, expect, it } from 'vitest'
import { projectRouteHash, splitProjectRoute } from './project-route'

describe('project routes', () => {
  it('prefixes a hash with the project it belongs to', () => {
    expect(projectRouteHash('p2', '#/pages/a/results')).toBe('#/p/p2/pages/a/results')
    expect(projectRouteHash('p2', '/project-settings')).toBe('#/p/p2/project-settings')
    expect(projectRouteHash('p2', 'pages/a/prompt/q?market=m1')).toBe(
      '#/p/p2/pages/a/prompt/q?market=m1'
    )
  })

  it('encodes the project id', () => {
    expect(projectRouteHash('a/b c', '#/pages')).toBe('#/p/a%2Fb%20c/pages')
    expect(splitProjectRoute('#/p/a%2Fb%20c/pages')).toEqual({
      projectId: 'a/b c',
      hash: '#/pages'
    })
  })

  it('splits a project route back into the project and the plain hash', () => {
    expect(splitProjectRoute('#/p/p2/pages/a/results?market=m1')).toEqual({
      projectId: 'p2',
      hash: '#/pages/a/results?market=m1'
    })
    expect(splitProjectRoute(projectRouteHash('p9', '#/status'))).toEqual({
      projectId: 'p9',
      hash: '#/status'
    })
  })

  it('reads a bare project route as that project with the default screen', () => {
    expect(splitProjectRoute('#/p/p2')).toEqual({ projectId: 'p2', hash: '#/' })
    expect(splitProjectRoute('#/p/p2/')).toEqual({ projectId: 'p2', hash: '#/' })
    expect(splitProjectRoute('#/p/p2?view=tracked')).toEqual({
      projectId: 'p2',
      hash: '#/?view=tracked'
    })
  })

  it('leaves other hashes alone', () => {
    for (const hash of ['#/pages', '#/projects', '#/playground', '#/p', '#/p/', '', '#/prompt']) {
      expect(splitProjectRoute(hash)).toEqual({ projectId: null, hash })
    }
  })

  it('treats a malformed project id as no project', () => {
    expect(splitProjectRoute('#/p/%E0%A4%A/pages')).toEqual({
      projectId: null,
      hash: '#/p/%E0%A4%A/pages'
    })
  })
})
