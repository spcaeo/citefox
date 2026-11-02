import type { SectionMenuLine } from './SectionAiMenu'
import type { SectionActions } from './useSectionActions'
import type { SectionAi } from './useSectionAi'
import type { SectionUrl } from './useSectionUrl'

/** The ⋯ menu lines every list and chip section shares (mock-up panel 8). */
export function sectionMenuLines({
  findMoreLabel,
  findMoreHint,
  actions,
  url,
  ai
}: {
  findMoreLabel: string
  findMoreHint?: string
  actions: SectionActions
  url: SectionUrl
  ai: SectionAi
}): SectionMenuLine[] {
  return [
    {
      id: 'more',
      label: findMoreLabel,
      icon: 'sparkle',
      ai: true,
      hint: findMoreHint ?? (ai.available ? '' : 'ChatGPT'),
      onSelect: actions.findMore
    },
    {
      id: 'redo',
      label: 'Redo this section…',
      icon: 'sparkle',
      ai: true,
      hint: 'your words',
      onSelect: () => url.openPanel('redo')
    },
    {
      id: 'prompt',
      label: 'Edit the prompt…',
      icon: 'pencil',
      onSelect: () => url.openPanel('prompt')
    },
    {
      id: 'chatgpt',
      label: 'Use my own ChatGPT for this section',
      groupStart: true,
      onSelect: () => actions.openChatbot('more')
    }
  ]
}
