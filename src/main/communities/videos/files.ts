import type { VideoBrief } from '@shared/domain'
import type { VideoExportFile } from '@shared/ipc'
import { encodeCsv } from '../../export/csv'
import { neutralizeFormula } from '../../export/formula'

/** FR-18.5 "Export for your editor". Each file is built from the saved brief only. */
export interface VideoFile {
  filename: string
  content: string
  /** Save-dialog filter. */
  filter: { name: string; extensions: string[] }
}

export function videoFile(
  file: VideoExportFile,
  brief: VideoBrief,
  meta: { question: string; pageUrl: string; slug: string }
): VideoFile {
  if (file === 'script') {
    return {
      filename: `${meta.slug}-script.md`,
      content: scriptMarkdown(brief, meta),
      filter: { name: 'Markdown', extensions: ['md'] }
    }
  }
  if (file === 'captions') {
    return {
      filename: `${meta.slug}-captions.srt`,
      content: captionsSrt(brief),
      filter: { name: 'SubRip captions', extensions: ['srt'] }
    }
  }
  return {
    filename: `${meta.slug}-shot-list.csv`,
    content: shotListCsv(brief),
    filter: { name: 'CSV', extensions: ['csv'] }
  }
}

/** Script with the hook, chapters, numbered source notes, description, and tags. */
export function scriptMarkdown(
  brief: VideoBrief,
  meta: { question: string; pageUrl: string }
): string {
  const lines: string[] = [
    `# ${brief.title}`,
    '',
    `Answers: "${meta.question}"`,
    `Page: ${meta.pageUrl}`,
    '',
    '## Hook (first 10 seconds)',
    '',
    brief.hook,
    '',
    '## Chapters',
    '',
    ...brief.chapters.map((chapter) => `- ${chapter.at} ${chapter.name}`),
    '',
    '## Script',
    ''
  ]
  for (const line of brief.script) {
    const note = line.source === null ? '' : ` [${line.source}]`
    lines.push(`**${line.at}** ${line.text}${note}`, '')
  }
  lines.push('## Where each claim comes from', '')
  for (const source of brief.sources) {
    lines.push(`${source.n}. ${source.section}${source.onPage ? '' : ' (not on the page yet)'}`)
  }
  lines.push(
    '',
    '## YouTube description',
    '',
    brief.description,
    '',
    '## Thumbnail text',
    '',
    brief.thumbnailText,
    '',
    '## Tags',
    '',
    brief.tags.join(', '),
    ''
  )
  return lines.join('\n')
}

/** One caption per script line, shown until the next line starts (the last for 5 seconds). */
export function captionsSrt(brief: VideoBrief): string {
  const starts = brief.script.map((line) => seconds(line.at))
  const blocks = brief.script.map((line, index) => {
    const start = starts[index] ?? 0
    const next = starts[index + 1]
    const end = next !== undefined && next > start ? next : start + 5
    return `${index + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${line.text}\n`
  })
  return blocks.join('\n')
}

/** Shot list: one row per storyboard scene, with the chapter it falls in. */
export function shotListCsv(brief: VideoBrief): string {
  const header = ['Scene', 'Time', 'Chapter', 'Kind', 'Name', 'On screen']
  const rows = brief.scenes.map((scene) => [
    String(scene.n),
    scene.at,
    chapterAt(brief, seconds(scene.at)),
    scene.kind,
    scene.name,
    scene.note
  ])
  return encodeCsv(
    [header, ...rows].map((row) => row.map((cell) => neutralizeFormula(cell))),
    ',',
    true
  )
}

function chapterAt(brief: VideoBrief, at: number): string {
  let name = ''
  for (const chapter of brief.chapters) if (seconds(chapter.at) <= at) name = chapter.name
  return name
}

/** `m:ss` or `mm:ss` to seconds. */
export function seconds(at: string): number {
  const [minutes, secs] = at.split(':').map((part) => Number(part))
  return (minutes ?? 0) * 60 + (secs ?? 0)
}

function srtTime(total: number): string {
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)},000`
}

/** Filename-safe slug from the video title, at most 60 characters. */
export function videoSlug(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  return slug.length > 0 ? slug : 'video'
}
