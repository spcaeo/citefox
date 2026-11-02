import chartKitCss from '../../../shared/charts/charts.css?raw'
import { COPY_CSS } from './copy'

/**
 * The report charts' colours (src/shared/charts/charts.css draws with --cfc-*
 * names; the app maps the same names in ui/chart/report-charts.css). On :root, so
 * the dark button and print re-resolve them.
 */
export const REPORT_CHART_VARS = `:root {
  --cfc-font: var(--font);
  --cfc-ink: var(--ink);
  --cfc-ink-2: var(--ink-2);
  --cfc-ink-3: var(--faint);
  --cfc-line: var(--line);
  --cfc-track: var(--surface-2);
  --cfc-before: var(--line-strong);
  --cfc-hover: var(--hover);
  --cfc-focus: var(--accent);
  --cfc-target: var(--r-target);
  --cfc-target-ink: var(--r-target);
  --cfc-other: var(--r-other);
  --cfc-not-cited: var(--r-not-cited);
  --cfc-none: var(--decor);
  --cfc-muted: var(--decor);
  --cfc-bar-ink: var(--faint);
  --cfc-up: var(--good);
  --cfc-up-tint: var(--good-soft);
  --cfc-down: var(--r-not-cited);
  --cfc-down-tint: var(--r-not-cited-tint);
  --cfc-flat-tint: var(--surface-2);
  --cfc-on: var(--surface);
  --cfc-on-quiet: var(--surface);
}
.cfc-frame { margin: 8px 0 4px; min-width: 0; }
`

/**
 * The HTML report's stylesheet, in the app's v2 "Spruce & Fox" look
 * (Docs/TOPICS-SPEC.md §1, Mockups/v2/Theme.dc.html, the report preview in
 * Mockups/v2/preview/Topic-Report.png): a mineral ground, white cards with a
 * 1px line, ink text, Geist with tabular numbers, and one accent. The accent
 * is the project's brand colour (fox #C2410C by default) and means only "you":
 * your domain cited. Numbers that open prompts are ink with a dotted underline.
 *
 * Chart tones keep their class names (`t-blue` …) so the section templates and
 * the PDF stay in step; their v2 meaning:
 *   blue   → you / cited         (accent)
 *   orange → a rival / not cited (slate #8299B6)
 *   aqua   → series 2            (spruce #1F5E58)
 *   violet → series 3            (sand #D9B46A)
 *   gray   → someone else / neutral
 *   red    → negative            (danger)
 *   none   → no AI Overview / nothing cited (#DCE2E0, hatched on swatches)
 *
 * No fonts are embedded and nothing loads from the network (the page's CSP):
 * Geist is used when installed, else the system UI font.
 *
 * The report is light by default (it is printed and sent to clients); the Dark
 * button in the top bar sets <html data-theme="dark">. Print is always light.
 */
