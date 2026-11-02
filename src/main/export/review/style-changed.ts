/** Styles for the downloaded What changed report's own parts (sections-changed.ts). */
export function changedCss(): string {
  return `/* What changed */
.rv-cover-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; margin: 12px 0 4px; padding: 12px 16px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface-2); }
.rv-cover-grid dt { color: var(--muted); font-size: 12px; }
.rv-cover-grid dd { margin: 0; color: var(--ink); font-size: 14px; }
.rv-moves { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.rv-move { padding: 12px; margin: 0; }
.rv-move-head { display: flex; justify-content: space-between; align-items: baseline; margin: 0 0 8px; color: var(--ink-2); font-size: 13px; }
.rv-move-n { font-size: 20px; font-weight: 700; }
.rv-move-ok .rv-move-n { color: var(--good); }
.rv-move-warn .rv-move-n { color: var(--r-not-cited); }
.rv-move-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; font-size: 13px; line-height: 19px; }
.rv-small-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.rv-small-table th, .rv-small-table td { padding: 6px 8px; border-bottom: 1px solid var(--line); text-align: left; }
.rv-small-table .num { text-align: right; }
.rv-claims { margin: 8px 0; padding-left: 18px; display: grid; gap: 6px; font-size: 13px; line-height: 19px; }
.rv-inline { display: inline; width: auto; color: var(--ink-2); }
.kpi-note { margin: 2px 0 0; color: var(--muted); font-size: 12px; }
@media (max-width: 900px) { .rv-moves, .rv-cover-grid { grid-template-columns: 1fr 1fr; } }
`
}
