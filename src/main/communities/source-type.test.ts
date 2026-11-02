import { describe, expect, test } from 'vitest'
import { normalizeUrl } from '../engine/checks/url'
import {
  forumSiteLabel,
  linkedinKind,
  redditThreadOf,
  sourceTypeOf,
  youtubeVideoId
} from './source-type'

function typeOf(raw: string): string {
  const normalized = normalizeUrl(raw)
  if (normalized === null) throw new Error(`not a URL: ${raw}`)
  return sourceTypeOf(normalized)
}

describe('YouTube URL normalisation (REPORT-SPEC §8)', () => {
  const canonical = 'https://youtube.com/watch?v=dQw4w9WgXcQ'

  test.each([
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=49s',
    'https://youtube.com/watch?t=49&v=dQw4w9WgXcQ&si=abc&feature=share&pp=ygU&vl=en',
    'http://m.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&index=4',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ?t=12&si=xyz',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    'https://youtube.com/shorts/dQw4w9WgXcQ?feature=share',
    'https://www.youtube.com/embed/dQw4w9WgXcQ?start=30',
    'https://www.youtube.com/live/dQw4w9WgXcQ',
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    'https://music.youtube.com/watch?v=dQw4w9WgXcQ&feature=share',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ#t=1m2s'
  ])('%s is one video', (raw) => {
    expect(normalizeUrl(raw)).toBe(canonical)
    expect(youtubeVideoId(canonical)).toBe('dQw4w9WgXcQ')
  })

  test('channel pages and invalid ids keep the ordinary normalisation', () => {
    expect(normalizeUrl('https://www.youtube.com/@OpsShortcuts/videos')).toBe(
      'https://youtube.com/@OpsShortcuts/videos'
    )
    expect(normalizeUrl('https://youtu.be/short')).toBe('https://youtu.be/short')
    expect(youtubeVideoId('https://youtube.com/@OpsShortcuts')).toBeNull()
    expect(youtubeVideoId('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull()
  })

  test('non-YouTube URLs are unchanged', () => {
    expect(normalizeUrl('https://example.com/watch?v=dQw4w9WgXcQ&t=4')).toBe(
      'https://example.com/watch?t=4&v=dQw4w9WgXcQ'
    )
  })
})

describe('sourceTypeOf (FR-17.1)', () => {
  test.each([
    ['https://www.reddit.com/r/sysadmin/comments/abc123/vtext_shutdown/', 'reddit'],
    ['https://old.reddit.com/r/msp/comments/xyz/', 'reddit'],
    ['https://redd.it/abc123', 'reddit'],
    ['https://youtu.be/dQw4w9WgXcQ', 'youtube'],
    ['https://m.youtube.com/shorts/dQw4w9WgXcQ', 'youtube'],
    ['https://www.youtube.com/@channel', 'youtube'],
    ['https://www.linkedin.com/posts/someone_activity-123', 'linkedin'],
    ['https://www.linkedin.com/pulse/vtext-shutdown-checklist-jane-doe', 'linkedin'],
    ['https://uk.linkedin.com/pulse/article', 'linkedin'],
    ['https://www.g2.com/products/textbolt/reviews', 'review'],
    ['https://www.capterra.com/p/1234/TextBolt/', 'review'],
    ['https://www.capterra.co.uk/software/1234/textbolt', 'review'],
    ['https://uk.trustpilot.com/review/textbolt.com', 'review'],
    ['https://www.trustradius.com/products/textbolt/reviews', 'review'],
    ['https://www.gartner.com/reviews/market/sms', 'review'],
    ['https://www.quora.com/What-is-the-cheapest-way-to-send-SMS', 'forum'],
    ['https://superuser.com/questions/1/sms', 'forum'],
    ['https://serverfault.com/questions/2/alerts', 'forum'],
    ['https://unix.stackexchange.com/questions/3/mail', 'forum'],
    ['https://stackoverflow.com/questions/4/twilio', 'forum'],
    ['https://community.spiceworks.com/t/replacement/123', 'forum'],
    ['https://techcommunity.microsoft.com/discussions/outlook/123', 'forum'],
    ['https://forum.grafana.com/t/email-alerts/99', 'forum'],
    ['https://discourse.example.org/t/sms/12', 'forum'],
    ['https://news.ycombinator.com/item?id=1', 'forum'],
    ['https://github.com/grafana/grafana/discussions/42', 'forum'],
    ['https://www.facebook.com/groups/smallbiz/posts/1', 'other'],
    ['https://x.com/someone/status/1', 'other'],
    ['https://www.tiktok.com/@someone/video/1', 'other'],
    ['https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/', 'web'],
    ['https://www.gartner.com/en/articles/sms', 'web'],
    ['https://github.com/grafana/grafana', 'web']
  ])('%s is %s', (raw, expected) => {
    expect(typeOf(raw)).toBe(expected)
  })
})

describe('community details from the URL', () => {
  test('a Reddit thread names its subreddit and id', () => {
    expect(
      redditThreadOf('https://reddit.com/r/sysadmin/comments/abc123/vtext_shutdown_what_now')
    ).toEqual({ subreddit: 'r/sysadmin', threadId: 'abc123' })
    expect(redditThreadOf('https://reddit.com/r/HVAC')).toEqual({
      subreddit: 'r/HVAC',
      threadId: null
    })
    expect(redditThreadOf('https://redd.it/abc123')).toEqual({
      subreddit: null,
      threadId: 'abc123'
    })
    expect(redditThreadOf('https://example.com/r/x/comments/1')).toBeNull()
  })

  test('a LinkedIn URL says what kind of page it is', () => {
    expect(linkedinKind('https://linkedin.com/posts/someone_activity-1')).toBe('post')
    expect(linkedinKind('https://linkedin.com/feed/update/urn:li:activity:1')).toBe('post')
    expect(linkedinKind('https://linkedin.com/pulse/vtext-shutdown')).toBe('article')
    expect(linkedinKind('https://linkedin.com/newsletters/sms-weekly-123')).toBe('newsletter')
    expect(linkedinKind('https://linkedin.com/company/textbolt')).toBe('profile')
    expect(linkedinKind('https://linkedin.com/in/someone')).toBe('profile')
    expect(linkedinKind('https://linkedin.com/jobs/view/1')).toBe('other')
  })

  test('a forum gets a readable site name', () => {
    expect(forumSiteLabel('community.spiceworks.com')).toBe('Spiceworks Community')
    expect(forumSiteLabel('quora.com')).toBe('Quora')
    expect(forumSiteLabel('g2.com')).toBe('G2')
    expect(forumSiteLabel('forum.grafana.com')).toBe('forum.grafana.com')
  })
})
