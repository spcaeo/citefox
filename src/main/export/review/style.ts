/**
 * Styles for the downloaded ready reports, on top of the report's own (`html/style.ts`,
 * `html/style-perspectives.ts`), with the same variables.
 */
export function reviewCss(): string {
  return `/* Ready reports */
.rv-cover { padding-top: 8px; }
.rv-title { margin: 4px 0 8px; font-size: 28px; line-height: 34px; }
.rv-engines { margin-top: 12px; }
.rv-card { padding: 20px 24px; margin-top: 16px; }
.rv-card .lede { margin-top: 0; }
.rv-vline { margin: 4px 0 12px; font-size: 17px; line-height: 26px; font-weight: 600; color: var(--ink); }
.rv-steps { margin: 0; padding-left: 20px; display: grid; gap: 8px; font-size: 14px; line-height: 22px; }
.rv-tiles { margin: 12px 0; }
.kpi.rv-ok .kpi-value { color: var(--good); }
.kpi.rv-warn .kpi-value { color: var(--r-not-cited); }
.rv-up { color: var(--good); font-size: 13px; }
.rv-down { color: var(--r-not-cited); font-size: 13px; }
.rv-warn-card { border-color: var(--r-not-cited); }
.rv-rowbtn { display: block; width: 100%; padding: 0; border: 0; background: none; text-align: left; font: inherit; color: inherit; cursor: pointer; }
.rv-rowbtn:hover { text-decoration: underline; text-decoration-color: var(--line-strong); }
.cp .rv-rowbtn { display: inline; width: auto; }
.rv-urls { white-space: pre-wrap; padding: 12px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface-2); font-size: 12px; }
.rv-p { max-width: 78ch; color: var(--ink-2); font-size: 14px; line-height: 22px; }
.rv-plain { font-weight: 600; }
.report-section [hidden] { display: none !important; }
.cfc-drill { cursor: pointer; }
.rv-eng { display: inline-flex; align-items: center; gap: 6px; }
.rv-logo { width: 18px; height: 18px; border-radius: 4px; vertical-align: middle; }
.rv-engine-print { display: none; }
.rv-legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 8px 0; color: var(--ink-2); font-size: 12px; }
.rv-legend span { display: inline-flex; align-items: center; gap: 6px; }
tr.tp-off { display: none; }
.rv-topic-pick { display: inline-flex; align-items: center; gap: 8px; margin: 8px 0; font-size: 13px; color: var(--ink-2); }
.rv-pathbtn { padding: 0; border: 0; background: none; font: inherit; color: var(--accent); cursor: pointer; text-align: left; }
.rv-pathbtn:hover { text-decoration: underline; }
.rv-kind { font-weight: 600; }
.dtabs { margin: 8px 0; }
.q-sides { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.rv-prepared { display: flex; align-items: center; gap: 12px; margin: 8px 0 0; color: var(--ink-2); font-size: 14px; }
.rv-client-logo { max-height: 36px; max-width: 160px; object-fit: contain; }
.rv-round { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
.rv-round-step { display: flex; flex-direction: column; gap: 4px; padding: 12px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface-2); font-size: 13px; line-height: 19px; }
.rv-round-n { display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--ink); color: var(--surface); font-size: 12px; font-weight: 700; }
.rv-round-owner { font-weight: 600; color: var(--ink); }
.rv-round-count { color: var(--ink-2); }
.rv-sponsors { margin: 32px 0 8px; padding-top: 16px; border-top: 1px solid var(--line); }
.rv-sponsors-title { margin: 0 0 10px; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
.rv-sponsors-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.rv-sponsor { display: flex; flex-direction: column; gap: 4px; padding: 14px 16px; border-radius: var(--radius); text-decoration: none; }
.rv-sponsor strong { font-size: 16px; }
.rv-sponsor-tier { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
.rv-sponsor-line { font-size: 13px; line-height: 19px; opacity: .9; }
.rv-sponsor-cta { align-self: flex-start; margin-top: 6px; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; }
.rv-facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px 16px; margin: 0 0 16px; padding: 12px 16px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface-2); }
.rv-fact dt { color: var(--muted); font-size: 12px; }
.rv-fact dd { margin: 2px 0 0; font-size: 14px; font-weight: 600; color: var(--ink); }
.rv-legend { margin: 8px 0 0; padding-left: 18px; display: grid; gap: 4px; font-size: 13px; line-height: 19px; color: var(--ink-2); }
.rv-sharebar { display: inline-block; width: 48px; height: 6px; border-radius: 3px; background: var(--surface-2); vertical-align: middle; overflow: hidden; }
.rv-sharebar i { display: block; height: 100%; background: var(--good); }
.rv-tone { display: flex; width: 140px; height: 8px; border-radius: 4px; overflow: hidden; background: var(--surface-2); }
.rv-tone i { display: block; height: 100%; }
.rv-tone-pos { background: var(--good); }
.rv-tone-neu { background: var(--line-strong); }
.rv-tone-neg { background: var(--r-not-cited); }
.rv-net { margin: 4px 0 8px; font-size: 40px; line-height: 44px; font-weight: 700; color: var(--ink); }
.rv-themes { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
.rv-themes p { margin: 0 0 4px; }
@media (max-width: 900px) { .rv-facts { grid-template-columns: 1fr 1fr; } }
@media (max-width: 900px) { .rv-round { grid-template-columns: 1fr 1fr; } .rv-sponsors-row { grid-template-columns: 1fr; } }
@media print {
  [data-switch-panel][hidden] { display: none !important; }
  .rv-engines { display: none; }
  .rv-engine-print { display: block; }
  .rv-sponsors { break-inside: avoid; }
}
`
}
