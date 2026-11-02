# Drawers

Every task that used to open as a dialog or a side panel opens in one drawer
frame: `ui/Drawer`. It takes about 80% of the window, has the same header and
footer everywhere, and is on the URL, so Back closes it and a copied link
reopens it.

Code: `src/renderer/src/ui/Drawer/` (the frame), `src/renderer/src/shell/drawers.ts`
(the stack and its history), `src/renderer/src/shell/drawerUrl.ts` (the URL
grammar), `src/renderer/src/shell/DrawerHost.tsx` (drawers the shell owns),
`src/renderer/src/shell/DrawerLevel.tsx` (where a drawer sits in the stack).

## The frame

```
┌───────────────────────────────────────────────────────────────┐
│ TextBolt › Questions › Add questions                           │  breadcrumbs: each crumb is a link
│ Add questions                       Step 2 of 3  status    ✕   │  title, step, status, close
│ One line: scope and a plain-words purpose                      │  subtitle (optional)
│ [Stepper or Tabs]                                              │  headerExtra (optional)
├───────────────────────────────────────────────────────────────┤
│  12-column grid: DrawerMain (8) + DrawerRail (4),              │  body scrolls on its own
│  or DrawerSection boxes spanning 4 / 6 / 8 / 12                │
├───────────────────────────────────────────────────────────────┤
│ 7 new questions · uses 14 searches     Cancel  Later  Primary  │  footer: always there
└───────────────────────────────────────────────────────────────┘
```

- **Width**: `min(max(880px, 80vw), 1280px, 100vw - 48px)`. A narrow window
  keeps a 48 px strip of the screen as context and a click-out target. A
  stacked drawer is 48 px narrower than the one under it.
- **Closing**: ✕ (`aria-label="Close <title>"`), Escape, a press on the scrim,
  Cancel, a crumb, and browser Back. All of them ask "Discard changes?" first
  while the drawer is `dirty`.
- **Focus**: moves in on open (`[data-autofocus]`, else the first field, else
  the title; `focusOnOpen="close"` for read-only lists), Tab stays inside,
  and focus goes back to the opener on close.
- **Tokens only**: no colour literals. The dark theme swaps the tokens.
- `role="dialog"`, `aria-modal`, `aria-labelledby` the title, `aria-describedby`
  the subtitle. The header and footer are plain `div`s, not landmarks, so they
  never duplicate the page's banner.

### Props (`DrawerProps`, `ui/Drawer/types.ts`)

| Prop | What it does |
| --- | --- |
| `id` | The drawer's kind (`data-drawer`). Expert options are remembered under it. |
| `title` | The task, verb + object. The heading, the last crumb and "Close {title}". |
| `heading` | Rich heading content. Default: `title`. |
| `crumbs` / `trail` | The whole trail before the title, or crumbs added after the router's trail (an entity such as a topic). Unset: the router's trail. |
| `subtitle` | One line under the title. |
| `step` | `{ current, total }`: "Step 2 of 3". |
| `status` | Short text left of ✕ ("Saved as a draft"). |
| `headerExtra` | A Stepper or Tabs row under the subtitle. |
| `footer` | `{ summary, cancel, secondary, primary, danger }` (below). |
| `dirty`, `guard` | Unsaved changes and the words of the question. |
| `closeDisabled`, `busy` | A save in flight: nothing closes it; `aria-busy`. |
| `loading` | The greyed real layout instead of the body. |
| `error` | `{ message, onRetry }` when the whole drawer failed. A section that failed shows its own error (`DrawerSection error`). |
| `onClose` | The router's close (`closeDrawer(depth)`) or a parent's state. |
| `initialFocus`, `focusOnOpen`, `focusKey` | Where focus goes, and when to move it again (a new step). |
| `depth` | Stack depth. Default: the router's. |
| `attributes` | Extra `data-*` attributes (`data-drill`). |
| `testId`, `className` | |

### Footer (`DrawerFooterSpec`)

