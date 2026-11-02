# ✦ Help me fill this

One helper for every list a user would rather not fill by hand: questions,
topics, buyers, competitors, pages, markets, fixes. It offers two ways, side by
side, as two choice cards:

1. **✦ Describe it.** The user writes a sentence. In-app Claude drafts the rows.
   The cost shows before anything runs ("1 Claude call · about $0.01", or "on
   your Claude plan").
2. **Use your own ChatGPT.** Three steps. The user picks a chatbot (ChatGPT,
   Perplexity, Claude, Gemini or Copilot) and copies one prompt that already
   holds the project's context and the exact reply columns. Then they paste the
   answer back and press **Read the answer**.

Either way, main merges near-duplicates, both within the answer and against what
is tracked. For neutral question lists it also sets aside rows that name the
brand. A banner says what happened: "Read 15 rows. 2 were close to questions
you track and were merged. 1 named TextBolt and was set aside. 12 are ready."
The rows then go to **the place's own review UI**. Nothing is saved without the
user's click.

Mock-up: `HelpFill.dc.html` on the nav canvas (panels 1–3 are the helper, panel
7 lists the places). Reference adopter: Add questions → **✦ Help me write**
(`src/renderer/src/addQuestions/components/HelpTab.tsx`).

## Rules

- **No new screens.** The helper lives inside the existing drawer, dialog, tab
  or empty state. It adds no sidebar items or settings pages.
- **One green primary per screen** (`Docs/HEADER.md`). The helper's buttons are
  white or text. ✦ is orange.
- **Every state has a URL.** The way is `help=describe|chatbot` and the bot is
  `bot=chatgpt`. Picking a way is a history entry, so Back returns to the other
  way. Picking a bot rewrites the entry in place. The last bot picked is also
  remembered per person (`localStorage`, read in try/catch). The URL wins.
- **No Claude key:** the Describe card says "Needs a Claude key. Use your own
  ChatGPT instead (free)." and the helper opens on the chatbot way. A pasted
  link that names Describe moves to the chatbot way.
- **Prompts never carry a key, an email address or a file path.**
  `scrubPrivate` in `src/main/helpfill/prompt.ts` removes them after the prompt
  is built, and `service.test.ts` checks it.
- **Reply columns come from `IMPORT_FIELDS`** (`src/shared/import-fields.ts`)
  where an entity exists, so the paste-back and the CSV template agree.
- **Open \<bot\>** fills the prompt in with `?q=` only when the bot reads it
  (ChatGPT, Perplexity, Claude, Copilot) and the link stays under 2,000
  characters. Otherwise it copies the prompt, opens the bot's home page, and
  says so. Links open through the app's safe path: `window.open` hands the URL
  to main's window-open handler, which calls `shell.openExternal` for https only.

## Code

| Part | Where |
| --- | --- |
| IPC contract | `src/shared/ipc/helpfill.ts`: `helpfill:estimate`, `helpfill:prompt`, `helpfill:read`, `helpfill:describe`; before a project exists, `helpfill:setupEstimate`, `helpfill:setupPrompt`, `helpfill:setupRead` (`src/main/helpfill/setup.ts`) |
| Bots, open links, banner words | `src/shared/helpfill.ts` (`chatbotOpen`, `helpFillSummary`, `HELPFILL_BOT_SPECS`) |
| Kind registry | `src/main/helpfill/registry.ts`, `types.ts` (`HelpFillKindDef`) |
| Context | `src/main/helpfill/context.ts`: the existing blocks in `prompts/blocks.ts` and `competitorContext`, plus tracked pages and questions |
| Prompt builder | `src/main/helpfill/prompt.ts` |
| Reply reader | `src/main/helpfill/reader.ts`: CSV, TSV, semicolon, a markdown table, a fenced block, a numbered or bulleted list, bare lines and `### SECTION` replies. Chatter around them is ignored. Built on `import/csv.ts` and `import/table.ts` |
| Merge and set aside | `src/main/helpfill/merge.ts`: `SimilarIndex` exact and merged matches (`questionMergeKey`), `brandNamed` |
| Requests and service | `src/main/helpfill/parse.ts`, `service.ts`, `src/main/handlers/helpfill.ts` |
| Renderer kit | `src/renderer/src/ui/HelpFill/`, exported from `ui/index.ts` |
| Gallery demo | `#/playground/gallery` → "Help me fill" (`playground/gallery/HelpFillSection.tsx`) |

## Adding a place

Three steps: register a kind in main, render the component, and map its rows
into the place's review UI.

### 1. Register a kind (main)

Add `src/main/helpfill/kinds/<place>.ts` and list it in `SHIPPED_KINDS`
(`src/main/helpfill/registry.ts`). The channels then accept the new `kind`
with no contract change.

```ts
export const COMPETITORS_KIND: HelpFillKindDef = {
  kind: 'competitors',                      // the `kind` the renderer passes
  noun: ['competitor', 'competitors'],      // banner: "2 were close to competitors you track"
  scope: 'project',                         // 'page' makes scope.pageId required
  sections: [{ id: 'main', title: null,     // title null = one block; several = `### TITLE` each
    columns: ['domain', 'name'],            // reply header in order; the first is the main value
    entity: 'competitors' }],               // header words come from IMPORT_FIELDS
  neutral: false,                           // true: rows naming the brand are set aside
  defaultCount: 5, maxCount: 10, chatbotCount: 15,
  describeCost: { calls: 1, usd: 0.01 },    // "1 Claude call · about $0.01" (API key) / "on your Claude plan"
  role: (ctx) => 'You help a company list who it loses deals to.',
  task: (ctx, count) => [`List ${count} competitors…`, 'domain = a bare host'],
  tracked: (ctx) => ({ listed: [...], merge: { main: [...] } }), // listed in the prompt / merged into
  key: (values) => values.domain ?? '',     // optional; default is the main value (through questionMergeKey)
  clean: (values, ctx, section) => values,  // optional; return null to drop the row
  extra: (db, project, pageId) => ({ markets: ['US · en'] }), // optional; lands on ctx.extra
  describe: async (host, ctx, { sentence, count }) => [{ section: null, values: { domain: 'x.com' } }]
}                                           // describe is optional; leave it out and estimate says not available
```

The builder adds the rest itself:

- the role line and the context blocks, without the lines that have no value
  ("What it does: not given.", "Triggers: not known."; `withValues` in
  `prompt.ts`; the shared blocks keep them for the in-app prompts);
- the "Page:" or "Topic:" line;
- "Already tracked, don't repeat: N …";
- "Reply with CSV only, this header:", or one CSV per `### TITLE`;
- the tracked list, up to 150 items.

