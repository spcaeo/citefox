# Topics, keywords and the v2 design system

Approved by the owner on 2026-10-21.

## 1. Design system v2 — "Spruce & Fox"

Source of truth today: `src/renderer/src/styles/tokens.css` and the shared `src/renderer/src/ui/`
components. The values below are the original 2026-10-21 design.

- Ground `#EEF1F0`, surface `#FFFFFF`, inset `#F5F7F6`, line `#DDE2E0`, line strong `#C7CEC8`.
- Ink `#15201E` / `#394643` / `#586461` / `#8C9693` (decor only). Sidebar spruce `#152829`, active `#203E38`.
- One accent, fox `#C2410C` (hover `#9A3412`, tint `#FCEFE7`, line `#F1C7AE`). Fox means only two
  things: the project's own brand being cited, and the screen's one primary action.
- Semantic success / warning / danger / info with tints (see the theme board). Chart: cited = fox,
  not cited = `#829986`, no AI Overview = hatched `#DCE2E0`, goal band `#CFE3DE`.
- Type: Geist (UI, tabular numbers), Geist Mono for URLs and code only. Display 32/40 600,
  H1 22/28 600, H2 16/24 600, H3 14/20 600, body 14/20, small 12/16.
- 4/8 spacing; cards pad 24 and sit 24 apart; page padding 32; radius 6 controls, 10 cards/menus,
  14 drawers; sidebar 220, top bar 56.

Layout rules (owner feedback, binding):
- Anything that is a list is a **list grid**, not cards: full width, sortable headers, search,
  filter chips/segments, checkbox bulk select with a bulk bar, collapsible group headers with
  counts, tabular numbers, 44px rows, and row actions behind a right-hand `⋯` menu. One shared
  component everywhere (build on `src/renderer/src/grid`).
- Big screens split with **tabs**. Cards only for KPI tiles and small context panels/rails.
- One primary (fox) button per screen; secondary = outline, tertiary = ghost/text.
- AI actions: ONE `AI` sparkle menu per section/grid toolbar (Discover more, Rewrite, Explain,
  Prioritise…), suggestions appear as one dismissible suggestion card/line. Every assist shows
  "Claude · about N s", what it reads ("Uses your site, no searches" / "No new searches"), and
  changes nothing until Apply. Unconfirmed facts in [brackets]. Never claim a change caused a citation.
- Sidebar is collapsible: a collapse/expand button and Cmd/Ctrl+B; collapsed = 64px icon rail with
  tooltips; state persists across restarts; auto-collapses on narrow windows unless pinned open.
- Wizards: horizontal stepper, sticky footer with Back (ghost) + one primary + a one-line cost note.
- Results: KPI row (equal tiles), tabs, grid.

## 2. Topics (cluster checking)

A **topic** is a tracked subject with no single URL. It reuses the page pipeline: a `pages` row
with `kind = 'topic'` (existing rows are `kind = 'page'`), `url` NULL, `title` = topic name,
plus a `topics` side table (seed, source = seed | questions | competitor, competitor_url,
website, about, depth settings JSON, target bands). Prompt sets, runs, check jobs, markets,
schedules, drills, Ask and exports keep working because they already key on `page_id`.

Per prompt (questions and keywords): `kind` = `question` | `keyword`; `stage` (problem, options,
doubts, fit, compare, decide; nullable); `source` (claude, imported, competitor, user) and
`source_note`; for keywords `kw_group`, `kw_group_kind` (coverage | intent), `intent`
(informational | commercial | navigational), `funnel` (tofu | mofu | bofu), `page_type`
(landing page | blog | comparison page | listicle | glossary | product page);
`target_page_id` (an own tracked page, nullable), `match_confidence` (0–100), `match_reason`.

Per run result, derived `match_state`:
- `right_page` — the target page is cited;
- `other_page` — another own-domain page is cited ("wrong page");
- `not_cited` — target page exists, own domain not cited;
- `no_page` — no target page and own domain not cited;
- `no_aio` — no AI Overview (excluded from the goal).

Topic scoring: a prompt counts as **cited** when ANY own-domain page is cited.
Goal = cited ÷ prompts that showed an AI Overview, per kind (questions and keywords are scored
and shown separately). Default target bands: questions 50–70%, keywords 25–40% (editable per
topic). "To reach the band" = questions needed to reach the band's lower edge.
Win odds (0–100, for ordering the to-do): heuristic from AIO present, own page coverage
(match confidence), how many small/non-brand domains are cited, and current position; label
High ≥70, Medium 40–69, Low <40. It is a ranking aid, labelled as such.

## 3. Add wizard

"What do you want to track?": A page URL (existing flow) · A problem or seed · My own
questions · A competitor's page · Search Console (coming later, disabled; suggests pasting into
My own questions). Claude "Suggested start" card from saved project data (no searches).

