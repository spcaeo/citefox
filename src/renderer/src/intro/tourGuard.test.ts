import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { TOUR_CAPTIONS } from './captions'

/**
 * Guards for the welcome tour film: the captions never name a provider behind CiteFox,
 * the film's own timeline (scripts/media/video/tour.json, which the film is made from)
 * carries the very same captions, and the bundled files stay inside their size budgets.
 */

const ROOT = path.resolve(__dirname, '..', '..', '..', '..')
const ASSETS = path.join(ROOT, 'src/renderer/src/assets/intro')
const PROVIDER = /\b(?:Claude|Codex|cloro|SerpApi|Jina|Anthropic|OpenAI)\b/i
const MB = 1024 * 1024

describe('the tour captions', () => {
  it('never name a provider behind CiteFox', () => {
    for (const caption of TOUR_CAPTIONS) expect(caption.text).not.toMatch(PROVIDER)
  })

  it('are 8 short lines, one at a time, each on screen for at least 3.5 s', () => {
    expect(TOUR_CAPTIONS).toHaveLength(8)
    let before = 0
    for (const caption of TOUR_CAPTIONS) {
      expect(caption.start).toBeGreaterThanOrEqual(before)
      expect(caption.end - caption.start).toBeGreaterThanOrEqual(3.5)
      expect(caption.text.split(/\s+/).length).toBeLessThanOrEqual(8)
      before = caption.end
    }
  })

  it('are the same in the film timeline (scripts/media/video/tour.json)', () => {
    const timeline = JSON.parse(
      readFileSync(path.join(ROOT, 'scripts/media/video/tour.json'), 'utf8')
    ) as { bpm: number; scenes: { beats: number }[]; captions: typeof TOUR_CAPTIONS }
    expect(timeline.captions).toEqual(TOUR_CAPTIONS)
    const seconds = (timeline.scenes.reduce((sum, s) => sum + s.beats, 0) * 60) / timeline.bpm
    expect(seconds).toBeGreaterThanOrEqual(44)
    expect(seconds).toBeLessThanOrEqual(46)
    expect(TOUR_CAPTIONS[TOUR_CAPTIONS.length - 1]!.end).toBeLessThanOrEqual(seconds)
  })
})

describe('the bundled tour files', () => {
  it('keep tour.mp4 under 6 MB, when it is there', () => {
    const film = path.join(ASSETS, 'tour.mp4')
    if (existsSync(film)) expect(statSync(film).size).toBeLessThan(6 * MB)
  })

  it('keep the poster under 150 KB and all intro assets under 6.5 MB', () => {
    const poster = path.join(ASSETS, 'tour-poster.png')
    if (existsSync(poster)) expect(statSync(poster).size).toBeLessThan(150 * 1024)
    const files = existsSync(ASSETS) ? readdirSync(ASSETS) : []
    const total = files.reduce((sum, name) => sum + statSync(path.join(ASSETS, name)).size, 0)
    expect(total).toBeLessThan(6.5 * MB)
  })

  it('hold no film or sound in an unsupported container (.mov, .caf)', () => {
    const files = existsSync(ASSETS) ? readdirSync(ASSETS) : []
    expect(files.filter((name) => /\.(mov|caf)$/i.test(name))).toEqual([])
  })
})