Left: what will happen and what it costs ("**7 new questions** · checking now
uses 14 searches · 196 left"). Right: Cancel, at most one secondary, one
primary at the far right. A read-only drawer passes no primary and gets a
single **Close** in the same place (`cancel: 'Close'` when it has a secondary
such as Export). `danger` sits at the far left.

### Body helpers

- `DrawerGrid`: the 12-column grid. Boxes in a row share their height. Under
  720 px of drawer every box takes the full row (container query).
- `DrawerMain` (8 columns) and `DrawerRail` (4 columns, an `aside`).
- `DrawerSection { title, count, description, actions, span, tone, loading, error, onRetry }`:
  a box with a title row, one hint line, then its content. `tone="plain"`
  drops the border for a list that fills the drawer.
- `DrawerFields { columns }` and `DrawerField { label, hint, error, counter, wide }`:
  labels above fields (12 px semibold), one hint line under.
- `DrawerFacts`: a two-column fact list.
- `ExpertOptions`: a collapsible block, open or closed per drawer id
  (`localStorage` key `citefox.drawer.expert.<id>`, read in try/catch).
- `DrawerSkeleton`: what `loading` draws.

### Undo toast (`showUndo`, `ui/undoStore.ts`)

A remove, move or bulk edit acts at once, then calls
`showUndo({ message, effect?, undo? })`. The shell's `UndoToastHost` draws
the latest one at the bottom centre over drawers for 10 s; a newer toast
replaces it. `undo` returns a promise: it rejects with a message the toast
shows instead of closing. `ui/Confirm` is for permanent deletes only.

### Pickers that create (`ui/PickerSelect`)

A select of existing items ends with `createLabel` ("+ New topic…"). Choosing
it calls `onCreate`, which opens the create drawer stacked on top with
`openDrawer(id, values, { onResult })`; the drawer closes with
`closeDrawer(depth, newId)` and the picker sets that id.

### Confirm (`ui/Confirm`)

The one small confirmation: an `alertdialog` with the title, one body line,
Cancel (focused) and the confirming button (`tone` danger by default). The
drawer's "Discard changes?" uses it. New confirmations use it too.

## The URL

```
#/questions?sort=name&drawer=add-questions&target=t1
#/questions?drawer=add-questions&drawer=new-topic
#/pages/p1/results?drawer=drill&drill=kpi%3Aaio&drill.f=aio&drill.q=sms
```

- `drawer=<id>` opens a drawer; the keys after it, up to the next `drawer=`,
  are that drawer's own values. At most two drawers (`MAX_DRAWER_DEPTH`).
- A drawer's keys are declared in `DRAWER_KINDS` (`shell/drawerUrl.ts`). They
  are taken out of the screen's own query, so opening a drawer never changes
  the route (and never resets the screen).
- Old `?dialog=add-questions` and `?dialog=new-topic` links are rewritten to
  `drawer=` in place.

### History

- Opening a drawer is a new history entry: **Back closes it**, Forward
  reopens it.
- Closing (✕, Escape, Cancel, Done) goes back through history instead of
  writing a new entry, so the closed drawer is never one Back step away (no
  dead Back step). The close shows at once; the history step follows.
- A drawer opened from a pasted link, or from a link to another screen, has
  nothing of its own to go back to: closing rewrites the URL to the screen
  under it.
- Steps inside a drawer (a wizard step, a filter) can be entries of their own
  (`setDrawerParams(depth, patch, { push: true })`); closing goes back past
  all of them. Typing and sorting rewrite the entry in place.
- A dirty drawer closed by Back or Forward is put back and asks first;
  Discard then closes it.
- A drawer opened over another can hand a value back:
  `openDrawer('new-topic', {}, { onResult })` and `closeDrawer(depth, value)`.

### Calls (`shell/drawers.ts`)

| Call | Does |
| --- | --- |
| `openDrawer(id, values?, { onResult?, replace? })` | Opens over the open drawer, or alone. An id already open truncates the stack to it; a full stack swaps its top. |
| `closeDrawer(depth?, result?)` | Closes that drawer and every drawer over it (default: the top). |
| `closeAllDrawers()` | Closes the whole stack. |
| `closeDrawersThen(hash)` | Closes the drawers as if Back was pressed, then opens `hash` as a new entry (a crumb, "Open the topic"). |
| `setDrawerParams(depth, patch, { push? })` | Rewrites a drawer's values (a tab, a step, a filter). |
| `drawerHref(id, values?, hash?)` | The link that opens a drawer over a screen. |
| `useDrawerStack()` | `{ stack, hash, open, close, closeAll, closeThen, setParams }`, following the URL. |
| `registerDrawerGuard(depth, guard)` | Used by `Drawer` through `DrawerLevel`. |

## Adding a drawer

1. Add a row to `DRAWER_KINDS` in `shell/drawerUrl.ts`: its title (the crumb a
   stacked drawer shows for it) and every query key it owns.
2. Render it:
   - **Window-wide** (opens over any route): add it to `SHELL_DRAWERS` in
     `shell/DrawerHost.tsx`.
   - **Screen-owned** (needs the screen's data, such as Compare content on
     the History tab): read it from `useDrawerStack()` and wrap it in
     `<DrawerLevel depth={depth}>`.
   - **Kept in the screen's own state or URL value** (Check history's
     `?compare=`, a local count list): wrap it in
     `<ScreenDrawerLevel onClose={…}>` for the route's crumbs. It is not on
     the stack, so Back follows the screen's own URL handling.
   A screen-owned drawer can read its entry with `useDrawerEntry(id)`
   (`{ entry, depth, close, setParams }` or null).