Seed path steps: Seed → Buyer profile → Questions → Keywords (only when generating keywords) →
Pages → Estimate.
- Seed: problem statement, website (project default), about the business, brand + aliases and
  competitors (from project), markets, **what to generate** (buyer questions / keywords & groups /
  both), question depth (Quick 15 · Standard 30 · Deep 60 · Custom with per-stage counts, max 100).
  Discover with AI: reads homepage + key pages (Jina, no searches) and suggests seed statements,
  segments, competitors.
- Buyer profile: Claude-written sections (who, environment & tools, segments, triggers, what
  they value incl. price, poor fit) as an editable list grid/section list, versioned; per-section
  AI menu (Discover more with evidence/source line, Rewrite, Make shorter, Explain); top
  "Fill gaps from your site".
- Questions: grouped by journey stage (tabs or stage column), long first-person situational
  questions, never the brand; edit inline, add own, AI: Discover more per stage, Find journey
  gaps, Rewrite in buyer language, overlap badges.
- Keywords & groups: seeds; Discover core terms & synonyms; depth Quick ≈30 · Standard ≈100–120 ·
  Deep ≈250–500 · Custom (max keywords, synonyms per core term, pattern variants such as
  "ai X software" / "automated X software" / "X automation" / "ai-powered X" / "X for <segment>",
  long-tail questions on/off, intent families, per-group cap). Groups: coverage groups per core
  term synonym + intent groups (Definitional, Core category, Best/top lists, Pricing/free/trial,
  Alternatives & vs, Features, How-to, Benefits/ROI, Problem-aware, Question long-tail,
  Trust/risk, Emerging terms, Branded defensive, Competitor vs). Tabs Groups | All keywords |
  Depth settings; live summary "N keywords in G groups · ≈N–2N searches per market · X left".
