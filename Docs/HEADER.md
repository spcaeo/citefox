# Screen headers

Every screen opens with one compact header: the title, one line under it, and
its actions on the right. The thin hue band behind it comes from the route
(`<main data-hue>`). The 48 px spruce top bar above it holds the breadcrumbs,
so a header never draws its own.

Code: `src/renderer/src/components/Header.tsx` (`ScreenHeader`, `PageHeader`),
`src/renderer/src/components/HeaderActions.tsx` (the right end),
`src/renderer/src/shell/SectionFrame.tsx` (the standard header plus the
screen under it). Mock-up: `Header.dc.html` on the nav canvas.

```
┌──────────────────────────────────────────────────────────────────┐
│ Questions                                    [ ⋯ ]  [+ Add questions] │  19 px title
│ Every question you track. Group them by topic, tick a few…          │  one 13 px line
└──────────────────────────────────────────────────────────────────┘
```

## The rules

- **One green button.** `primary` is the screen's main action, drawn as the
  action-green button (`--action`). There is at most one per screen. White
  buttons are Cancel or Back. Orange is only for the logo and the ✦ AI marks.
- **Everything else goes under ⋯.** `more` fills the ⋯ menu: import, export,
  "check selected", "ask CiteFox about these", and so on.
- **Red items ask first.** An item with `danger` is red, comes last in the
  menu, and opens `ui/Confirm` before its `onSelect` runs. The confirm is on
  the URL (`?dialog=head-<id>`), so Back closes it and a pasted link reopens it.
- **Right side only.** Nothing sits between the title and the actions.

## API

```ts
interface HeaderPrimary {
  label: string
  icon?: UiIconName
  href?: string // a route (#/…) opens as a link; otherwise onClick runs
  onClick?: () => void
  busy?: boolean
  disabled?: boolean
}

interface HeaderMoreItem {
  id: string // stable: names the confirm on the URL
  label: string
  icon?: UiIconName
  href?: string // #/… navigates; https://… opens in the browser
  onSelect?: () => void
  disabled?: boolean
  danger?: { title: string; body?: ReactNode; confirmLabel: string }
}
```

`ScreenHeader` and `SectionFrame` both take:

| Prop        | What it is                                                                   |
| ----------- | ---------------------------------------------------------------------------- |
| `primary`   | A `HeaderPrimary`, or a ready-made control (such as Check now's split button) |
| `more`      | `HeaderMoreItem[]` for the ⋯ menu                                            |
| `moreLabel` | The ⋯ button's name. Default "More actions"                                  |
| `actions`   | **Older** free-form actions. They still render, before ⋯, until a screen moves |

The order on the right is `actions` (if any), then ⋯, then `primary`.

## Example

```tsx
<SectionFrame
  title="Questions"
  subtitle="Every question you track. Group them by topic, tick a few, and move them."
  primary={{ label: 'Add questions', icon: 'plus', onClick: () => openDrawer('add-questions') }}
  more={[
    { id: 'import', label: 'Import from Excel or CSV', icon: 'upload', onSelect: openImport },
    { id: 'export', label: 'Export questions (CSV)', icon: 'download', onSelect: exportCsv },
    { id: 'check', label: 'Check selected now', icon: 'refresh', onSelect: checkSelected },
    {
      id: 'delete',
      label: 'Delete selected…',
      icon: 'trash',
      onSelect: deleteSelected,
      danger: {
        title: `Delete ${count} questions?`,
        body: 'Their check history goes too. This cannot be undone.',
        confirmLabel: 'Delete questions'
      }
    }
  ]}
>
  …
</SectionFrame>
```

## Moving a screen over

1. Pick the one main action and pass it as `primary`. If the screen has two
   green buttons today, one of them becomes a ⋯ item.
2. Move the other buttons into `more`, in the order people use them.
3. Give destructive items `danger` and drop the screen's own confirm for them.
4. Remove the `actions` prop. Check the screen at 1134 and 1440 wide, light
   and dark.

## Section and card heads

Heads inside a screen (`ui/SectionHead`, `ui/Panel`, card titles) follow the
same idea at a smaller size:

- Actions sit on the right.
- One action: a text link in action green (`LinkButton variant="text"` or
  `Button variant="text"`), or a small `IconButton` with `tip` when it is
  minor (the label shows as a tooltip and is the accessible name).
- More than one: `ui/SectionMenu` (an always-visible ⋯), or one text link
  plus `SectionMenu`.
- Text links are never fox orange. Orange stays for the logo and ✦ AI marks.

```tsx
<SectionHead
  title="Questions to watch"
  actions={
    <>
      <LinkButton variant="text" href={questionsHash()}>All questions →</LinkButton>
      <SectionMenu
        label="More actions for Questions to watch"
        items={[{ id: 'add', label: 'Add questions', icon: 'plus', onSelect: openAdd }]}
      />
    </>
  }
/>
```

## Sizes

- Title: `--fs-screen-title` (19 px) on `--lh-screen-title` (24 px).
- Line under it: `--fs-ui` (13 px) on `--lh-screen-sub` (18 px).
- `--main-top` is 12 px, so the band is about 64 px for a title and one line.
- The gold sponsor card (`sponsors/SponsorCard`) ends every screen. The shell
  renders it once, after the content, so screens never add it themselves.
