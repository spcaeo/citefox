/**
 * Styles for the headline, the verdict, "What to do next", "What changed", "How this
 * report was made", the kind-of-site table and the faint earlier bars. Same tokens as {@link reportCss}; appended after it.
 */
export function perspectivesCss(): string {
  return `/* Headline */
.cover-headline { margin: 16px 0 0; max-width: 72ch; font-size: 18px; line-height: 28px; font-weight: 600; color: var(--ink); }

/* Verdict */
.vd-card { padding: 20px 24px; }
.vd-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; margin-bottom: 12px; }
.vd-badge { display: inline-flex; align-items: center; gap: 8px; padding: 4px 12px; border-radius: 999px; font-weight: 600; font-size: 14px; line-height: 20px; background: var(--track); color: var(--ink-2); }
.vd-badge::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
.vd-badge.vd-ok { background: var(--good-soft); color: var(--good); }
.vd-badge.vd-warn { background: var(--warn-soft); color: var(--warn); }
.vd-badge.vd-bad { background: var(--bad-soft); color: var(--bad); }
.vd-dates { color: var(--faint); font-size: 12px; }
.vd-findings { list-style: none; margin: 0; padding: 0; display: grid; gap: 0; }
.vd-finding { padding: 10px 0 10px 16px; border-top: 1px solid var(--line); position: relative; font-size: 14px; line-height: 22px; }
.vd-finding:first-child { border-top: 0; }
.vd-finding::before { content: ""; position: absolute; left: 0; top: 17px; width: 6px; height: 6px; border-radius: 50%; background: var(--decor); }
.vd-lead { font-weight: 600; }
.vd-finding.vd-ok .vd-lead { color: var(--good); }
.vd-finding.vd-ok::before { background: var(--good); }
.vd-finding.vd-warn .vd-lead { color: var(--warn); }
.vd-finding.vd-warn::before { background: var(--warn); }
.vd-finding.vd-bad .vd-lead { color: var(--bad); }
.vd-finding.vd-bad::before { background: var(--bad); }
.drill.inline { min-width: 0; padding: 0 2px; }
.vd-card .note { margin-top: 8px; }

/* What to do next */
.recs { list-style: none; margin: 0; padding: 0; display: grid; gap: 16px; }
.rec { padding: 20px 24px; }
.rec-line { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 12px; margin: 0 0 6px; font-size: 14px; line-height: 22px; }
.rec-label { color: var(--faint); font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; line-height: 22px; }
.rec-do { font-weight: 600; color: var(--ink); }
.rec-why { color: var(--ink-2); }
.rec .tbl-block { margin-top: 12px; }
.rec .note { margin-top: 8px; }

/* What changed */
.chg-summary { font-size: 14px; line-height: 22px; color: var(--ink-2); margin-bottom: 12px; }
.seg-bar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.seg { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border: 1px solid var(--line-strong); border-radius: 999px; background: var(--surface); color: var(--ink-2); font-size: 13px; font-weight: 500; cursor: pointer; }
.seg:hover { background: var(--surface-2); }
.seg[aria-pressed="true"] { background: var(--spruce); border-color: var(--spruce); color: #fff; }
.seg-n { font-variant-numeric: tabular-nums; opacity: 0.8; }
.seg-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.chg { display: inline-block; padding: 1px 9px; border-radius: 999px; font-size: 12px; line-height: 18px; font-weight: 500; white-space: nowrap; background: var(--track); color: var(--ink-2); }
.chg-gained { background: var(--good-soft); color: var(--good); }
.chg-lost { background: var(--bad-soft); color: var(--bad); }
.chg-kept { background: var(--accent-soft); color: var(--accent-ink); }
.chg-none { background: transparent; color: var(--faint); border: 1px dashed var(--line-strong); }
.seg-dot.chg-gained { background: var(--good); }
.seg-dot.chg-lost { background: var(--bad); }
.seg-dot.chg-kept { background: var(--accent); }
.seg-dot.chg-never { background: var(--c-gray); }
.seg-dot.chg-none { background: transparent; border: 1px dashed var(--decor); }
.prompt-text { display: block; }

/* How this report was made */
.method-facts { margin: 0 0 16px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.method-warn { margin: 0 0 16px; padding: 10px 16px; border-radius: 8px; background: var(--warn-soft); color: var(--warn); font-size: 13px; line-height: 20px; }
.method-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.method-grid .card { padding: 20px 24px; }
.method-grid .chart-title { margin-bottom: 6px; }
.method-text { color: var(--ink-2); font-size: 13px; line-height: 20px; }
.method-card { margin-top: 16px; padding: 16px 24px; }
.method-agree { font-size: 14px; line-height: 22px; }
@media (max-width: 760px) {
  .method-grid { grid-template-columns: minmax(0, 1fr); }
  .rec-line { grid-template-columns: minmax(0, 1fr); gap: 0; }
  .method-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

/* Competition: earlier bars and kinds */
.bar-svg .before { fill: var(--c-gray); opacity: 0.55; }
.swatch-before { height: 4px; border-radius: 2px; background: var(--c-gray); opacity: 0.55; }
.kind { color: var(--ink-2); }
.delta-up { color: var(--good); font-weight: 600; }
.delta-down { color: var(--bad); font-weight: 600; }
@media print {
  .seg-bar { display: none !important; }
  .vd-card, .vd-finding, .rec { break-inside: avoid; }
}
`
}