**Reuse an existing assist or generator for Describe.** Don't write a new
prompt. Questions call `runAssist('prompts.more')` with the user's sentence as
the instruction (`kinds/questions.ts`). Competitors would use
`project.productCompetitors`, markets `markets.suggest`, buyers
`audience.sharpen` / `audience.triggers`, a fix `gaps.draftFix` or
`progress.draftFix`, and the report `report.summary`.

**For a multi-section kind** (New project: products, buyers, competitors,
markets, questions), give each section a `title` and its own columns and
entity. The reader matches `### PRODUCTS`, `**Products**` or `Products:` to the
section by its title, id or `synonyms`. Each row comes back with its `section`.
A section's `fields` maps a column to a different `IMPORT_FIELDS` id when the
names differ (Markets: `{ city: 'location' }`). A CSV header line is never read
as a section heading, even when it holds a section's word.

Test it like `src/main/helpfill/service.test.ts`. Use
`seedAssistProject()` (a scripted Claude), assert the prompt and the scrub,
then read a realistic pasted answer end to end.

### 2. Render the component (renderer)

```tsx
import { HelpFill, useHelpFillUrl, createHelpFillSource } from '../ui'

const source = useMemo(() => createHelpFillSource(), [])
const url = useHelpFillUrl('comp.')       // a screen: `comp.help=`, `comp.bot=` on its own query

<HelpFill
  kind="competitors"
  projectId={projectId}
  scope={{ pageId: null }}               // a page or topic id for page-scoped kinds
  source={source}
  {...url}                               // way, onWay, bot, onBot
  describe={{
    label: 'Who do you lose deals to?',
    chips: [{ id: 'web', label: 'Search the web for them', text: 'Find them on the web.' }],
    counts: [5, 10],
    defaultCount: 5,
    buttonLabel: (n) => `Find ${n} competitors`
  }}
  chatbot={{ tip: 'Perplexity is best for competitors: it searches the web.' }}
  onRows={(result, way) => review(result.rows)}
/>
```

- **Inside a drawer**, don't use `useHelpFillUrl`. Add `help` and `bot` to the
  drawer's keys in `DRAWER_KINDS` (`shell/drawerUrl.ts`; prefix them when a
  screen key could clash). Then pass `way={wayParam(params.help)}`,
  `bot={botParam(params.bot)}`,
  `onWay={(way) => setDrawerParams(depth, { help: way }, { push: true })}` and
  `onBot={(bot) => setDrawerParams(depth, { bot })}`. See Add questions in
  `shell/DrawerHost.tsx`.