export function reportCss(accent: string): string {
  return `:root {
  color-scheme: light;
  --accent: ${accent};
  --accent-ink: color-mix(in srgb, var(--accent) 80%, #000);
  --accent-soft: color-mix(in srgb, var(--accent) 9%, #fff);
  --accent-line: color-mix(in srgb, var(--accent) 32%, #fff);
  --bg: #eef1f0;
  --surface: #ffffff;
  --surface-2: #f5f7f6;
  --ink: #15201e;
  --ink-2: #394643;
  --muted: #394643;
  --faint: #586461;
  --decor: #8c9693;
  --line: #dde2e0;
  --line-strong: #c7cec8;
  --track: #e4e9e7;
  --hover: rgba(21, 43, 41, 0.05);
  --spruce: #152829;
  --c-blue: var(--accent);
  --c-orange: #8299b6;
  --c-aqua: #1f5e58;
  --c-violet: #d9b46a;
  --c-gray: #a9b3b0;
  --c-red: #b42318;
  --c-none: #dce2e0;
  --hatch: repeating-linear-gradient(135deg, #dce2e0 0 3px, #f5f7f6 3px 6px);
  --band: #cfe3de;
  --good: #1b7046;
  --good-soft: #e3f1e9;
  --warn: #835400;
  --warn-soft: #faf0d3;
  --bad: #b42318;
  --bad-soft: #fce9e7;
  --info: #22539f;
  --info-soft: #e6edf8;
  /* Result colours, the app's (renderer styles/tokens.css "result"). */
  --r-target: #1b7046;
  --r-target-tint: #e3f1e9;
  --r-other: #22539f;
  --r-other-tint: #e6edf8;
  --r-not-cited: #9a3412;
  --r-not-cited-tint: #fcefe7;
  --r-none: #586461;
  --shadow: 0 1px 2px rgba(21, 43, 41, 0.06);
  --shadow-drawer: 0 24px 64px rgba(21, 43, 41, 0.24);
  --scrim: rgba(21, 43, 41, 0.32);
  --radius-s: 6px;
  --radius: 10px;
  --radius-l: 14px;
  --header: 56px;
  --font: "Geist", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif;
  --mono: "Geist Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --accent-ink: color-mix(in srgb, var(--accent) 55%, #fff);
  --accent-soft: color-mix(in srgb, var(--accent) 18%, #152829);
  --accent-line: color-mix(in srgb, var(--accent) 45%, #152829);
  --bg: #0e1b1b;
  --surface: #152829;
  --surface-2: #1a3131;
  --ink: #e6eeec;
  --ink-2: #c3d1ce;
  --muted: #c3d1ce;
  --faint: #a6bab6;
  --decor: #6f8682;
  --line: #29403f;
  --line-strong: #36504e;
  --track: #223a39;
  --hover: rgba(230, 238, 236, 0.06);
  --c-orange: #8fa6c2;
  --c-aqua: #3f9a8f;
  --c-violet: #d9b46a;
  --c-gray: #6f8682;
  --c-red: #e5675c;
  --c-none: #36504e;
  --hatch: repeating-linear-gradient(135deg, #36504e 0 3px, #1a3131 3px 6px);
  --band: #2c5a50;
  --good: #7fd1a3;
  --good-soft: #1d3d30;
  --warn: #e9c46a;
  --warn-soft: #3d3420;
  --bad: #f19a90;
  --bad-soft: #432523;
  --info: #9dbcf0;
  --info-soft: #1f3150;
  --r-target: #6fcf97;
  --r-target-tint: #15301f;
  --r-other: #8db4f0;
  --r-other-tint: #16243a;
  --r-not-cited: #f0915f;
  --r-not-cited-tint: #3a2317;
  --r-none: #93a3a0;
  --shadow: none;
  --shadow-drawer: 0 24px 64px rgba(0, 0, 0, 0.5);
  --scrim: rgba(0, 0, 0, 0.5);
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; scroll-padding-top: calc(var(--header) + 16px); scroll-behavior: smooth; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 14px/20px var(--font);
  font-variant-numeric: tabular-nums;
  -webkit-font-smoothing: antialiased;
}
a { color: var(--ink); text-decoration-color: var(--line-strong); text-underline-offset: 3px; overflow-wrap: anywhere; }
a:hover { color: var(--accent-ink); text-decoration-color: currentColor; }
h1, h2, h3, p { margin: 0; }
button { font: inherit; color: inherit; }
code, .code, .fingerprint { font-family: var(--mono); font-size: 12px; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
.sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
html:not(.js) .needs-js { display: none !important; }
.skip { position: absolute; left: 12px; top: -48px; z-index: 50; background: var(--surface); padding: 8px 12px; border-radius: var(--radius-s); border: 1px solid var(--line); }
.skip:focus { top: 10px; }

/* Header */
.topbar {
  position: sticky; top: 0; z-index: 20; height: var(--header);
  display: flex; align-items: center; gap: 16px; padding: 0 24px;
  background: color-mix(in srgb, var(--surface) 94%, transparent);
  backdrop-filter: saturate(1.4) blur(8px);
  border-bottom: 1px solid var(--line);
}
.brand { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 0 1 auto; }
.brand-mark { width: 24px; height: 24px; flex: none; border-radius: var(--radius-s); background: var(--accent); display: grid; place-items: center; }
.brand-mark svg { width: 16px; height: 16px; fill: none; stroke: #fff; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.brand-text { min-width: 0; line-height: 16px; }
.brand-domain { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
.brand-scope { color: var(--faint); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; max-width: 34ch; }
.search { flex: 1 1 320px; max-width: 420px; margin-left: auto; position: relative; }
.search input {
  width: 100%; height: 36px; padding: 0 12px 0 36px; font: inherit; color: var(--ink);
  background: var(--surface); border: 1px solid var(--line-strong); border-radius: var(--radius-s);
}
.search input::placeholder { color: var(--faint); }
.search input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.search svg { position: absolute; left: 11px; top: 10px; width: 16px; height: 16px; stroke: var(--faint); fill: none; stroke-width: 2; }
.search-status { position: absolute; top: 40px; left: 0; font-size: 12px; color: var(--muted); background: var(--surface); padding: 2px 8px; border-radius: var(--radius-s); box-shadow: var(--shadow); }
.search-status:empty { display: none; }
.actions-bar { display: flex; gap: 8px; flex: none; }
.btn {
  display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 14px;
  border: 1px solid var(--line-strong); border-radius: var(--radius-s); background: var(--surface);
  font-weight: 500; font-size: 13px; cursor: pointer; color: var(--ink);
}
.btn:hover { background: var(--surface-2); }
.btn svg { width: 16px; height: 16px; stroke: currentColor; fill: none; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
.btn[aria-pressed="true"] { background: var(--surface-2); border-color: var(--ink-2); }

/* Layout */
.layout { display: grid; grid-template-columns: 232px minmax(0, 1fr); max-width: 1440px; margin: 0 auto; }
.nav {
  position: sticky; top: var(--header); align-self: start; height: calc(100vh - var(--header));
  overflow-y: auto; padding: 24px 12px 32px 16px; border-right: 1px solid var(--line);
}
.nav-title { font-size: 12px; line-height: 16px; font-weight: 500; color: var(--faint); padding: 0 10px 8px; }
.nav ol { list-style: none; margin: 0; padding: 0; }
.nav a { display: block; text-decoration: none; color: var(--muted); border-radius: var(--radius-s); }
.nav a[data-level="1"] { padding: 6px 10px; font-weight: 500; color: var(--ink); margin-top: 2px; }
.nav a[data-level="2"] { padding: 4px 10px 4px 22px; font-size: 13px; line-height: 16px; color: var(--faint); }
.nav a:hover { background: var(--hover); color: var(--ink); }
.nav a.active[data-level="1"] { background: var(--surface); color: var(--ink); font-weight: 600; box-shadow: var(--shadow), inset 0 0 0 1px var(--line); }
.nav a.active[data-level="2"] { color: var(--ink); font-weight: 500; box-shadow: inset 2px 0 0 var(--accent); }
.focus-mode .layout { grid-template-columns: minmax(0, 1fr); }
.focus-mode .nav { display: none; }
main { min-width: 0; padding: 32px 32px 56px; max-width: 1180px; width: 100%; margin: 0 auto; }

/* Sections */
.report-section { padding: 40px 0 16px; border-top: 1px solid var(--line); }
.report-section.cover { border-top: 0; padding-top: 0; }
.sec-head { margin-bottom: 24px; }
.sec-head h2 { font-size: 22px; line-height: 28px; letter-spacing: -0.015em; font-weight: 600; }
.lede { color: var(--faint); max-width: 72ch; margin-top: 4px; }
.lede-strong { font-size: 16px; line-height: 24px; color: var(--ink-2); margin-bottom: 16px; }
h3.sub { font-size: 16px; line-height: 24px; font-weight: 600; margin-top: 32px; letter-spacing: -0.005em; }
h3.sub + .lede { margin-bottom: 12px; font-size: 13px; line-height: 18px; }
.eyebrow { font-size: 12px; line-height: 16px; font-weight: 500; color: var(--faint); }
.cover h1 { font-size: 32px; line-height: 40px; letter-spacing: -0.02em; font-weight: 600; margin-top: 8px; max-width: 30ch; }
.cover-scope { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 16px; }
.scope-chip { display: inline-flex; padding: 2px 10px; border-radius: 999px; background: var(--surface); border: 1px solid var(--line); color: var(--ink-2); font-weight: 500; font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
.cover-project { color: var(--faint); font-weight: 500; }
.cover-url { margin-top: 8px; font-size: 12px; font-family: var(--mono); }
.facts { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); margin: 24px 0 0; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; box-shadow: var(--shadow); }
.fact { padding: 16px; min-width: 0; box-shadow: 1px 0 0 var(--line), 0 1px 0 var(--line); }
.fact dt { font-size: 12px; line-height: 16px; font-weight: 500; color: var(--faint); }
.fact dd { margin: 4px 0 0; overflow-wrap: anywhere; }
.facts-wide { grid-template-columns: minmax(0, 1fr); margin: 0; }
.facts-wide .fact { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 12px; }
.fact-span { grid-column: span 2; }
.tpl code { margin-left: 4px; color: var(--faint); }
.market { display: inline-block; margin-right: 8px; white-space: nowrap; }
.tpl { display: block; font-size: 13px; }
.cover-note { margin-top: 16px; }

/* Headline and KPI tiles */
.headline { font-size: 16px; line-height: 24px; max-width: 70ch; font-weight: 400; color: var(--ink); margin-bottom: 24px; }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; margin: 4px 0 8px; }
.kpi { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px 20px; box-shadow: var(--shadow); position: relative; overflow: hidden; min-width: 0; }
.kpi::before { content: none; }
.kpi-good::before, .kpi-warn::before, .kpi-accent::before { content: none; }
.kpi-label { font-size: 13px; line-height: 16px; font-weight: 500; color: var(--ink-2); }
.kpi-value { font-size: 32px; line-height: 40px; font-weight: 600; letter-spacing: -0.02em; margin-top: 8px; overflow-wrap: anywhere; }
.kpi-value .drill { font-size: inherit; font-weight: inherit; padding: 0 2px; margin-left: -2px; text-underline-offset: 6px; }
.kpi-unit { font-size: 14px; font-weight: 500; color: var(--faint); margin-left: 4px; letter-spacing: 0; }
.kpi-sub { font-size: 12px; line-height: 16px; color: var(--faint); margin-top: 4px; overflow-wrap: anywhere; }
.kpi-strip { display: flex; flex-wrap: wrap; gap: 8px 24px; color: var(--muted); font-size: 13px; margin-top: 12px; }
.kpi-strip span { display: inline-flex; align-items: center; gap: 6px; }

/* Goal bar (cited share against a target band), for topic sections */
.goal { margin: 16px 0 8px; }
.goal-track { position: relative; height: 8px; border-radius: 999px; background: var(--track); overflow: hidden; }
.goal-band { position: absolute; top: 0; bottom: 0; background: var(--band); }
.goal-fill { position: absolute; top: 0; bottom: 0; left: 0; border-radius: 999px; background: var(--accent); }
.goal-ticks { position: relative; height: 16px; margin-top: 6px; font-size: 12px; line-height: 16px; color: var(--faint); }
.goal-ticks span { position: absolute; transform: translateX(-50%); }
.goal-ticks span:first-child { transform: none; }
.goal-ticks span:last-child { transform: translateX(-100%); }
.goal-ticks .goal-now { color: var(--accent-ink); font-weight: 600; }

/* Drill buttons: every number opens the prompts behind it (dotted underline) */
.drill {
  display: inline-block; min-width: 1.4em; padding: 0 3px; border: 0; border-radius: 4px;
  background: transparent; color: inherit; font-weight: 600; cursor: pointer;
  text-decoration: underline dotted var(--decor); text-decoration-thickness: 1.5px; text-underline-offset: 4px;
  font-variant-numeric: tabular-nums; line-height: inherit;
}
.drill:hover { background: var(--accent-soft); color: var(--accent-ink); text-decoration-color: currentColor; }
html:not(.js) .drill { cursor: default; text-decoration: none; color: inherit; }
.num { font-weight: 600; }
.link-btn { border: 0; background: none; padding: 0; color: var(--ink-2); text-decoration: underline; text-decoration-color: var(--line-strong); text-underline-offset: 3px; cursor: pointer; font-size: 12px; font-weight: 500; white-space: nowrap; }
.link-btn:hover { color: var(--accent-ink); text-decoration-color: currentColor; }
html:not(.js) .link-btn { display: none; }

/* Cards and charts */
.card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 24px; box-shadow: var(--shadow); min-width: 0; }
.grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
.chart-title { font-weight: 600; font-size: 14px; line-height: 20px; margin-bottom: 12px; }
.card .chart-title + .legend { margin-top: -4px; }
.note { color: var(--faint); font-size: 12px; line-height: 16px; margin-top: 12px; max-width: 80ch; }
.note.callout { background: var(--surface); border: 1px solid var(--line); border-left: 3px solid var(--accent); color: var(--ink); border-radius: var(--radius-s); padding: 12px 16px; margin: 0 0 16px; font-size: 13px; line-height: 18px; max-width: none; }
.note.coverage { margin-top: 24px; font-size: 12px; }
.tbl-empty { color: var(--faint); font-size: 13px; padding: 6px 0; }
.bars { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.bar-row { display: grid; grid-template-columns: minmax(120px, 34%) minmax(80px, 1fr) minmax(92px, auto); gap: 16px; align-items: center; cursor: pointer; border-radius: var(--radius-s); }
html:not(.js) .bar-row, html:not(.js) .opp-row { cursor: default; }
.opp-row { cursor: pointer; }
.opp-row:hover th, .opp-row:hover td { background: var(--surface-2); }
.bar-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.bar-track { display: block; min-width: 0; }
.bar-svg { display: block; overflow: visible; }
.bar-svg .track { fill: var(--track); }
/* Topic goal bars (sections/topic-coverage.ts): v2 goal band and a fox "cited" fill. */
.bar-svg[aria-label*="goal"] rect[opacity] { fill: var(--band); opacity: 1; }
.bar-svg[aria-label*="goal"] .t-orange { fill: var(--accent); y: 0; height: 14px; rx: 3px; }
/* Topic section (Topic-Report.png): summary card with a numbered "Next 3 actions" list, goal tiles. */
[data-section="topic_coverage"] .card > p:first-child { font-size: 14px; line-height: 22px; max-width: 76ch; }
[data-section="topic_coverage"] .card .chart-title { margin-bottom: 8px; }
[data-section="topic_coverage"] .card > p + .chart-title { margin-top: 20px; }
[data-section="topic_coverage"] .card .actions { display: block; background: none; border: 0; border-radius: 0; box-shadow: none; overflow: visible; counter-reset: tc-action; }
[data-section="topic_coverage"] .card .actions li { display: block; position: relative; padding: 4px 0 4px 24px; border-top: 0; counter-increment: tc-action; }
[data-section="topic_coverage"] .card .actions li::before { content: counter(tc-action) "."; position: absolute; left: 0; top: 4px; color: var(--faint); font-weight: 500; }
[data-section="topic_coverage"] .actions .chip { margin-left: 6px; background: var(--warn-soft); color: var(--warn); }
[data-section="topic_coverage"] .grid-2 .card .kpi-value { margin-top: 0; }
[data-section="topic_coverage"] .grid-2 .card .bar-svg { margin: 12px 0 10px; }
[data-section="topic_coverage"] .grid-2 .card .kpi-sub + .kpi-sub { margin-top: 6px; }
[data-section="topic_coverage"] > .lede + .sub, [data-section="topic_coverage"] .sec-head + .lede { margin-bottom: 4px; }
.bar-value { display: inline-flex; align-items: baseline; gap: 6px; justify-content: flex-end; white-space: nowrap; }
.bar-meta { color: var(--faint); font-size: 12px; }
.seg { stroke: var(--surface); stroke-width: 2; }
.t-blue { fill: var(--c-blue); background: var(--c-blue); }
.t-orange { fill: var(--c-orange); background: var(--c-orange); }
.t-aqua { fill: var(--c-aqua); background: var(--c-aqua); }
.t-violet { fill: var(--c-violet); background: var(--c-violet); }
.t-gray { fill: var(--c-gray); background: var(--c-gray); }
.t-red { fill: var(--c-red); background: var(--c-red); }
.t-none { fill: var(--c-none); background: var(--c-none); }
.swatch.t-none { background: var(--hatch); }
.legend { list-style: none; display: flex; flex-wrap: wrap; gap: 6px 16px; padding: 0; margin: 0 0 12px; font-size: 12px; line-height: 16px; color: var(--muted); }
.legend li { display: inline-flex; align-items: center; gap: 6px; }
.swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; flex: none; }
.funnel { list-style: none; margin: 0; padding: 0; }
.funnel-row { display: grid; grid-template-columns: minmax(130px, 26%) minmax(80px, 1fr) 96px; gap: 16px; align-items: center; }
.funnel-label { font-weight: 500; font-size: 13px; }
.funnel-value { display: inline-flex; gap: 6px; align-items: baseline; justify-content: flex-end; font-size: 16px; }
.funnel-drop { font-size: 12px; color: var(--faint); margin: 4px 0 4px calc(min(26%, 999px) + 16px); padding-left: 10px; border-left: 2px solid var(--line); }
.drop-n { color: var(--warn); font-weight: 600; margin-right: 4px; }
.opp { width: 100%; border-collapse: collapse; font-size: 13px; }
.opp th, .opp td { height: 44px; padding: 0 12px; text-align: left; border-bottom: 1px solid var(--line); }
.opp thead th { height: 40px; font-size: 12px; font-weight: 500; color: var(--faint); }
.opp tbody tr:last-child th, .opp tbody tr:last-child td { border-bottom: 0; }
.opp .num, .opp th.num { text-align: right; }
.opp-bar { width: 38%; min-width: 120px; }
.opp-label { font-weight: 500; white-space: nowrap; }
.opp-total { color: var(--muted); }
.sov .bar-svg { margin-bottom: 16px; }
.sov-legend { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 8px 24px; }
.sov-legend li { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; }
.sov-label { color: var(--muted); }
.chart-figure { margin: 0; }
.line-chart { display: block; width: 100%; height: auto; overflow: visible; }
.line-chart .grid { stroke: var(--line); stroke-width: 1; }
.line-chart .axis { stroke: var(--line-strong); stroke-width: 1; }
.axis-label { fill: var(--faint); font-size: 11px; }
.line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.s-blue { stroke: var(--c-blue); }
.s-orange { stroke: var(--c-orange); }
.s-aqua { stroke: var(--c-aqua); }
.s-violet { stroke: var(--c-violet); }
.s-gray { stroke: var(--c-gray); }
.s-red { stroke: var(--c-red); }
.line.s-gray { stroke-dasharray: 4 4; }
.dot { stroke: var(--surface); stroke-width: 2; }
.dot.hollow { fill: var(--surface); stroke-width: 2; }
.dot.hollow.s-blue { stroke: var(--c-blue); }
.dot.hollow.s-orange { stroke: var(--c-orange); }
.dot.hollow.s-aqua { stroke: var(--c-aqua); }
.dot.hollow.s-violet { stroke: var(--c-violet); }
.dot.hollow.s-gray { stroke: var(--c-gray); }
.fix line { stroke: var(--ink); stroke-width: 1; stroke-dasharray: 3 3; opacity: 0.5; }
.fix-label { fill: var(--ink-2); font-size: 11px; font-weight: 600; }
figcaption { margin-top: 12px; }
figcaption .legend { margin: 0; }
.donut-wrap { display: flex; align-items: center; gap: 24px; flex-wrap: wrap; }
.donut { width: 144px; height: 144px; flex: none; }
.donut-track { fill: none; stroke: var(--track); stroke-width: 14; }
.arc { fill: none; stroke-width: 14; }
.donut-n { font-size: 22px; font-weight: 600; fill: var(--ink); }
.donut-sub { font-size: 10px; fill: var(--faint); letter-spacing: 0.04em; }
.donut-wrap .sov-legend { flex-direction: column; gap: 8px; }
.authority, .rate { display: inline-grid; grid-template-columns: 2.6em 72px; gap: 8px; align-items: center; }
.authority-n, .rate-n { text-align: right; font-weight: 600; }

/* Tables: the list grid look (40px header, 44px rows) */
.tbl-block { margin-top: 8px; }
.tbl-block + .tbl-block { margin-top: 24px; }
.tbl-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.tbl-title { font-weight: 600; font-size: 14px; margin-right: auto; }
.tbl-count { display: inline-block; min-width: 22px; padding: 0 7px; margin-left: 4px; border-radius: 999px; background: var(--track); color: var(--ink-2); font-size: 12px; line-height: 18px; font-weight: 500; text-align: center; }
.tbl-filter input { height: 32px; width: 240px; max-width: 100%; padding: 0 10px; border: 1px solid var(--line-strong); border-radius: var(--radius-s); font: inherit; font-size: 13px; background: var(--surface); color: var(--ink); }
.tbl-filter input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
html:not(.js) .tbl-filter, html:not(.js) .csv-btn { display: none; }
.csv-btn { height: 32px; padding: 0 12px; border: 1px solid var(--line-strong); border-radius: var(--radius-s); background: var(--surface); font-size: 12px; font-weight: 500; cursor: pointer; color: var(--ink); }
.csv-btn:hover { background: var(--surface-2); }
.scroll { overflow-x: auto; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); box-shadow: var(--shadow); }
.scroll.plain { border: 0; box-shadow: none; background: transparent; }
.scroll table:not(.opp) { width: 100%; border-collapse: collapse; font-size: 13px; line-height: 18px; }
.scroll table:not(.opp) th { height: 40px; text-align: left; font-size: 12px; line-height: 16px; font-weight: 500; color: var(--faint); background: var(--surface-2); padding: 0 16px; border-bottom: 1px solid var(--line); white-space: nowrap; }
.scroll table:not(.opp) td { height: 44px; padding: 10px 16px; border-bottom: 1px solid var(--line); vertical-align: middle; }
.scroll table:not(.opp) tbody tr:last-child td { border-bottom: 0; }
.scroll table:not(.opp) th.num { text-align: right; }
.scroll table:not(.opp) th.center { text-align: center; }
th.path { font-family: var(--font); font-size: 12px; }
.scroll table:not(.opp) tbody tr:hover td { background: var(--surface-2); }
th.num, td.num { text-align: right; white-space: nowrap; }
th.center, td.center { text-align: center; }
td.nowrap, th.nowrap { white-space: nowrap; }
td.wide { min-width: 200px; max-width: 480px; overflow-wrap: anywhere; }
td.path { min-width: 220px; }
.tbl-title.quiet { font-weight: 400; color: var(--faint); font-size: 12px; }
.sort { border: 0; background: none; padding: 0; font: inherit; font-weight: 500; color: inherit; cursor: pointer; display: inline-flex; gap: 4px; align-items: center; }
.sort:hover { color: var(--ink); }
.sort-mark::after { content: "↕"; opacity: 0.45; font-size: 11px; }
[aria-sort="ascending"] .sort-mark::after { content: "↑"; opacity: 1; }
[aria-sort="descending"] .sort-mark::after { content: "↓"; opacity: 1; }
[aria-sort="ascending"] .sort, [aria-sort="descending"] .sort { color: var(--ink); }
html:not(.js) .sort-mark { display: none; }
.js .collapsed:not(.filtering) tr.extra { display: none; }
tr[hidden] { display: none; }
.showing { display: none; font-size: 12px; color: var(--faint); margin-top: 8px; }
.js .collapsible .showing { display: block; }
.show-all { border: 0; background: none; padding: 0; color: var(--accent-ink); font-weight: 500; cursor: pointer; text-decoration: none; }
.show-all:hover { text-decoration: underline; }
.path { font-family: var(--mono); font-size: 12px; overflow-wrap: anywhere; }
.url { display: block; font-family: var(--mono); font-size: 12px; color: var(--faint); overflow-wrap: anywhere; }
.domain { font-weight: 500; }
.muted { color: var(--faint); }
.dash { color: var(--decor); }
.yes { color: var(--good); font-weight: 600; }
.no { color: var(--faint); }
.tag { display: inline-block; padding: 1px 8px; border-radius: var(--radius-s); background: var(--track); color: var(--ink-2); font-size: 12px; line-height: 18px; font-weight: 500; white-space: nowrap; }
.tag-warn { background: var(--warn-soft); color: var(--warn); }
.chip { display: inline-block; padding: 1px 9px; border-radius: 999px; font-size: 12px; line-height: 18px; font-weight: 500; white-space: nowrap; }
/* The app's result colours: target page green, your other page blue, not cited orange, no AI Overview grey. */
.s-target { background: var(--r-target-tint); color: var(--r-target); }
.s-own { background: var(--r-other-tint); color: var(--r-other); }
.s-mention { background: var(--warn-soft); color: var(--warn); }
.s-none { background: var(--r-not-cited-tint); color: var(--r-not-cited); }
.s-noaio { background: transparent; color: var(--r-none); }
.s-error { background: var(--bad-soft); color: var(--bad); }
.who { display: inline-block; padding: 0 8px; border-radius: 999px; font-size: 12px; line-height: 18px; font-weight: 500; background: var(--track); color: var(--ink-2); }
.who-you { background: var(--accent-soft); color: var(--accent-ink); }
.who-competitor { background: var(--info-soft); color: var(--info); }
.tone, .verdict, .cov, .reply { display: inline-block; padding: 1px 9px; border-radius: 999px; font-size: 12px; line-height: 18px; font-weight: 500; white-space: nowrap; background: var(--track); color: var(--ink-2); }
.tone-positive, .v-worked, .cov-strong, .reply-open { background: var(--good-soft); color: var(--good); }
.tone-negative, .cov-weak, .cov-none { background: var(--bad-soft); color: var(--bad); }
.v-partly, .cov-partial { background: var(--warn-soft); color: var(--warn); }

/* Lists */
.actions { list-style: none; padding: 0; margin: 0; display: grid; gap: 0; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; }
.actions li { display: flex; gap: 12px; align-items: flex-start; padding: 12px 16px; border-top: 1px solid var(--line); }
.actions li:first-child { border-top: 0; }
.action-rank { flex: none; width: 24px; height: 24px; border-radius: var(--radius-s); background: var(--surface-2); border: 1px solid var(--line); color: var(--ink-2); display: grid; place-items: center; font-weight: 600; font-size: 12px; }
.action-text { font-weight: 600; }
.action-reason { color: var(--faint); font-size: 13px; }
.delta-card { padding: 16px 20px; }
.delta-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.delta-head .drill { font-size: 18px; }
.deltas { list-style: none; margin: 0; padding: 0; }
.deltas li { padding: 10px 0; border-top: 1px solid var(--line); }
.delta-prompt { font-size: 13px; }
.delta-meta { font-size: 12px; color: var(--faint); margin-top: 2px; }
.delta-move { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 4px; font-size: 12px; }
.before { color: var(--faint); text-decoration: line-through; text-decoration-color: var(--line-strong); }
.after { font-weight: 600; }
.arrow { color: var(--faint); }
.journeys { list-style: none; padding: 0; margin: 0; display: grid; gap: 0; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; }
.journey { padding: 12px 16px; border-top: 1px solid var(--line); display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; justify-content: space-between; }
.journey:first-child { border-top: 0; }
.journey-steps { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.step { display: inline-flex; gap: 6px; align-items: center; padding: 2px 10px; border-radius: var(--radius-s); background: var(--surface-2); border: 1px solid var(--line); font-size: 12px; }
.step .code, .shape-legend .code, .bar-label .code { color: var(--c-aqua); font-weight: 600; }
.journey-count { color: var(--faint); font-size: 13px; white-space: nowrap; }
.shape-legend { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
.legend-group { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px; box-shadow: var(--shadow); }
.legend-title { font-weight: 600; font-size: 13px; margin-bottom: 6px; }
.legend-group ul { list-style: none; margin: 0; padding: 0; font-size: 13px; color: var(--muted); display: grid; gap: 2px; }
.summary-line { font-size: 16px; line-height: 24px; font-weight: 600; margin: 4px 0 12px; }
.mismatches { margin: 12px 0 0; padding: 10px 16px 10px 32px; background: var(--warn-soft); color: var(--warn); border-radius: var(--radius-s); font-size: 13px; }
.obo-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 16px; }
.obo { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 20px 24px; box-shadow: var(--shadow); }
.obo-title { font-weight: 600; display: flex; gap: 10px; }
.obo-n { flex: none; width: 24px; height: 24px; border-radius: var(--radius-s); background: var(--surface-2); border: 1px solid var(--line); display: grid; place-items: center; font-size: 12px; }
.obo-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin: 12px 0 0; }
.obo-grid dt { font-size: 12px; line-height: 16px; font-weight: 500; color: var(--faint); }
.obo-grid dd { margin: 2px 0 0; font-size: 13px; }
.faq { margin-top: 12px; border: 1px solid var(--line); background: var(--surface-2); padding: 12px 16px; border-radius: var(--radius-s); }
.faq-label { font-size: 12px; line-height: 16px; font-weight: 500; color: var(--faint); }
.faq-q { font-weight: 600; margin-top: 4px; }
.faq-a { margin-top: 4px; font-size: 13px; }
.obo-faq-none { margin-top: 10px; font-size: 13px; color: var(--faint); }
.findings { list-style: none; padding: 0; margin: 0; display: grid; gap: 0; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; }
.findings li { padding: 12px 16px; border-top: 1px solid var(--line); }
.findings li:first-child { border-top: 0; }
.finding-summary { margin-top: 6px; font-weight: 600; }
.finding-detail { color: var(--faint); font-size: 13px; }
.empty-state { display: flex; gap: 12px; align-items: flex-start; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 24px; box-shadow: var(--shadow); }
.empty-icon { width: 20px; height: 20px; flex: none; fill: none; stroke: var(--faint); stroke-width: 1.75; stroke-linecap: round; margin-top: 2px; }
.empty-title { font-weight: 600; font-size: 14px; }
.empty-message { color: var(--faint); margin-top: 2px; }
.empty-next { margin-top: 8px; font-size: 13px; }

/* Drawer: the side panel (scrim, 14px left corners, one close) */
.scrim { position: fixed; inset: 0; background: var(--scrim); z-index: 40; }
.drawer {
  position: fixed; top: 0; right: 0; bottom: 0; z-index: 41; width: min(1040px, 100%); max-width: 100%; overflow: hidden;
  background: var(--surface); box-shadow: var(--shadow-drawer); border-radius: var(--radius-l) 0 0 var(--radius-l);
  display: flex; flex-direction: column; animation: slide-in 180ms ease-out;
}
.scrim[hidden], .drawer[hidden] { display: none; }
@keyframes slide-in { from { transform: translateX(32px); } to { transform: none; } }
.drawer-head { display: flex; gap: 12px; align-items: flex-start; padding: 24px 24px 16px; border-bottom: 1px solid var(--line); }
.drawer-head h2 { font-size: 22px; line-height: 28px; font-weight: 600; letter-spacing: -0.015em; overflow-wrap: anywhere; }
.drawer-sub { color: var(--faint); font-size: 12px; line-height: 16px; margin-top: 4px; }
.drawer-tools { margin-left: auto; display: flex; gap: 8px; flex: none; }
.drawer-body { overflow-y: auto; overflow-x: hidden; padding: 16px 24px 32px; flex: 1; min-width: 0; }
.drawer-head { min-width: 0; }
.drawer-head > div:first-child { min-width: 0; }
.drawer-body .scroll { max-width: 100%; overflow-x: auto; }
.dstats { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
.dstat { padding: 12px 16px; display: flex; flex-direction: column; min-width: 0; background: var(--surface-2); border-radius: var(--radius); }
.dstat-k { font-size: 12px; line-height: 16px; color: var(--faint); font-weight: 500; }
.dstat-v { font-size: 22px; line-height: 28px; font-weight: 600; margin-top: 4px; }
.dstat-s { font-size: 12px; color: var(--faint); }
.drawer-table .prompt-text { display: block; margin-bottom: 4px; }
.excerpt { margin-top: 6px; font-size: 12px; color: var(--muted); }
.excerpt summary { cursor: pointer; color: var(--ink-2); font-weight: 500; }
.excerpt p { margin-top: 4px; }
.excerpt-domains { color: var(--faint); }
.drawer-empty { color: var(--faint); }
body.drawer-open { overflow: hidden; }

.foot { border-top: 1px solid var(--line); margin-top: 32px; padding: 16px 0 8px; color: var(--faint); font-size: 12px; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; }
.foot strong { color: var(--ink); font-weight: 600; }

@media (max-width: 1080px) {
  .layout { grid-template-columns: minmax(0, 1fr); }
  .nav { display: none; }
  main { padding: 24px 24px 48px; }
}
@media (max-width: 640px) {
  :root { --header: 104px; }
  .topbar { flex-wrap: wrap; height: auto; padding: 10px 16px; gap: 8px 10px; }
  .brand { flex: 1 1 auto; }
  .search { order: 3; flex: 1 1 100%; max-width: none; margin-left: 0; }
  .btn { height: 32px; padding: 0 10px; }
  .btn .btn-text { display: none; }
  main { padding: 20px 16px 40px; }
  .cover h1 { font-size: 24px; line-height: 32px; }
  .headline { font-size: 15px; }
  .sec-head h2 { font-size: 20px; line-height: 26px; }
  .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .kpi { padding: 12px 14px; }
  .kpi-value { font-size: 24px; line-height: 32px; }
  .bar-row { grid-template-columns: minmax(0, 1fr) auto; }
  .bar-row .bar-track { grid-column: 1 / -1; grid-row: 2; }
  .funnel-row { grid-template-columns: minmax(0, 1fr) auto; }
  .funnel-row .bar-track { grid-column: 1 / -1; grid-row: 2; }
  .funnel-drop { margin-left: 0; }
  .opp-bar { min-width: 90px; }
  .card { padding: 16px; }
  .facts-wide .fact { grid-template-columns: minmax(0, 1fr); gap: 2px; }
  .dstats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .drawer { border-radius: 0; }
  .drawer-head { padding: 16px 16px 12px; }
  .drawer-body { padding: 12px 16px 24px; }
  .grid-2 { grid-template-columns: minmax(0, 1fr); }
  td.wide { min-width: 220px; }
}
@media (max-width: 480px) {
  .fact-span { grid-column: auto; }
}
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
@media print {
  :root, :root[data-theme="dark"] { color-scheme: light; --bg: #fff; --surface: #fff; --surface-2: #f5f7f6; --ink: #000; --ink-2: #222; --muted: #333; --faint: #555; --line: #ccc; --line-strong: #bbb; --shadow: none; }
  body { background: #fff; font-size: 11pt; }
  .topbar, .nav, .drawer, .scrim, .skip, .csv-btn, .tbl-filter, .showing, .link-btn, .needs-js, .sort-mark { display: none !important; }
  .layout { display: block; }
  main { padding: 0; max-width: none; }
  tr.extra, .js .collapsed tr.extra, tr[hidden] { display: table-row !important; }
  .drill { color: inherit; text-decoration: none; padding: 0; }
  .scroll { overflow: visible; border-color: #ccc; }
  .report-section { break-before: auto; padding-top: 18px; }
  h2, h3 { break-after: avoid; }
  tr, .kpi, .card, .obo, .journey, .actions li { break-inside: avoid; }
  a { color: inherit; }
}
${COPY_CSS}
${chartKitCss}
${REPORT_CHART_VARS}
`
}
