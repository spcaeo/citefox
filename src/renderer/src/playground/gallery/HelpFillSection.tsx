import { useMemo, useState, type JSX } from 'react'
import type { HelpFillResult } from '@shared/ipc'
import { HelpFill, useHelpFillUrl, type HelpFillSource } from '../../ui'
import { GallerySection, Specimen } from './GallerySection'

const DEMO_PROMPT = `You help a company find the questions its buyers type into Google.
Business: textbolt.com.
What it does: Business texting, email-to-text and an SMS API.
Topic: Replacing a carrier email-to-text gateway that stopped working.
Already tracked, don't repeat: 10 questions, listed below.

Write 15 new questions a buyer would really type: a situation plus a need, in full sentences.
Never name TextBolt. Mix the stages.
Reply with CSV only, this header:
question,stage,page`

const DEMO_ROWS = [
  ['AT&T email to text stopped working, what can I use for server alerts?', 'problem'],
  ['Best way to send SMS alerts from email now that carrier gateways shut down', 'options'],
  ['Is a hosted email-to-SMS service worth it for a small IT team?', 'compare']
] as const

function demoResult(count: number): HelpFillResult {
  const rows = DEMO_ROWS.slice(0, count).map(([question, stage], index) => ({
    id: `demo-${index}`,
    section: null,
    values: { question, stage, page: '/email-to-text/' }
  }))
  return {
    kind: 'questions',
    rows,
    setAside: [],
    counts: { read: rows.length + 2, tracked: 1, repeats: 0, setAside: 1, ready: rows.length },
    noun: ['question', 'questions'],
    brand: 'TextBolt',
    warnings: []
  }
}

/** Canned answers: the gallery never calls Claude or main. */
function demoSource(): HelpFillSource {
  return {
    'helpfill:estimate': async ({ kind }) => ({
      kind,
      available: true,
      calls: 1,
      costText: '1 AI call · about $0.01',
      reason: null
    }),
    'helpfill:prompt': async ({ kind }) => ({
      kind,
      prompt: DEMO_PROMPT,
      columns: ['question', 'stage', 'page'],
      tracked: 10
    }),
    'helpfill:read': async () => demoResult(2),
    'helpfill:describe': async () => demoResult(3)
  }
}

/** "✦ Help me fill this": both ways, the banner, and the rows a place would review. */
export function HelpFillSection(): JSX.Element {
  const source = useMemo(() => demoSource(), [])
  // On the gallery's own URL (`gl.help=`, `gl.bot=`), like a screen would keep it.
  const url = useHelpFillUrl('gl.')
  const [rows, setRows] = useState<readonly string[]>([])
  return (
    <GallerySection
      id="helpfill"
      title="Help me fill"
      intro="Wherever a list is empty or hard to fill, one helper offers the lazy way: describe it and CiteFox AI drafts rows (cost shown first), or copy one prompt into your own chatbot and paste the answer back. Rows land in the place's own review; nothing is saved here."
    >
      <Specimen title="✦ Help me write (Add questions)" span={8}>
        <HelpFill
          kind="questions"
          projectId="gallery"
          scope={{ pageId: 'gallery-topic' }}
          source={source}
          {...url}
          describe={{
            label: "Who is searching, and what's their problem?",
            chips: [
              {
                id: 'page',
                label: 'Start from my page /email-to-text/',
                text: 'Questions a buyer asks before they would land on /email-to-text/.'
              },
              {
                id: 'thin',
                label: 'Fill Compare and Decide (fewest now)',
                text: 'Only questions for the Compare and Decide stages.'
              }
            ],
            counts: [5, 10, 12],
            defaultCount: 10,
            buttonLabel: (count) => `Write ${count} questions`
          }}
          chatbot={{ tip: 'Perplexity is best for competitors: it searches the web.' }}
          onRows={(result) => setRows(result.rows.map((row) => row.values.question ?? ''))}
          openLink={() => undefined}
          testId="gl-hf"
        />
      </Specimen>
      <Specimen title="Rows handed to the place" span={4} inset>
        {rows.length === 0 ? (
          <p className="gl-help">Write or read an answer: its rows show here.</p>
        ) : (
          <ul className="gl-list" aria-label="Rows from the helper">
            {rows.map((row) => (
              <li key={row}>{row}</li>
            ))}
          </ul>
        )}
      </Specimen>
    </GallerySection>
  )
}
