import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import type { VideoIdea, VideoScreen } from '@shared/domain'
import { configureExportSaveDialog, resetExportSaveDialog } from '../../export/ipc'
import { emptyClaudeCliUsage } from '../../providers/claude/parse'
import type { ClaudeCompletion, ClaudeProvider } from '../../providers/claude/claude-code'
import {
  COMMUNITY_SEED,
  recordedBrief,
  seedCommunitiesProject,
  type SeededHarness
} from '../seed.test-helper'

const opened: Array<{ harness: SeededHarness; dir: string }> = []

afterEach(() => {
  resetExportSaveDialog()
  for (const { harness, dir } of opened.splice(0)) {
    harness.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

function fakeClaude(reply: () => unknown, prompts: string[]): ClaudeProvider {
  return {
    id: 'claude-code',
    async complete(request): Promise<ClaudeCompletion> {
      prompts.push(request.prompt)
      const json = reply()
      return {
        provider: 'claude-code',
        text: JSON.stringify(json),
        json,
        inputTokens: 10,
        outputTokens: 10,
        durationMs: 5,
        model: 'claude-test',
        resolvedModel: null,
        usage: emptyClaudeCliUsage()
      }
    }
  }
}

async function seeded(
  reply: () => unknown = recordedBrief,
  prompts: string[] = []
): Promise<{ harness: SeededHarness; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'citefox-videos-'))
  const harness = await seedCommunitiesProject(dir, {
    claude: fakeClaude(reply, prompts),
    cacheVideoDetails: true
  })
  opened.push({ harness, dir })
  return { harness, dir }
}

const projectId = COMMUNITY_SEED.projectId

async function screen(
  harness: SeededHarness,
  marketId: string | null = null
): Promise<VideoScreen> {
  return Promise.resolve(harness.handlers['videos:get']({ projectId, pageId: null, marketId }))
}

describe('videos:get (FR-18.1, FR-18.2)', () => {
  test('counts the answers and ranks ideas by evidence', async () => {
    const { harness } = await seeded()
    const result = await screen(harness)
    expect(result.stats).toMatchObject({
      aiosShown: 4,
      prompts: 4,
      citingVideo: 3,
      citingYours: 0,
      openSlots: 3,
      competitorChannels: null
    })
    const keys = new Set(result.aios.map((aio) => aio.key))
    for (const list of [
      result.stats.aiosShownKeys,
      result.stats.citingVideoKeys,
      result.stats.openSlotKeys
    ]) {
      for (const key of list) expect(keys.has(key)).toBe(true)
    }
    expect(result.ideas.map((idea) => [idea.id, idea.evidence, idea.step, idea.saved])).toEqual([
      ['vi-prompt-1', 2, 'idea', false],
      ['vi-prompt-2', 1, 'idea', false]
    ])
    const first = result.ideas[0]
    expect(first?.question).toBe(COMMUNITY_SEED.prompts[0])
    expect(first?.pageUrl).toBe(COMMUNITY_SEED.pageUrl)
    expect(first?.videos.map((video) => [video.videoId, video.channelTitle])).toEqual([
      ['Emai1ToSMS2', 'SmallBiz Tech Help']
    ])
    expect(first?.evidenceKeys).toHaveLength(2)
    // Every prompt links to Prompt detail on the page it belongs to.
    expect(first?.prompts?.map((prompt) => prompt.promptId)).toEqual(first?.promptIds)
    for (const prompt of first?.prompts ?? []) {
      expect(result.aios.some((aio) => aio.pageId === prompt.pageId)).toBe(true)
    }
    // Each competitor channel lists the open-slot answers that cite one of its videos.
    expect(result.stats.competitorChannelKeys?.map((item) => item.name)).toEqual(
      result.stats.competitorChannelNames
    )
    for (const item of result.stats.competitorChannelKeys ?? []) {
      expect(item.keys.length).toBeGreaterThan(0)
      for (const key of item.keys) expect(result.stats.openSlotKeys).toContain(key)
    }
    const us = await screen(harness, COMMUNITY_SEED.us)
    expect(us.stats.citingVideo).toBe(2)
    expect(us.ideas.map((idea) => [idea.id, idea.evidence])).toEqual([
      ['vi-prompt-1', 1],
      ['vi-prompt-2', 1]
    ])
  })
})

describe('the five-step flow (FR-18.3 to FR-18.7)', () => {
  test('writes the brief with the video_brief template and flags claims not on the page', async () => {
    const prompts: string[] = []
    const { harness } = await seeded(recordedBrief, prompts)
    const idea = await harness.handlers['videos:writeBrief']({
      projectId,
      ideaId: 'vi-prompt-1',
      force: false
    })
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain('Template: video_brief.md')
    expect(prompts[0]).toContain(COMMUNITY_SEED.prompts[0])
    expect(prompts[0]).toContain(COMMUNITY_SEED.pageUrl)
    expect(prompts[0]).toContain('- Send alerts from email')
    expect(prompts[0]).toMatch(/\nProduct: [^\n]+\nBuyer: /)
    expect(prompts[0]).toContain('<page_text>\n')
    expect(prompts[0]).not.toMatch(/\{\{/)
    expect(idea.saved).toBe(true)
    expect(idea.step).toBe('brief')
    expect(idea.brief?.title).toBe('Alert your crew by text without a developer')
    expect(idea.brief?.sources.map((source) => [source.n, source.onPage])).toEqual([
      [1, true],
      [2, false],
      [3, false]
    ])
    expect(idea.brief?.tags).toContain('no developer')
    expect(idea.brief?.scenes.map((scene) => scene.n)).toEqual([1, 2, 3, 4, 5])
    const again = await harness.handlers['videos:writeBrief']({
      projectId,
      ideaId: 'vi-prompt-1',
      force: false
    })
    expect(prompts).toHaveLength(1)
    expect(again.brief).toEqual(idea.brief)
  })

  test('a brief whose script points at a missing source is retried, then refused', async () => {
    const broken = (): unknown => {
      const brief = structuredClone(recordedBrief()) as { script: { source: number | null }[] }
      const first = brief.script[1]
      if (first) first.source = 9
      return brief
    }
    const prompts: string[] = []
    const { harness } = await seeded(broken, prompts)
    await expect(
      harness.handlers['videos:writeBrief']({ projectId, ideaId: 'vi-prompt-1', force: false })
    ).rejects.toThrow(/source 9/)
    expect(prompts.length).toBe(2)
    const result = await screen(harness)
    expect(result.ideas.find((idea) => idea.id === 'vi-prompt-1')?.saved).toBe(false)
  })

  test('Send to FoxCue only marks the idea sent; nothing is sent anywhere', async () => {
    const { harness } = await seeded()
    const before = harness.requests.length
    const idea = await harness.handlers['videos:markSent']({ projectId, ideaId: 'vi-prompt-2' })
    expect(idea.step).toBe('sent')
    expect(idea.sentToFoxcueAt).toBe('2026-10-20T09:00:00.000Z')
    expect(harness.requests.length).toBe(before)
    const again = await harness.handlers['videos:markSent']({ projectId, ideaId: 'vi-prompt-2' })
    expect(again.sentToFoxcueAt).toBe(idea.sentToFoxcueAt)
  })

  test('deadline and checklist are saved; publishing needs a URL first', async () => {
    const { harness } = await seeded()
    const idea = await harness.handlers['videos:update']({
      projectId,
      ideaId: 'vi-prompt-1',
      patch: { deadline: '2027-03-31', checklist: ['chapters', 'captions'] }
    })
    expect(idea.deadline).toBe('2027-03-31')
    expect(idea.checklist).toEqual(['chapters', 'captions'])
    await expect(
      harness.handlers['videos:update']({
        projectId,
        ideaId: 'vi-prompt-1',
        patch: { step: 'published' }
      })
    ).rejects.toThrow(/YouTube URL/)
    await expect(
      harness.handlers['videos:update']({ projectId, ideaId: 'vi-nothing', patch: {} })
    ).rejects.toThrow(/not found/)
  })

  test('tracking stores watch?v=<id> and reports before and now without claiming cause', async () => {
    const { harness } = await seeded()
    await expect(
      harness.handlers['videos:track']({
        projectId,
        ideaId: 'vi-prompt-1',
        videoUrl: 'https://example.com/video'
      })
    ).rejects.toThrow(/not a YouTube video/)
    const tracked: VideoIdea = await harness.handlers['videos:track']({
      projectId,
      ideaId: 'vi-prompt-1',
      videoUrl: 'https://youtu.be/Emai1ToSMS2?t=5'
    })
    expect(tracked.step).toBe('tracking')
    expect(tracked.videoUrl).toBe('https://youtube.com/watch?v=Emai1ToSMS2')
    expect(tracked.tracking).toMatchObject({ nowCiting: 2, nowAios: 2, beforeCiting: 2 })
    expect(tracked.tracking?.nowKeys).toHaveLength(2)
    // The "before" number drills: its keys are exactly that many answers.
    expect(tracked.tracking?.beforeKeys).toHaveLength(tracked.tracking?.beforeCiting ?? -1)
    const result = await screen(harness)
    const known = new Set(result.aios.map((aio) => aio.key))
    const shown = result.ideas.find((idea) => idea.id === 'vi-prompt-1')
    for (const key of shown?.tracking?.beforeKeys ?? []) expect(known.has(key)).toBe(true)
    expect(result.stats.citingYours).toBe(2)
    expect(result.stats.openSlots).toBe(1)
    expect(result.ideas.find((idea) => idea.id === 'vi-prompt-1')?.videos[0]?.yours).toBe(true)
  })

  test('exports the script, captions and shot list through the save dialog', async () => {
    const { harness, dir } = await seeded()
    await expect(
      harness.handlers['videos:export']({ projectId, ideaId: 'vi-prompt-1', file: 'script' })
    ).resolves.toEqual({ ok: false, reason: 'Write the brief first.' })
    await harness.handlers['videos:writeBrief']({ projectId, ideaId: 'vi-prompt-1', force: false })
    const asked: string[] = []
    configureExportSaveDialog(async (options) => {
      asked.push(options.defaultPath)
      return { canceled: false, filePath: join(dir, options.defaultPath) }
    })
    for (const file of ['script', 'captions', 'shots'] as const) {
      const result = await harness.handlers['videos:export']({
        projectId,
        ideaId: 'vi-prompt-1',
        file
      })
      expect(result.ok).toBe(true)
    }
    expect(asked).toEqual([
      'alert-your-crew-by-text-without-a-developer-script.md',
      'alert-your-crew-by-text-without-a-developer-captions.srt',
      'alert-your-crew-by-text-without-a-developer-shot-list.csv'
    ])
    const script = readFileSync(join(dir, asked[0] ?? ''), 'utf8')
    expect(script).toContain('# Alert your crew by text without a developer')
    expect(script).toContain('(not on the page yet)')
    const captions = readFileSync(join(dir, asked[1] ?? ''), 'utf8')
    expect(captions.startsWith('1\n00:00:00,000 --> 00:00:20,000\n')).toBe(true)
    const shots = readFileSync(join(dir, asked[2] ?? ''), 'utf8')
    expect(shots.split('\r\n')[0]).toBe('﻿Scene,Time,Chapter,Kind,Name,On screen')
    configureExportSaveDialog(async () => ({ canceled: true }))
    await expect(
      harness.handlers['videos:export']({ projectId, ideaId: 'vi-prompt-1', file: 'script' })
    ).resolves.toEqual({ ok: false, reason: 'Not saved.' })
  })
})