- Pages: Claude matches each prompt to an own tracked/sitemap page with confidence + one-line
  reason, or No page yet; change/confirm; "Draft a page brief" and an external
  "Write with 1000AIOverviews" link (https://1000aioverviews.com — opens the browser, sends no data).
- Estimate: prompts × markets ≈ searches (1–2 each), budget/remaining, options Check all now ·
  Check N now and the rest over 7 days · Check one stage/group first; Claude budget plan
  ("likeliest wins first"). Start creates the topic, prompt set, and check job / stagger schedule.

My own questions: paste or CSV (column picker: question, optional source/notes), clean-up
preview (duplicates merged, brand names flagged, very short flagged but kept), "Clean up and tag
with Claude" (before/after), then Pages → Estimate.

Competitor page: URL → page read (Jina: title, meta, H1, outline) → Claude questions from their
page (both brands excluded) → markets → Pages → Estimate. After a check: "They're cited, you're
not: N questions" (competitor domain cited, own domain not).

## 4. Topic results

Header: topic name, source line, market picker, Edit topic, Export, Check now (primary).
KPI tiles: Buyer questions cited (goal bar + band, trend), Keywords cited (own band),
AI Overview shown (n/N, failed searches named separately), To reach the band.
AI summary line ("Since <date>: …", timing not proof). Ask about this topic box (Ask CiteFox
with topic filters, no new searches).
Tabs: **To-do** (grid grouped by match_state — Page exists not cited · Another page cited · No page
yet · Cited by the right page — columns Q, question, stage, target page, cited instead, win odds;
stage filter; row menu: See who's cited, Change target page, Why aren't we cited?, Draft the fix,
Write with 1000AIOverviews) · **By stage** (per-stage cited / not cited / no AIO) · **Keywords**
(By group / intent / funnel / page type tables: keywords, AIO shown, you cited, brand named,
cited rate) · **Progress** (goal % per check over real dates).
Every number is a drill (existing drill system; add routes for topic, stage, group, match_state).

## 5. Exports

HTML report / PDF / XLSX / CSV / JSON gain a "Topic coverage" section for topic subjects: goal
bars per kind, stage table, to-do counts by match_state with rows, keyword universe tables
(group, intent, funnel, page type), Claude executive summary + next 3 actions (from saved data).

## 6. Templates (versioned, overridable, logged like existing ones)

`topic_seed_discover`, `topic_buyer_profile`, `topic_profile_discover`, `topic_journey_questions`,
`topic_questions_discover`, `topic_keyword_terms`, `topic_keyword_expand`, `topic_page_match`,
`topic_page_brief`, `topic_questions_cleanup`, `competitor_page_questions`, `topic_summary`,
`topic_why_not_cited`, and for §8 `topic_cluster_suggest`, `topic_cluster_sort`,
`topic_cluster_name`. Inputs: seed, brand_name, aliases, competitors, website text excerpts,
sitemap titles, tracked pages (title, url, outline), market/language, counts. Outputs are JSON
validated with a schema; questions never contain the brand or aliases.

## 7. Not in this release

Search Console import (needs the owner's Google OAuth client). Competitor-domain reverse lookup.

## 8. Topics and clusters

How to add topics, group questions into them and move questions between them. Approved
mock-ups: Topics.dc.html, Grouping.dc.html, NewTopic.dc.html. **A question sits in one place**:
one topic, or the page it was set up on ("Not in a topic"). Nothing here spends a search: a
topic made here waits for Check now or its first interval check (held one interval out).

### 8.1 Topics screen (`#/topics`, sidebar "Topics")

- Header: "Topics", the lead line (a topic is a cluster of buyer questions; aim for 50–70%),
  Suggest topics and New topic (primary, `?dialog=new-topic`).
- **How it fits** strip: Topic → its buyer questions → the page that should be cited. Stages
  (Problem → Decide) are a label on each question, not a level.
- KPI strip: Topics tracked · Questions in topics (drill) · In the 50–70% band, n of m topics
  with a rate (drill) · Questions not in a topic (link to Questions, grouped by topic).
- Topics list (ListGrid): name with origin, cadence and last check underneath (so the grid fits
  1134 px without scrolling sideways); Questions (drill); Cited (band x–y%) as goal bar, % and
  band chip (drill: the cited questions); Overview "n of N" (drill); Target pages (UrlText,
  "+n"). Row ⋯: Open, Add questions
  (`?dialog=add-questions&target=<topicId>`), Rename, Merge into another topic…, Split by
  stage…, Delete topic (confirm, then Undo on the status line).
- **Suggest topics** (`?suggest=1`): Claude's ideas from the site, buyer profile and
  competitors, each with an example question, ~N questions and the page that fits (or "a new
  page"). Tick → "Create N topics" (draft questions, no check). "Suggest others" asks again
  avoiding names already shown. Ideas stay in memory per project so Back/Forward does not ask
  again.
- **Results by** Topic · Stage · Target page (`?results=`): Questions, Cited previous, Cited
  latest, Share (previous → latest in one cell), Change (pts, coloured). Share = own site cited ÷
  questions with an AI Overview, on each question's previous and latest check. Each count
  drills and the drawer count equals the number.
- Row actions are URLs: `?action=rename|merge|split|delete&topic=<id>`; the marked row is
  `?row=<id>`. An id that is not listed shows "That topic is not available to you."
- Empty state: New topic and Suggest topics.

### 8.2 Questions grouping (`#/questions`)

- Group by Topic (default) · Stage · Target page · None (`?group=`).
- Group header: name, count, "cited x of y", band chip (topics), "+ Add to this topic".
- "Not in a topic" bucket with **Sort into topics with AI** (`?panel=sort`): Claude proposes a
  topic (or a new topic name) per question; the user confirms before anything moves.
- Row checkboxes → bulk bar: Move to topic (topics with counts, Not in a topic, "New topic
  from these N…" which opens New topic with `questions=<ids>` and a suggested name), Set
  stage, Set target page (`?panel=target&pick=<ids>`), Pause, Re-check.
- Drag a row (or the ticked rows) onto a topic heading to move it.

### 8.3 New topic dialog (`?dialog=new-topic`)

Opened from + Add → Topic, the Topics screen and Questions. Name, then four ways to start: A
buyer problem · One of my pages · My own questions · A competitor's page. The buyer situation
and a preview of about ten questions across the stages; "Also move in N questions you already
track" (picked from questions not in a topic). Then Review questions → Target pages → Create
topic. It reuses the wizard engine (`topics:createDraft`, `generateQuestions`, …) and saves
with `topics:createFromDraft`. URL values: `draft`, `step`, `way`, `questions`, `topic`;
closing drops them. "Open the full wizard" goes to `#/add/<draftId>`.

### 8.4 Channels and move rules

`topics:moveQuestions`, `topics:setQuestionStage`, `topics:merge`, `topics:split`,
`topics:createTopics`, `topics:createFromDraft`, `topics:suggestTopics`, `topics:sortQuestions`,
`topics:suggestName` (src/shared/ipc/topicClusters.ts).

- A move saves one new prompt-set version on every page or topic the questions leave and on
  every one they join. Each moved prompt gets a new id with a `prompt_lineage` row to its old
  id (page id = where it went), so `questions:list` follows its earlier checks across pages:
  the Questions screen and drills show its history at once.
- A topic question keeps its `topic_prompts` row: stable key, stage, target page, match. A
  page question moved into a topic gets a row with that page as its confirmed target and the
  stage its intent stands for.
- Destination `page` sends a topic question back to its tracked target page; without one it
  is skipped. A page keeps at least one question; a topic emptied by a move is removed.
- Skipped questions come back with a plain reason (older version, already there, same
  wording already in the destination, unsaved prompt edits).
- Waiting batches of the source topic drop moved stable keys; an emptied batch is cancelled.
- Set stage changes `topic_prompts.stage` on every version of the question (same stable key);
  page questions are skipped.
- Merge moves every question into the other topic, then removes the merged one (questions
  with the same wording already there are not copied twice).
- Split keeps the stage with most questions (ties: earlier stage) and the questions with no
  stage; each other stage becomes "<topic> · <Stage>" with the topic's markets, interval,
  bands and seed.
- Known limit: Topic results read a topic's own checks, so moved-in history shows on
  Questions and in drills, and on the topic's results from its next check.

