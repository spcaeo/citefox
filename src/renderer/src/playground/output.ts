export interface PromptLine {
  n: number
  text: string
}

export interface CoverageRowView {
  n: number
  prompt: string
  coverage: 'Strong' | 'Partial' | 'Weak' | 'None'
  where: string
  gap: string
  action: string
}

export interface CoverageView {
  rows: readonly CoverageRowView[]
  findings: readonly string[]
  counts: Readonly<Record<CoverageRowView['coverage'], number>>
}

const LEVELS = ['Strong', 'Partial', 'Weak', 'None'] as const

/** Numbered model text from a buyer-prompts run. The length is the count to show. */
export function parsePromptLines(text: string): PromptLine[] | null {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (lines.length === 0) return null
  const parsed: PromptLine[] = []
  for (const line of lines) {
    const match = /^(\d+)\.\s+(.+)$/.exec(line)
    if (!match) return null
    const n = Number(match[1])
    const textPart = match[2]
    if (!Number.isInteger(n) || textPart === undefined) return null
    parsed.push({ n, text: textPart })
  }
  return parsed
}

export function parseCoverageMatrix(text: string): CoverageView | null {
  const lines = text.split('\n')
  const header = lines.findIndex((line) => line.startsWith('#\tPrompt\t'))
  if (header === -1) return null
  const rows: CoverageRowView[] = []
  let index = header + 1
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (line.trim().length === 0) break
    const cells = line.split('\t')
    if (cells.length !== 6) return null
    const [nText, prompt, coverage, where, gap, action] = cells
    if (
      nText === undefined ||
      prompt === undefined ||
      coverage === undefined ||
      where === undefined ||
      gap === undefined ||
      action === undefined
    ) {
      return null
    }
    if (!isLevel(coverage)) return null
    const n = Number(nText)
    if (!Number.isInteger(n)) return null
    rows.push({ n, prompt, coverage, where, gap, action })
    index += 1
  }
  if (rows.length === 0) return null
  const findings: string[] = []
  const findingStart = lines.findIndex((line) => line.trim() === 'Page-wide findings')
  if (findingStart !== -1) {
    for (const line of lines.slice(findingStart + 1)) {
      if (line.startsWith('- ')) findings.push(line.slice(2))
    }
  }
  return { rows, findings, counts: countLevels(rows) }
}

export function countLevels(
  rows: readonly Pick<CoverageRowView, 'coverage'>[]
): Record<CoverageRowView['coverage'], number> {
  const counts = { Strong: 0, Partial: 0, Weak: 0, None: 0 }
  for (const row of rows) counts[row.coverage] += 1
  return counts
}

function isLevel(value: string): value is CoverageRowView['coverage'] {
  return LEVELS.some((level) => level === value)
}

export interface ProfilePart {
  heading: string
  body: string
}

const PROFILE_HEADINGS = [
  'Who',
  'Environment',
  'Strongest segments',
  'Trigger events',
  'What they value',
  'Poor fit'
] as const

export function parseProfileParts(text: string): ProfilePart[] | null {
  const chunks = text.split(/\n\n/)
  const parts: ProfilePart[] = []
  for (const chunk of chunks) {
    const [heading, ...rest] = chunk.split('\n')
    if (!heading || !PROFILE_HEADINGS.some((item) => item === heading)) return null
    parts.push({ heading, body: rest.join('\n') })
  }
  if (parts.length !== PROFILE_HEADINGS.length) return null
  return parts
}
