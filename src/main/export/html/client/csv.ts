/**
 * CSV text and URL lists for the report's browser script, as plain ES2019 with no DOM
 * access, so tests run it on its own (`new Function(CSV_JS + 'return CFCsv;')`).
 *
 * Cells are quoted, quotes doubled, and a cell that starts like a spreadsheet formula
 * (= + - @ tab, return) gets a leading apostrophe. Numbers stay bare. Lines end in CRLF
 * and the download adds a UTF-8 BOM, so Excel opens accents correctly.
 */
export const CSV_JS = String.raw`var CFCsv = (function () {
  function cell(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number') return isFinite(value) ? String(value) : '';
    if (typeof value === 'boolean') return value ? '"Yes"' : '"No"';
    if (typeof value === 'object') return '';
    var text = String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function text(columns, rows) {
    var lines = [columns.map(cell).join(',')].concat((rows || []).map(function (cells) {
      return cells.map(cell).join(',');
    }));
    return lines.join('\r\n') + '\r\n';
  }
  /** http(s) URLs only, each once, in first-seen order. */
  function urls(list) {
    var seen = {};
    var out = [];
    (list || []).forEach(function (url) {
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url) || seen[url]) return;
      seen[url] = true;
      out.push(url);
    });
    return out;
  }
  /** A safe file name: letters, digits and single dashes. */
  function fileName(base, id) {
    var slug = String(id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    return String(base || 'citefox-report') + '-' + (slug || 'table') + '.csv';
  }
  return { cell: cell, text: text, urls: urls, fileName: fileName };
})();
`
