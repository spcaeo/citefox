# CiteFox metrics: one place for every number

Phase 0 of the Reports plan. Every number in the reports and the analysis screens should come from one module, `src/shared/metrics/`. The module is pure. It does not touch Electron, the database or the clock, and it never calls an AI. It takes plain check rows and returns the numbers. Each number carries the rows behind it, so clicking a number opens a drawer with exactly that many rows (NFR-14).

- **Module:** `src/shared/metrics/` (`computeMetrics`, plus the smaller functions it is built from).
- **Assembler:** `src/main/metrics/assemble.ts` reads stored checks into rows.
- **IPC:** `reports:metrics` with `{ projectId, scope, marketId, engine, from, to }` returns a `MetricsResult`.
- **Already reading it:** Summary's verdict sets (`engine/overview/compare.ts`), and every Summary widget under All engines and under ChatGPT, Perplexity, AI Mode, Gemini or Copilot (Headline numbers, Results at a glance, Who gets cited, Questions that changed, the trend chart). Under All their numbers equal Reports → Visibility report's for the same scope, market and engine (`overview/widgets/allEngines.test.tsx`); only Google AI Overview keeps Summary's own Google numbers and "AI Overview" words (and so does All in a project that checks Google only, where the engine filter is a fixed Google logo). In the offline report: the overview tiles, the verdict, and the What changed counts (`export/model/metric-rows.ts`).

## The input: one row per question per check

A row is one question, checked once, on one engine, in one market. Each row has exactly one **result**:

| Result | Plain meaning |
|---|---|
| Target page cited (`target`) | The AI answer links to the page meant to answer this question. |
| Your other page (`other`) | The answer links to a different page of yours. |
| Not cited (`not_cited`) | An AI answer showed, but it links to none of your pages. |
| No AI answer (`no_answer`) | The engine showed no AI answer at all. |
| Failed (`failed`) | The search failed, so the question was not measured. A failure is never counted as "not cited". |

A row also stores: your best cited URL and its source position (1 means you are the number-one source), the other sites the answer cites, whether your brand is named in the answer text, and the question's segments (topic, keyword group, funnel stage, intent, page type).

A **question** means the same question, in the same market, on the same engine.

### All engines (owner option A)

Under "All engines" a question **counts once**: it is answered when any engine shows an AI answer, and **cited when any engine's answer cites your site** (the target page wins over another page of yours; your best source position counts; named when any answer names you; failed only when every engine failed). The engine filter shows each engine on its own. Each merged row is an `all` row whose `parts` name the engines' own rows (in `rows` too), so a drawer can show every engine's answer.

This is one setting, `ALL_ENGINES_COUNTING` in `src/shared/metrics/settings.ts`: `once` (the default) or `per_engine` (a question checked on Google and on ChatGPT counts once for each engine). The engine breakdown always counts per engine. The result says which rule it used (`counting`), lists the engines on offer (`offeredEngines`, whatever the filter) and every finished check in scope (`checks`).

### One meaning for each word