- **Chips.** A chip with `text` puts that sentence in the box, and a second
  press takes it out. A chip with `onPick` runs the place's own action. Add
  questions uses one to show Google's "People also ask" (free); pass `pressed`
  for it.
- **Redo.** After a Describe run, "Tell Claude what to change…" runs Describe
  again with `Change: …` added to the sentence.
- `openLink` is a test seam (the default is the safe path). `testId` prefixes
  the test ids (`<testId>-summary` is the banner).
- **A kind that works on the place's own rows** (Match pages) passes them as
  `items`; the prompt is rebuilt when they change. `ways.describe.text` replaces
  the Describe card's "CiteFox writes the …" line, and `banner={false}` hides
  the banner when the place says what happened itself (the same props as
  helpfill-actions).
- `HelpFillProps`, `HelpFillDescribeCopy`, `HelpFillChatbotCopy` and
  `HelpFillChip` are in `ui/HelpFill/types.ts`.

### 3. Map rows into the place's review UI

`onRows(result, way)` gets a `HelpFillResult`:

- `rows`: each has an `id`, a `section` and `values` by column id.
- `setAside`: the rows that named the brand, if the place wants to show them.
- `counts`: what the banner said.
- `warnings`: for example, no table was found.

The place turns the rows into its own review items and saves only on the
user's click. Add questions shows them ticked in "Drafted · tick the ones to
keep" with their stage and page (`hooks/useHelpRows.ts`). "Add N to the rows"
moves them into `RowsGrid`, where each row is checked like a typed one. The
footer's single green **Add and check now** stays the only primary.

## Text kinds (one piece of writing, not rows)

Some places want one text back, not a list: a fix's new section, a pitch
email, a report summary. A kind becomes a text kind by adding `text` to its
definition. Rows kinds are unchanged.

```ts
export const FIX_KIND: HelpFillKindDef = {
  kind: 'fix',
  scope: 'page',
  needs: ['promptId'],                     // scope.promptId required ("Pick a question first.")
  contextBlocks: false,                    // the evidence carries what the prompt needs
  text: {
    evidence: (host, ctx) => lines,        // the stored facts the prompt quotes; may throw
                                           // HelpFillEvidenceMissing(message, nextStep)
    maxChars: 6000,                        // longer pastes are cut, with a warning
    check: (text, evidence, ctx) => ({ text, warnings }) // optional: report.ts drops sentences
  },                                       // whose numbers the report does not hold
  // role, task, sections ([{ columns: ['text'] }]), describe… as for any kind
}
```

- **Scope** can carry `promptId` (a question) and `subject` (an opaque id the kind
  reads: a cited page row, a report schedule). Both are optional, so rows kinds
  send `{ pageId }` as before. `needs` makes them required.
- **The prompt** is the role, the evidence lines, then the task
  (`buildHelpFillTextPrompt`). Empty lines are left out and the prompt is scrubbed
  like any other. It never carries keys, email addresses or file paths.
- **The reader** (`src/main/helpfill/text.ts`) keeps the answer and drops the
  chatbot's chatter: an opening "Sure! Here is…" or label line, a closing "Hope this
  helps", a source list, Perplexity's `[1]` marks. A fenced block wins when there is
  one. The result has one row (`values.text`) and `result.text`.
- **The banner** says "Read the answer: 86 words." plus any warning from the check,
  in the warning tone.
