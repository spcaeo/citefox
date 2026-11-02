import { describe, expect, test } from 'vitest'
import { DrillRegistry } from './drills'
import {
  linkedinKind,
  normalizeVideoUrl,
  redditThreadUrl,
  subredditOf,
  youtubeVideoId
} from './source-urls'

describe('source URL facts', () => {
  test.each([
    ['https://www.youtube.com/watch?v=Abc123XYZ00&t=49', 'Abc123XYZ00'],
    ['https://youtu.be/Abc123XYZ00?si=xyz&t=3', 'Abc123XYZ00'],
    ['https://m.youtube.com/shorts/Abc123XYZ00?feature=share', 'Abc123XYZ00'],
    ['https://www.youtube.com/embed/Abc123XYZ00?pp=1', 'Abc123XYZ00'],
    ['https://www.youtube.com/@channel', null],
    ['https://example.com/watch?v=Abc123XYZ00', null],
    ['not a url', null]
  ])('video id of %s', (url, id) => {
    expect(youtubeVideoId(url)).toBe(id)
  })

  test('video URLs normalise to one watch URL; other URLs drop share noise', () => {
    expect(normalizeVideoUrl('https://youtu.be/Abc123XYZ00?t=49&vl=en')).toBe(
      'https://www.youtube.com/watch?v=Abc123XYZ00'
    )
    expect(normalizeVideoUrl('https://vimeo.com/1?si=2&x=1')).toBe('https://vimeo.com/1?x=1')
  })

  test('subreddits and thread URLs', () => {
    expect(subredditOf('https://old.reddit.com/r/SysAdmin/comments/abc/title/xyz/')).toBe(
      'r/sysadmin'
    )
    expect(subredditOf('https://example.com/r/x')).toBeNull()
    expect(redditThreadUrl('https://www.reddit.com/r/sysadmin/comments/abc/title/def/?q=1')).toBe(
      'https://www.reddit.com/r/sysadmin/comments/abc/'
    )
  })

  test('LinkedIn kinds', () => {
    expect(linkedinKind('https://www.linkedin.com/pulse/how-we-moved')).toBe('article')
    expect(linkedinKind('https://www.linkedin.com/posts/x_activity-1')).toBe('post')
    expect(linkedinKind('https://www.linkedin.com/company/x')).toBe('other')
  })
})

describe('drill registry', () => {
  test('the same token with other ids gets its own list, so n always matches', () => {
    const drills = new DrillRegistry()
    expect(drills.count('aio:shown', ['r1', 'r2', 'r2'])).toEqual({ n: 2, drill: 'aio:shown' })
    expect(drills.count('aio:shown', ['r1', 'r2'])).toEqual({ n: 2, drill: 'aio:shown' })
    expect(drills.count('aio:shown', ['r3'])).toEqual({ n: 1, drill: 'aio:shown#2' })
    expect(drills.toRecord()).toEqual({ 'aio:shown': ['r1', 'r2'], 'aio:shown#2': ['r3'] })
  })
})