- **Cited** means an AI answer showed and **a page on your site is among its sources** (a reference classified as the target page or another page of yours). Summary, `reports:metrics`, the ready reports and the offline report all read it this way (`src/main/metrics/rows.ts` `resultOf`; the offline report's rows use the same function).
- **Reports count only finished checks.** A check still running is left out of every report number.
- **Speed to citation** uses the Fixes screen's buckets: 0–3, 4–7, 8–13 and 14+ days live.
- **The first check** (`from: 'first'`, the ready reports' default From) is every check that finished within six hours of the earliest one in scope, since pages and topics checked together finish a few minutes apart (`firstCheckAt`).
- **The 14-day rule:** in the ready reports a published page live under 14 days is "too new" and not judged (`VERDICT_WAIT_DAYS`).

## The request: scope × market × engine × window

- **Scope:** the whole project, one topic, or one tracked page.
- **Market:** one market, or each page's and topic's default market.
- **Engine:** All, or one of Google AI Overview, ChatGPT, Perplexity, AI Mode, Gemini, Copilot.
- **Window:**
  - **To:** the latest check, or a chosen check, day or time.
  - **From:** none (latest only), "previous" (each page and topic against its check before the latest), "first" (the first check in scope), or a chosen check, day or time.

How a question's state at a moment is read is the rule Summary already uses. A tracked page shows its newest check only, so a question dropped from the page drops out. A topic keeps each question's newest result across its checks, because topics check a few questions at a time.

## Numbers at one end ("now", "before", "after")

`now` counts every question at the To end. `before` and `after` count only questions measured at both ends, so the two are like for like.

| Metric | Definition | Used by |
|---|---|---|
| Checked | Every question at that end. | Summary "Questions tracked" (verdict `tracked`); report tile "Prompts tracked" |
| Measured | Questions whose search did not fail. | Report coverage line and headline |
| Failed | Questions whose search failed. | Report "failed" count |
| AI answer shown | Target, other or not cited: an answer appeared. | Summary KPI and verdict `aio`; report tile "AI Overview appears"; Impact review "Questions with an AI answer" |
| No AI answer | The engine showed no answer. | Impact review question chips |
| Cited | Target or other: an answer links to a page of yours. | Summary KPI and verdict `cited`; report tile "You are cited"; Impact review "Questions citing your pages" |
| Target page cited | The page meant for the question is cited. | Report tile "This page cited" |
| Your other page | A different page of yours is cited. | Report tile "Wrong page cited" |
| Not cited | An answer showed without any page of yours. | Questions screens |
| Named | Your brand is in the answer text (needs an answer). | Summary KPI and verdict `named`; report tile "Brand named" |
| Not visible | An answer showed that neither cites nor names you. | Summary verdict "The opportunity"; report tile "Not visible" |
| Number-one source | Cited, with your page as the first source. | Impact review "Number-one source" |
| Share of AI answers (rate) | Cited ÷ AI answer shown. Empty when no answers. | Impact review "Your share of AI answers"; Market vs your work |

## Before → after

| Metric | Definition | Used by |
|---|---|---|
| Compared | Questions measured at both ends. | Impact review "How we measured" |
| Gained | Not cited before, cited now. | Summary and report verdict, What changed, Impact review |
| Kept | Cited at both ends. | Same |
| Lost | Cited before, not cited now. | Same |
| Not cited (still) | Cited at neither end, with an answer now. | Impact review question chips; Summary "Still not cited" |
| No AI answer (still) | Cited at neither end, with no answer now. | Impact review question chips |
| Never | Not cited + no AI answer: cited at neither end. | Report What changed "Not cited" |
| New answers | No answer before, an answer now. | Impact review "Got an AI answer for the first time"; the market part |
| Gone answers | An answer before, none now. | The market part when answers vanish |
| Named before / named after | Named at each end, over compared questions. | Summary and report verdict "Named more/less often" |

Gained + kept + lost + not cited + no AI answer always equals compared.

### Left out, and why

A question missing at one end is not compared. It is counted in its own list so nothing disappears silently:

- **No before:** the question was checked at the To end only (for example, a new question).
- **No after:** the question was checked at the From end only (for example, a question removed from a page).
- **Failed:** the search failed at either end.

Used by: Impact review "How we measured", and the report's "not compared" count.

### Market vs your work

A question can only cite you if an AI answer shows at all. So a change in cited questions has two parts:

- **Market:** (AI answers after − AI answers before) × your share of answers before. This is what the change would have been if you had kept winning the same share of answers.
- **Your work:** the rest, which is the change in cited questions minus the market part.

Both parts are kept in tenths, and "your work" takes whatever the market part leaves. So the two always add up exactly to the change. With no answers before, your old share is unknown, so the market part is 0. The market part drills to the questions whose answer appeared or vanished. Your work drills to the questions gained or lost.

Used by: Impact review "Market vs your work" (phase 1). Later, the verdict badge can read "your work" instead of the net change.

## Breakdowns

| Metric | Definition | Used by |
|---|---|---|
| Segments | For each value of a lens (topic, keyword group, funnel stage, intent, page type): questions, AI answers and cited (now, before, after), share before and after, and **open**: an answer shows now but does not cite you. Questions with no value sit under "Not set", last. | Impact review "Topics" tab; segment switch (phase 4) |
| Sites (domains) | For each other site, the questions whose answer cites it (now, before, after), the change, and **with you**: cited in the same answer as you. You are a row too, counted as cited questions. | Impact review "Competitors"; Summary "Who gets cited" (phase 1) |
| Site movers | Sites whose count went up (most first) and down (most first). Unchanged sites are left out. | Impact review "Gained ground / Lost ground" |
| Engines | AI answers and cited per engine (now, before, after). | Engine comparison in reports (phase 3) |

## Your pages

Pages come from the changes ledger (every logged fix with a page address), plus every page of yours that an answer cites. A page is matched by its address, ignoring `https`, `www.` and a trailing slash. A logged **new page** is "new". A **rewrite** or a **fix** is "rewrite".

| Metric | Definition | Used by |
|---|---|---|
| Questions citing each page | Now, before and after, and the change. | Impact review "Pages" before/after |
| Days live | Whole days from go-live to the To end. | Impact review "Published pages" |
| Status | The Fixes screen's rule (`changeStatus`). **Lost ground** means at least 3 questions, and at least 30% of those that cited the page, stopped citing it. Otherwise **cited now** if any question cites it. Otherwise **too new** at 3 days live or fewer. Otherwise **not cited yet**. | Impact review "Published pages" chips |
| Page counts | Published, new pages, rewrites, cited now, not cited yet, too new, lost ground, not indexed. These drill to page addresses, not questions. | Impact review "Published pages" tiles; "Not indexed" tab |
| Page groups | Cited questions split by the kind of page cited: new, rewrite, any other page. The groups add up to all cited questions. | Impact review "Where your citations come from" |
| Speed to citation | Published pages grouped by days live, in the Fixes screen's buckets (0–3, 4–7, 8–13, 14+). Each bucket has its pages, how many are cited now, and the questions citing them. | Impact review "How fast new pages get cited"; Fixes "How fast changes get cited" |
| Index status | The page's last Google index check: indexed, not indexed, or unknown. | Impact review "Not indexed" |

## History per question

Each question's result at every check inside the window, oldest first. The window runs from the From row (or the From moment) to the To row. With no From end, every earlier check counts.

Used by: Impact review "What changed" history strip; question drawer "Sites cited each check".

## Every number drills

Every count is a `MetricCount { n, ids }` with `n === ids.length`. Row counts list row ids, and each id appears in the result's `rows`. Page counts list page addresses. Tests walk the whole result for several windows, engines and scopes, and check this for every count (`src/shared/metrics/compute.test.ts`).

## Settled in phase 1

- "Cited" means one thing everywhere (above). The offline report used to read the stored status; it now reads the sources like Summary.
- Summary still includes the answers of a check that is running, so it moves as a check goes; every report counts finished checks only.
- The Impact review mock-up had five day buckets; the reports use the Fixes screen's four, so the two screens agree.
- "All engines" counts each question once (owner option A, pending final confirmation): one setting switches it.