- **Renderer props** for places that are not lists: `ways` renames the two cards
  ("Draft it for me", "Rewrite with my ChatGPT"), and `only` offers one way with no
  cards (`describe` for an alert rule; `chatbot` where in-app Claude already has its
  own button). With `only="describe"` and no Claude key the helper says to add one in
  Connections. `banner={false}` leaves out the banner for a place that says what
  happened in its own words (the alert rule's "Filled in below.").

## Places that use it

| Place | Kind | Ways | Where | URL |
| --- | --- | --- | --- | --- |
| Fix rewrite (panel 5) | `fix` (text) | Draft it for me (`gaps.draftFix`, else `progress.draftFix`) · Rewrite with my ChatGPT | Fix drawer → "The new text" (`fixes/drawer/FixRewrite.tsx`); the answer replaces "What changed", with Undo | `fix.help`, `fix.bot`, `fix.for` (the question) |
| Outreach pitch | `pitch` (text) | Draft it for me (`citations.pitch`) · Write it with my ChatGPT | Citations → an other site's page → a question where a competitor is cited and you are not → "✦ Draft a pitch" (`citations/pitch/PitchDrawer.tsx`); shown with Copy, never sent | `drawer=pitch`, `pitch.row`, `pitch.page`, `pitch.prompt`, `pitch.help`, `pitch.bot` |
| Alert rule | `alertRule` (rows, one row) | Describe only (`alerts.describeRule`) | New alert rule → "✦ Describe it" (`alerts/rules/RuleDescribe.tsx`) fills the fields for review | — (one way, no state) |
| Report summary | `reportSummary` (text) | Chatbot only (Claude is in the AI menu already) | Schedule → Email preview → AI menu → "Write it in your own voice with my ChatGPT" (`reports/schedules/components/OwnVoiceSummary.tsx`); number-checked, shown with Copy | `schedule.help=chatbot`, `schedule.bot` |
| Add questions (reference) | `questions` (rows) | Describe it (`prompts.more`) · Use your own ChatGPT | Add questions → "✦ Help me write" (`addQuestions/components/HelpTab.tsx`) | `help`, `bot` |
| Competitors (panel 6) | `competitors` (rows) | Describe it (`project.productCompetitors`, web search) · Use your own ChatGPT (Perplexity tip) | Competitors → ⋯ "Help me find competitors" or the empty state → the competitors import's Check step | `drawer=import`, `import.help`, `import.bot` |
| Match pages (panel 7) | `matchPages` (rows, `items`) | Describe it (`questions.matchPages`) · Use your own ChatGPT | Add questions for a topic → "✦ Match pages" next to "Set page for all" (`addQuestions/components/MatchPanel.tsx`) | `match=1`, `mhelp`, `mbot` |
| Empty lists | the place's kind | Opens the place's helper | Competitors, Questions (`tab=suggest`), Topics (New topic, `way=problem`) via `HelpFillPair` | the place's own |
| New project and Onboarding › Profile (panel 4) | `project` (five `### ` sections) | ✦ Read my website (`projects:fillFromWebsite`) · Use my own ChatGPT · I'll fill it in | "How should we set up …?" under the domain field (`fill/setupHelp/SetupHelp.tsx`, mounted in `projects/NewProjectForm.tsx` and `onboarding/ProfileScreen.tsx`); channels `helpfill:setup*` as there is no project yet | `help=website\|chatbot\|form`, `bot` |
| Buyer profile | `buyers` | Describe (`buyerProfile:generate`, `audience.sharpen`, `audience.triggers`) · chatbot | Page › Audience (`pageSetup/audience/useBuyerHelp.tsx`) | `au.help`, `au.bot` |
| Markets | `markets` | Describe (`markets.suggest`) · chatbot | Both Add market drawers (`projectMarkets/MarketHelp.tsx`) | `mk.help`, `mk.bot`; drawer `am.help`, `am.bot` |
| New topic | `topic` | "A buyer problem" (the dialog's own box, with the ✦ look) · chatbot | New topic → A buyer problem (`topics/newTopic/components/ProblemHelp.tsx`) | `nt.help`, `nt.bot` |

How the rows places work:

- **Competitors** (kind `competitors`, `kinds/competitors.ts`; columns `name`,
  `domain`, `competes_with`). Describe asks "Who do you lose deals to?" and runs
  the web-search competitor finding (`competitorsByProduct` →
  `project.productCompetitors`) with the sentence; each domain is checked by
  DNS. The chatbot way shows "Perplexity is best for competitors: it searches
  the web." The saved competitors are listed and merged; a row on the project's
  own site is dropped, and one naming the brand is set aside. The rows go into
  the **competitors import** as a paste and land on its Check step, where the
  importer's own preview checks them and **Add N competitors** saves them.
  `competes_with` maps to a product (`productIdNamed` in `import/commit.ts`).
  Entry points: the ⋯ menu ("Help me find competitors") and the "No
  competitors yet" empty state.
- **The importer's helper slot** (`importFlow/help.ts`, `IMPORT_HELP`). A list
  whose entity is in `IMPORT_HELP` gets a "No list yet?" card on Choose; the
  helper replaces Choose while open (`import.help=1|describe|chatbot`,
  `import.bot=` on the drawer's URL). Add an entity there (kind, copy, reply
  columns) to give its import the helper. `rowsAsPaste` turns the rows into the
  TSV the importer reads.
- **Match pages** (kind `matchPages`, `kinds/match-pages.ts`; columns
  `question`, `page`; `trackedLine: false`). "✦ Match pages" sits next to "Set
  page for all" in Add questions for a topic (`match=1`, `mhelp=`, `mbot=`).
  The rows go to main as `items` (new optional request field, up to 200 × 500
  characters). Describe runs the `questions.matchPages` assist (40 rows per
  call); the chatbot prompt lists the tracked pages and the numbered rows and
  reads `question,page`. A tracked path becomes that page's URL; "none" leaves
  the row; any other path comes back as `untracked` and is flagged under the
  panel, never set. Each matched row's page is set in `RowsGrid`, where it can
  still be changed. Nothing is saved before the footer's button.
- **Empty lists** (`HelpFillPair` in `ui/HelpFill/HelpFillPair.tsx`): the
  place's green primary plus a white "✦ Help me find them" / "✦ Help me write
  them", only where a kind exists. Competitors opens the import with the
  helper; Questions opens Add questions on `tab=suggest`; Topics opens New topic
  on `way=problem`. Pages and Citations have no kind or no add flow, so they
  keep their empty states.

What each one leaves out, and why:

- **Fix: no checklist chips.** Panel 5 shows "answer first · 2 sentences · one
  number" chips. CiteFox has no checker for those rules today, so they are not shown;
  the rules are in the prompt's task instead.
- **Alert rule: no chatbot way** (panel 7 says it is not needed). Claude picks pages,
  markets and addresses by short refs (P1, M1, E1) from the lists already set up, and
  main maps them back; the drawer checks every id again and fills an address only when
  it is already used in Alerts. Nothing is saved until Save rule.
- **New project: three ways, and the questions wait.** Both reads land in the same
  Fill card. The answer's questions become a ticked plan (one topic per product,
  plus "General"), created with `topics:createTopics` only after Create project, or
  after Continue saves the profile in onboarding. Markets after the first are noted,
  not saved (add them in Markets). In onboarding "Read my website" stays open with no
  Claude yet, since picking it runs the Claude check first.
- **Report summary: not saved.** A schedule stores only a summary style, not a text,
  so the own-voice summary is for copying. The schedule's own number check applies to
  the pasted text.
- **Empty lists: no Fixes, Markets, Buyers, Pages or Citations pair.** A fix's helper
  needs a page or topic and a ticked question, which an empty list has not got;
  Markets and Buyers are adopted in their own drawers; Pages has no kind and
  Citations no add flow.

## Tests

- Main: `npx vitest run src/main/helpfill --testTimeout=30000` (reader,
  merge, service: prompt privacy, read and describe end to end).
- Renderer: `src/renderer/src/ui/HelpFill/HelpFill.test.tsx` (ways, no key, the
  copy tick, open links, URL state, axe) and
  `src/renderer/src/addQuestions/AddQuestionsDialog.test.tsx`.
- Shared: `src/shared/helpfill.test.ts` (open links, banner words).
- Text kinds: `src/main/helpfill/text.test.ts` and `src/main/helpfill/kinds/kinds.test.ts`
  (the fix, pitch, report and alert rule prompts, reads and Describe runs).
- Rows places: `src/main/helpfill/kinds.test.ts` (competitors and match pages),
  `importFlow/ImportHelp.test.tsx`, `addQuestions/MatchPanel.test.tsx`.
- e2e (Docker): `npm run test:e2e:docker -- tests/e2e/helpfill-questions.spec.ts`,
  `tests/e2e/helpfill-actions.spec.ts` for the fix, pitch, alert rule and report places,
  and `tests/e2e/helpfill-competitors.spec.ts` / `helpfill-match-pages.spec.ts` (shared
  set-up in `tests/e2e/helpfill-helpers.ts`).
  It runs both ways on the real handlers. The `claude` stand-in answers
  `prompts.more`, and the clipboard and `shell.openExternal` are stubbed. It
  also takes screenshots in both themes at 1440 and 1134. The other places have
  one spec each: `helpfill-setup` (New project and onboarding), `helpfill-buyers`,
  `helpfill-markets` and `helpfill-topic`.

## Places still to adopt (panel 7)

None. The 3-step API key card (panel 6) is done too. It covers cloro, Anthropic,
SerpApi and Jina, in Connections and in the add-key drawer. Step 1 is make an
account (sign-up link), step 2 is copy your API key (dashboard link) and step 3 is
paste it here, with one green "Test and save". It lives in `keys/KeySteps.tsx`,
`keys/testAndSave.ts` and `keys/providerLinks.ts`. The cloro sign-up address is
the one constant `CLORO_SIGNUP_URL`. Its e2e is `tests/e2e/engines-settings.spec.ts`. In
e2e, key tests answer from recorded bodies (`tests/e2e/key-test-stub.ts`).
