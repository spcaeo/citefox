# Design guidelines

The goal (owner, 2026-11-02): **every screen looks clean, calm and obvious.** Less on
screen, fewer words, the same thing in the same place everywhere. When a rule here and
a screen disagree, the screen is wrong. Related: `Docs/HEADER.md` (screen headers),
`Docs/DRAWER.md` (drawers), `Docs/REPORT-SPEC.md` (reports).

## 0. Use the standard pieces (never build your own)

All in `src/renderer/src/ui/Tools.tsx` (exported from `ui`):

| Piece | Use it for | Notes |
|---|---|---|
| `ToolButton kind="…"` | every tool action | One icon and one name per kind: `download`, `print` (Print / PDF), `schedule` (Email on a schedule), `email`, `copy-link`, `copy`, `csv`, `refresh`, `edit`, `settings`, `filter`, `open`, `upload`, `delete`. `label` only to be more exact ("Copy all URLs"). |
| `ToolGroup` | a row of tool icons | Same spacing everywhere; sits before ⋯ and the main action. |
| `ExportMenu` | every Download ▾ | The download icon only; the menu items carry the words (Offline HTML, PDF, CSV…). |
| `SearchBox` | every search | Search icon, placeholder names what is searched ("Search questions, sites, pages"). |
| `FilterBar` | every filters row | Pickers left (`children`), search and tools right (`end`) on the same row. |
| `UrlText` / `DomainText` / `CopyText` | every address and copyable text | Copy (+ Open) on hover, green tick. |
| `IconButton` | any other icon-only action | Always with `label` and `tip`. |

## 1. Buttons: one word button, everything else an icon

| Kind | How it looks | Examples |
|---|---|---|
| **Main action** | One button with a short word (1–2 words). **At most one per area**: one per screen header, one per card, one per drawer footer. | Open, Save, Add, Run check, Log a fix |
| **Tool actions** | **Icon only** (`ui/IconButton`, `tip`), with the name as tooltip and `aria-label`. Never an icon plus a word. | Download, Print / PDF, Email on a schedule, Copy link, CSV, Refresh, Edit, Settings, Filter, Share |
| **Rare or risky actions** | Inside the **⋯** menu (`SectionMenu` / `RowMenu`), with words. Red ones come last and ask first. | Delete, Reset, Import, Export all |
| **A choice** | Segmented control or tabs, never a row of buttons. | By goal / By report, Chart / Table |

- A menu that opens from an icon keeps the icon (Download ▾ is the download icon; the
  menu items have words).
- Wizards and confirm dialogs are the only places with two word buttons
  (Back · Next, Cancel · Delete).
- An action that spends searches or credits is a main action (with words) and shows the
  cost before it starts.

## 2. Where things go (the same on every screen)

```
┌ Header ──────────────────────────────────────────────────────────────┐
│ Title                                   [⤓] [🖨] [✉] [⋯]  [ Main ]     │
│ one short line                                                         │
├ Filters ──────────────────────────────────────────────────────────────┤
│ Scope [▾]  Check [▾]  Market  Engine            [🔍 Search…        ]   │
│ quiet data line: dates · engines · last check                          │
├ Tabs ─────────────────────────────────────────────────────────────────┤
│ Tab · Tab · Tab · Tab                                   How we measured │
└───────────────────────────────────────────────────────────────────────┘
```

- **Header right end, always in this order:** tool icons (Download, Print / PDF, Email on
  a schedule, Copy link) → ⋯ → the main action last, at the far right.
- **Filters row:** pickers on the left; the search box on the **right of the same row**,
  never on a row of its own. On a narrow window search becomes a 🔍 icon that opens
  the box.
- **Cards:** title + status at the top, the main action at the **bottom left**, tool
  icons at the **bottom right**, on one row pinned to the bottom so every card in a row
  lines up (see `reports/review/HomeCard.tsx`).
- **Table rows:** row actions at the **end of the row**, shown on hover and focus; more
  than two go in the row's ⋯.
- **Drawers:** title + tool icons (Copy link, CSV, Close) at the top right; the main
  action at the bottom right.
- **Tabs:** one line, never wrapping. More than 7 → group them with pill sub-tabs
  (`reports/review/ReportTabs.tsx`). Quiet tabs (How we measured) sit on the right.

## 3. Words: fewer and plainer

- A card or section has a title and **one line** (≤ 8 words on a card, ≤ 1 sentence on
  a section). Longer help goes in the Guide or a (?) tooltip, not on the screen.
- Statuses are a dot and ≤ 3 words: **● Ready**, **○ Needs a 2nd check**.
- Numbers lead: "**7 of 11** cite you", not "7 of your 11 questions cite your pages".
- No developer words: never "as they do today", "null", "N/A", provider names.
- Dates and times through `formatMoment` / `formatDay`.

## 4. Text and addresses

- Every URL, domain or page path: `ui/UrlText` / `DomainText` (copy + open in a new
  window on hover). Every text someone may paste (a question, a claim): `ui/CopyText`.
  Copy turns into a green tick. The same in the offline downloads.

## 5. Look

- Icons only from `ui/UiIcon`, 16 px in buttons.
- Colours and spacing only from the v2 tokens; CSS inside `@layer screens`.
- Equal-height cards in a grid; no lone card on a row (6 = 3 × 2, 5 = one row).
- Empty state: one line saying what is needed and one main action, never zeros.

## 6. Help and Ctrl+K

- A new screen (or report kind, tab or settings tab) must add its help topic in
  `Docs/help/<id>.md` (id in `src/shared/help` `HELP_TOPIC_IDS`) and its Ctrl+K entry in
  `src/renderer/src/shell/searchCatalog.ts`; open help with `openHelp(id)` from `help/`.

## Checks

`src/renderer/src/styles/buttons.test.ts` fails when a `Button` draws one of the tool
icons together with a word (download, file, inbox, copy, refresh, pencil, settings,
filter, link, upload) with a word, unless it is the area's main action (`variant="primary"`). Use `IconButton` with `tip` instead.