3. Open it with `openDrawer(id, values)` or a link built with `drawerHref`.
4. Close it with `closeDrawer(depth)`. Never navigate and then close: closing
   goes back through history and would undo the navigation. Use
   `closeDrawersThen(hash)` instead.

### Breadcrumbs

The trail comes from the route the drawers open over: project › section ›
entity (`drawerRouteCrumbs`), then each drawer under this one, then the title.
The screen's crumb closes every drawer; a lower drawer's crumb closes the ones
over it; any other crumb closes the drawers, then navigates. The last crumb
shortens first in a narrow window; the project and section keep their words.

### Drawers with no project open

`DrawerHost` draws most drawers only while a project is open. A few also open
without one, so a fresh install can use them: Ask CiteFox (`drawer=ask`,
app and setup questions) and the Move to a new Mac drawers
(`drawer=export-project&ep.project=<id>`, `drawer=import-project&ip.file=<token>`,
`drawer=import-settings&is.file=<token>`; the file is an opaque token from
main's open dialog, never a path). Add a drawer to that set only when it
needs no project data.

### Opening Check now with a scope

Screens that start a check open the one Check now drawer with its scope in
the URL, for example `drawer=check-now&check.scope=topic&check.ids=t1,t2`
(the Topics bulk bar) or `check.scope=pages&check.ids=…` (All pages, groups).
Build the values with `checkParamsPatch` (`checkNow/model.ts`). The drawer's
button is **Check now**, the one name for running a check everywhere.

## Drill drawers

Every drillable number (`DrillNumber`, `DrillButton`) opens the drill drawer
on the URL: `drawer=drill&drill=<id>`, with `drill.f` (the picked tile),
`drill.q` (the search) and `drill.sort` (the topic list's sort).

- Numbers register what they open with the screen's `DrillHost`, per screen
  (the shell passes the route as `resetKey`). Back to a recent screen reopens
  its drill at once; a copied link reopens it as soon as the screen draws
  that number. A link whose number is gone shows "This list is not on this
  screen any more" after a few seconds.
- A row that opens Prompt detail or a page leaves the drill on the URL of the
  entry before it: Back returns to the screen with the drill open.
- A topic's and the Questions screen's views (Grid, Tree, Pages, the result
  bar) open their counts in the searches drawer instead:
  `drawer=search-drill&stage=problem&result=not_cited` (`d.` before each key
  on Questions, whose List uses `result` and `source` itself; `kind` is the
  drill's Questions/Keywords filter, so the view's `type` never changes). The
  view stays behind it as it was; Close or Back returns to it. Links from
  before the drawer (`#/topics/t1?result=not_cited`) are rewritten to it in
  place (`topics/views/url.ts` `legacyDrillHash`).
- Get fix brief, on any screen but Fixes (a topic's views and its searches
  drawer, Questions, Citations › Pages, Overview's Next fixes), opens the page
  fix drawer over that screen: `drawer=page-fix&pfx.id=<fix>` (`pfx.tab=edits`
  for Page edits). Searches spread over several fixes list them all in
  `pfx.ids`, biggest first: the first opens with "Fix 1 of 3" and arrows. Open
  it with `openPageFix(ids, { start })` (`fixes/todo/openPageFix.ts`); `start`
  writes the brief at once and is never on the URL. Fixes keeps its own `?pf=`.
- `CountDrawer` and the `m3/DrillDrawer` wrapper keep their own state for
  screens that have not moved to `DrillNumber`; they use the same frame.

## Grid state in the URL (`utils/queryState.ts`)

```ts
const [q, setQ] = useQueryState('q')               // one value, in place
const [tab, setTab] = useQueryState('tab', { history: 'push' })
const [picked, setPicked] = useQueryList('pick')   // a comma list
const [sort, setSort] = useQuerySort('sort')       // key:dir,key:dir
const grid = useGridQueryState('drill')            // drill.q, drill.f, drill.sort, drill.pick
<ListGrid {...grid.listProps} … />
```

Typing and sorting rewrite the entry in place, so Back is not a keystroke
undo; a filter is a new entry Back undoes. A drawer's grid uses the drawer's
id as its prefix and lists those keys in `DRAWER_KINDS`, so they close with
it.

## Testing

- Unit tests run in happy-dom. `shell/drawers.test-helper.ts` (a vitest
  setup file) closes drawers and resets the store after every test.
- History steps and hashchange events are tasks: wait for them
  (`await new Promise((r) => setTimeout(r, 40))` inside `act`, or `waitFor`).
  A close shows at once; a route change through a row lands with its event.
- e2e: `tests/e2e/drawer.spec.ts` (open via link, Back, Forward, Esc, the
  guard on Esc and on Back, stacking, crumbs, a drill link). `drawerShots`
  (`tests/e2e/drawer-helpers.ts`) screenshots an open drawer at 1440×900 and
  1134×770.

## Known limits

- A drawer key with the same name as a screen key is taken by the drawer
  while the drawer is open (`new-topic` owns `step` and `topic`). Prefix new
  drawer keys (`drill.q`, `read-from`).
- A drill opened by `useDrill().open` from a control that does not register
  (a grid row, a chart mark) reopens from a link only after it is opened once
  on that screen.

## Where each overlay lives

Every task and detail view is on `Drawer`; every yes/no is on `Confirm`.
`SidePanel` and the old `tpl-dialog`, `hist-dialog` and `m3-drawer` styles are
gone. Drawers added in Wave 3:

| Overlay | Drawer id or URL value | File |
| --- | --- | --- |
| Prompts tab: add, edit, rephrase, settings | `pt-add`, `pt-edit` (`pt.edit`), `pt-rephrase` (`pt.rephrase`), `pt-settings` | `pageSetup/prompts/PromptDrawers.tsx` |
| Prompt detail: edit, re-check | `pd-edit`, `pd-recheck` | `promptDetail/edit/PromptEditDrawer.tsx` |
| Buyer profile: edit all, settings | `au-edit`, `au-settings` | `pageSetup/audience/panels.tsx` |
| Content gap settings | `gp-settings` | `pageSetup/gaps/GapsSettings.tsx` |
| History event, Add a note | `hist-event` (`he.id`, `he.note`), `hist-note` | `history/EventDrawer.tsx`, `history/NoteDrawer.tsx` |
| Add a market (page Markets tab) | `?panel=add-market` | `markets/components/AddMarketDrawer.tsx` |
| Sentiment answer, theme | `st-answer` (`sa.id`), `st-theme` (`sth.id`) | `sentiment/components/AnswerDrawer.tsx`, `ThemeDrawer.tsx` |
| Video idea flow | `?idea=<id>&idea.step=` | `videos/components/IdeaFlow.tsx` |
| How we measure | `?panel=method` | `overview/components/MethodDrawer.tsx` |
| Sort questions, Target page | `?panel=sort`, `?panel=target&pick=` | `questions/components/SortDrawer.tsx`, `TargetDrawer.tsx` |
| Merge, split topics | `?action=merge\|split&topic=` | `topics/list/components/TopicActionDrawer.tsx` |
| Target bands, Change target page | `topic-bands`, `topic-target` (`tt.ids`) | `topics/results/components/BandsDrawer.tsx`, `ChangeTargetDrawer.tsx` |
| Activity | `activity` (shell) | `start/ActivityPanel.tsx` |
| Edit the buyer profile (Start) | `start-buyers` | `start/edit/BuyerProfileDrawer.tsx` |
| Save to project (Playground) | `playground-save` (`pgs.run`) | `playground/SaveDrawer.tsx` |
| Playground gallery demo | `gallery-drawer` | `playground/gallery/PanelsSection.tsx` |

Old links still open them: `?filter=add|edit:<id>|rephrase:<id>|settings` on
Prompts, `?panel=edit|recheck` on Prompt detail, `?panel=edit-all|settings`
on Buyer profile and `?panel=settings` on Content gaps are rewritten to the
drawer in place; `?action=rename&topic=` opens Topic settings.

A drawer kept in a screen URL value (the second way under "Adding a drawer")
opens with `pushOverlayHash(hash)` and closes with `leaveOverlayHash(hash)`
(`utils/screenOverlay.ts`): Back closes it, a copied link reopens it, and
closing never leaves a dead Back step.

On `Confirm`: delete topic (`?action=delete&topic=`), re-check picked
questions (`?confirm=recheck&pick=` on Questions), Build menu reset and fresh
test (`?dialog=reset|fresh-test`), delete schedule, template resets, remove a
sending account, remove a market, delete a note.

Not drawers, on purpose: popovers (`drill/DrillPopover.tsx`,
`shell/StatusPopover.tsx`, `markets/components/SearchesPopover.tsx`,
`projects/…/DrillPopover.tsx`), menus (`components/ProjectSwitcher.tsx`), the
work console dock (`console/WorkConsole.tsx`), the full-screen Teleprompter
(`videos/components/Teleprompter.tsx`) and full-route flows (the topic
wizard, Import pages, Add a page).

## Drill counts

A drill's list is as long as the number that opens it (tests:
`drill/count.test-helper.ts`, `tests/e2e/drill-screens.spec.ts`). A count of
zero is plain text (`drill-num-zero`), never a button that opens an empty
list. Drill ids are opaque (`site:s<hash>`, never a domain or URL).
