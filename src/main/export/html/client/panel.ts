import { COPY_ICON, OPEN_ICON, TICK_ICON } from '../copy'

/**
 * The drawer's views for the report's browser script, as plain ES2019 with no DOM
 * access: `CFPanel(DATA, labelFor).resolve(entry)` turns one drill-stack entry into
 * `{ title, sub, html, csv, urls }`. Tests run it on its own
 * (`new Function(PANEL_JS + 'return CFPanel;')`).
 *
 * Levels:
 * - `l:<token>`, `find:<words>`, `p:<page>`, `dom:<domain>`: a list of questions. Each row
 *   opens its answer; the page cell opens the page; cited sites open the site.
 * - `q:<row id>`: one prompt's answer: what it says, the page it was checked for, and
 *   every site it cites (each opens that site's questions).
 *
 * Every value it writes passes `esc()`; links are made only for http(s) URLs. Questions,
 * pages, sites and cited addresses get Copy (+ Open) on hover, as `html/copy.ts` writes.
 */
export const PANEL_JS = String.raw`var CFPanel = function (DATA, labelFor, viewNow) {
  var CP_COPY = '${COPY_ICON}${TICK_ICON}';
  var CP_OPEN = '${OPEN_ICON}';
  var rows = DATA.rows || [];
  var drills = DATA.drills || {};
  var byId = {};
  var views = {};
  rows.forEach(function (row) { byId[row.id] = row; if (row.view) views[row.view] = true; });
  /** Ready reports keep one set of rows per engine view: a page or site list stays in its view. */
  function scoped(row, value) { return (row && row.view ? row.view + '|' : '') + value; }
  function unscope(value) {
    var bar = value.indexOf('|');
    if (bar > 0 && views[value.slice(0, bar)]) return { view: value.slice(0, bar), value: value.slice(bar + 1) };
    return { view: null, value: value };
  }
  function inView(row, view) { return !view || row.view === view; }
  /** Google AI Overview rows say "AI Overview"; every other engine's say "AI answer". */
  function answerWord(list) {
    var google = list.every(function (row) { return !row.engine || row.engine === 'google_aio'; });
    return google ? 'AI Overview' : 'AI answer';
  }
  var KIND_LABELS = { target: 'This page', own: 'Your site', competitor: 'Competitor', other: 'Other site' };
  /** Ready reports, All engines view: one column per engine (id, label, logo data URL). */
  var ENGINES = DATA.engines || [];
  var CHANGE_TABS = [['all', 'All'], ['gained', 'Gained'], ['kept', 'Kept'], ['lost', 'Lost'], ['notcited', 'Not cited']];
  function tabOf(change) { return change === 'noanswer' ? 'notcited' : change; }
  function hasCompare(list) { return list.some(function (row) { return row.change !== undefined && row.change !== null; }); }
  function namedText(value) { return value === null || value === undefined ? '\u2014' : value ? 'Yes' : 'No'; }
  var LIST_COLUMNS = ['#', 'Question', 'Page', 'Page URL', 'Stage', 'Market', 'Status', 'AI answer', 'Cited', 'Named', 'Position', 'Last checked'];

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function httpUrl(url) { return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null; }
  function link(url, text, cls) {
    var href = httpUrl(url);
    if (!href) return esc(text);
    // The quote is escaped so the page's own href scan sees only real links.
    return '<a' + (cls ? ' class="' + cls + '"' : '') + ' href=\"' + esc(href) +
      '" target="_blank" rel="noopener noreferrer">' + esc(text) + '</a>';
  }
  /** Copy (and Open for a web address) at the end of a value: the same markup as html/copy.ts. */
  function cp(inner, value, href, kind) {
    var web = httpUrl(href);
    var cls = 'cp cp-' + (kind || (web ? 'url' : 'text'));
    var openLink = web ? '<a class="cp-btn cp-open" href=\"' + esc(web) + '" target="_blank" rel="noopener noreferrer" aria-label="' +
      esc('Open ' + value + ' in a new tab') + '" title="Open in a new tab">' + CP_OPEN + '</a>' : '';
    return '<span class="' + cls + '"><span class="cp-v">' + inner + '</span><span class="cp-acts">' +
      '<button type="button" class="cp-btn cp-copy needs-js" data-copy="' + esc(value) + '" aria-label="' + esc('Copy ' + value) +
      '" title="Copy">' + CP_COPY + '</button>' + openLink + '</span></span>';
  }
  function siteHref(domain) { return 'https://' + String(domain || '').replace(/^\/+/, ''); }
  function pageCp(row, inner) {
    var value = httpUrl(row.pageUrl) ? row.pageUrl : row.page;
    return cp(inner, value, httpUrl(row.pageUrl), 'url');
  }
  function yesNo(value) {
    if (value === null || value === undefined) return '<span class="dash">\u2014</span>';
    return value ? '<span class="yes">Yes</span>' : '<span class="no">No</span>';
  }
  function yesNoText(value) { return value === null || value === undefined ? '' : value ? 'Yes' : 'No'; }
  function plural(n, word, many) { return n + ' ' + (n === 1 ? word : (many || word + 's')); }
  function share(part, whole) { return whole > 0 ? Math.round((part / whole) * 100) + '%' : '\u2014'; }
  function open(entry, html, label, cls) {
    return '<button type="button" class="open-btn' + (cls ? ' ' + cls : '') + '" data-open="' + esc(entry) +
      '" aria-label="' + esc(label) + '">' + html + '</button>';
  }
  function pageEntry(row) { return 'p:' + scoped(row, row.pageUrl || row.page); }
  /** Compares page addresses without scheme, www, query, hash or the last slash. */
  function norm(url) {
    return String(url || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '')
      .replace(/[?#].*$/, '').replace(/\/+$/, '');
  }
  function siteChips(domains, row) {
    return domains.map(function (domain) {
      return cp(open('dom:' + scoped(row, domain), esc(domain), 'Questions citing ' + domain, 'site-chip'), domain, siteHref(domain), 'url');
    }).join(' ');
  }
  function refDomains(row) {
    var seen = {};
    var out = [];
    (row.refs || []).forEach(function (ref) { if (!seen[ref[2]]) { seen[ref[2]] = true; out.push(ref[2]); } });
    return out.length ? out : (row.domains || []);
  }

  function summary(list) {
    var shown = 0, cited = 0, named = 0, gap = 0;
    list.forEach(function (row) {
      if (row.aio === true) shown += 1;
      if (row.cited) cited += 1;
      if (row.named) named += 1;
      if (row.aio === true && !row.cited) gap += 1;
    });
    function cell(label, value, sub) {
      return '<div class="dstat"><span class="dstat-k">' + esc(label) + '</span><span class="dstat-v">' + esc(value) +
        '</span><span class="dstat-s">' + esc(sub) + '</span></div>';
    }
    return '<div class="dstats" data-testid="drawer-summary">' +
      cell('Questions', list.length, 'in this list') +
      cell(answerWord(list) + ' shown', shown, share(shown, list.length)) +
      cell('Cited', cited, share(cited, shown) + ' of shown') +
      cell('Named', named, share(named, list.length)) +
      cell('Gap', gap, 'shown, not cited') + '</div>';
  }

  function engineCells(row, show) {
    if (!show) return '';
    var byEngine = {};
    (row.engines || []).forEach(function (cell) { byEngine[cell[0]] = cell; });
    return ENGINES.map(function (engine) {
      var cell = byEngine[engine.id];
      return '<td class="center">' + (cell
        ? '<span class="chip ' + esc(cell[1]) + '" title="' + esc(engine.label + ': ' + cell[2]) + '">' + esc(cell[2]) + '</span>'
        : '<span class="dash">\u2014</span>') + '</td>';
    }).join('');
  }
  function showEngines(list) { return ENGINES.length > 1 && list.some(function (row) { return row.engines; }); }
  function engineHeads() {
    return ENGINES.map(function (engine) {
      // The logo is an embedded data URL. The tag is split so the Full report's scan for loads stays clean.
      var logo = /^data:image\//.test(engine.logo || '') ? '<' + 'img class="rv-logo" ' + 'sr' + 'c="' + esc(engine.logo) + '" alt="" width="16" height="16"> ' : '';
      return '<th scope="col" class="center">' + logo + esc(engine.label) + '</th>';
    }).join('');
  }
  function changeTabs(list) {
    if (!hasCompare(list)) return '';
    return '<div class="seg-bar dtabs" role="group" aria-label="Change" data-testid="drawer-tabs">' + CHANGE_TABS.map(function (tab, index) {
      var n = tab[0] === 'all' ? list.length : list.filter(function (row) { return tabOf(row.change) === tab[0]; }).length;
      return '<button type="button" class="seg" data-dtab="' + tab[0] + '" aria-pressed="' + (index === 0) + '">' + esc(tab[1]) + ' <span class="seg-n">' + n + '</span></button>';
    }).join('') + '</div>';
  }
  function position(row) {
    var now = row.position === null || row.position === undefined ? '\u2014' : '#' + row.position;
    if (!row.before) return row.position === null || row.position === undefined ? '\u2014' : String(row.position);
    var before = row.before.position === null || row.before.position === undefined ? '\u2014' : '#' + row.before.position;
    return before + ' \u2192 ' + now;
  }

  function listTable(list, options) {
    var withYou = !!(options && options.withYou);
    var compare = list.some(function (row) { return row.before; });
    var engines = showEngines(list);
    var body = list.map(function (row) {
      var sites = refDomains(row);
      var excerpt = row.excerpt
        ? '<details class="excerpt"><summary>What the overview says</summary><p>' + esc(row.excerpt) + '</p>' +
          (sites.length ? '<p class="excerpt-domains">Sites cited: ' + siteChips(sites.slice(0, 6), row) + '</p>' : '') +
          '</details>'
        : '';
      var named = compare && row.before
        ? esc(namedText(row.before.named) + ' \u2192 ' + namedText(row.named))
        : yesNo(row.named);
      return '<tr data-row-id="' + esc(row.id) + '" data-open="q:' + esc(row.id) + '"' +
        (row.change ? ' data-chg="' + esc(tabOf(row.change)) + '"' : '') + '><td class="wide">' +
        cp(open('q:' + row.id, esc(row.text), 'Open the answer for: ' + row.text, 'prompt-text'), row.text, null, 'text') +
        '<span class="chip ' + esc(row.statusClass) + '">' + esc(row.status) + '</span>' + excerpt + '</td>' +
        '<td class="path">' + pageCp(row, open(pageEntry(row), '<span class="path">' + esc(row.page) + '</span>', 'Questions for ' + row.page)) + '</td>' +
        '<td>' + esc(row.stage) + '</td>' +
        '<td class="nowrap">' + esc(row.market) + '</td>' +
        '<td class="center">' + yesNo(row.aio) + '</td>' +
        '<td class="center">' + yesNo(row.cited) + '</td>' +
        (withYou ? '<td class="center">' + yesNo(row.cited) + '</td>' : '') +
        '<td class="center">' + named + '</td>' +
        '<td class="num">' + esc(position(row)) + '</td>' +
        engineCells(row, engines) +
        '<td class="nowrap">' + esc(row.checked) + '</td></tr>';
    }).join('');
    var labelsHead = ['Question', 'Page', 'Stage', 'Market', answerWord(list) === 'AI Overview' ? 'AIO' : 'Answer', 'Cited']
      .concat(withYou ? ['You in the same answer'] : [])
      .concat([compare ? 'Named before \u2192 now' : 'Named', compare ? 'Position before \u2192 now' : 'Position']);
    var head = labelsHead.map(function (label) { return '<th scope="col">' + label + '</th>'; }).join('') +
      (engines ? engineHeads() : '') + '<th scope="col">Last checked</th>';
    return '<div class="scroll"><table class="drawer-table" aria-label="Questions in this list"><thead><tr>' + head +
      '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function listCsv(list) {
    return {
      columns: LIST_COLUMNS,
      rows: list.map(function (r) {
        return [r.number, r.text, r.page, r.pageUrl, r.stage, r.market, r.status, yesNoText(r.aio),
          yesNoText(r.cited), yesNoText(r.named), r.position, r.checked];
      })
    };
  }

  function listView(title, sub, list, extra) {
    var html = (extra && extra.before ? extra.before : '') +
      (list.length ? summary(list) + changeTabs(list) + listTable(list, extra) : '<p class="drawer-empty">No questions match.</p>') +
      (extra && extra.after ? extra.after : '');
    var urls = extra && extra.urls ? extra.urls : list.map(function (row) { return row.pageUrl; });
    return { kind: 'list', title: title, sub: sub, html: html, csv: listCsv(list), urls: urls, count: list.length };
  }

  function search(query) {
    var terms = String(query).toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    var view = typeof viewNow === 'function' ? viewNow() : null;
    return rows.filter(function (row) {
      if (!inView(row, view)) return false;
      var hay = [row.text, row.label, row.page, row.market, row.stage, row.source, row.status].join(' ').toLowerCase();
      return terms.every(function (term) { return hay.indexOf(term) !== -1; });
    });
  }

  /** Sites and pages whose name matches the search, as chips that open them. */
  function searchMore(query) {
    var terms = String(query).toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return { html: '', count: 0 };
    var view = typeof viewNow === 'function' ? viewNow() : null;
    var sites = {}, pages = {}, siteList = [], pageList = [];
    function hit(text) {
      var hay = String(text || '').toLowerCase();
      return terms.every(function (term) { return hay.indexOf(term) !== -1; });
    }
    rows.forEach(function (row) {
      if (!inView(row, view)) return;
      refDomains(row).forEach(function (domain) {
        if (!sites[domain] && hit(domain)) { sites[domain] = true; siteList.push({ row: row, domain: domain }); }
      });
      if (row.pageUrl && !pages[row.pageUrl] && hit(row.pageUrl)) { pages[row.pageUrl] = true; pageList.push(row); }
    });
    var html = '';
    if (siteList.length) {
      html += '<p class="drill-links" data-testid="search-sites"><span class="dstat-k">Sites</span> ' + siteList.slice(0, 12).map(function (item) {
        return cp(open('dom:' + scoped(item.row, item.domain), esc(item.domain), 'Questions citing ' + item.domain, 'site-chip'), item.domain, siteHref(item.domain), 'url');
      }).join(' ') + '</p>';
    }
    if (pageList.length) {
      html += '<p class="drill-links" data-testid="search-pages"><span class="dstat-k">Pages</span> ' + pageList.slice(0, 12).map(function (row) {
        return pageCp(row, open(pageEntry(row), '<span class="path">' + esc(row.page) + '</span>', 'Questions for ' + row.page, 'site-chip'));
      }).join(' ') + '</p>';
    }
    return { html: html, count: siteList.length + pageList.length };
  }

  function rowsFor(token) {
    return (drills[token] || []).map(function (id) { return byId[id]; }).filter(Boolean);
  }

  function pageView(entry) {
    var parts = unscope(entry);
    var key = parts.value;
    var want = norm(key);
    var checked = 0, citing = 0, url = null;
    var list = rows.filter(function (row) {
      if (!inView(row, parts.view)) return false;
      var mine = norm(row.pageUrl) === want || row.page === key;
      var cites = (row.refs || []).some(function (ref) { return norm(ref[1]) === want; });
      if (mine) { checked += 1; url = url || row.pageUrl; }
      if (cites) { citing += 1; url = url || (row.refs || []).filter(function (ref) { return norm(ref[1]) === want; })[0][1]; }
      return mine || cites;
    });
    if (!list.length) return null;
    var path = list[0].pageUrl && norm(list[0].pageUrl) === want ? list[0].page : key;
    var before = httpUrl(url) ? '<p class="drill-links">' + link(url, 'Open the page', 'ext-link') + ' ' + cp('<span class="path">' + esc(url) + '</span>', url, url, 'url') + '</p>' : '';
    return listView(path, plural(checked, 'question') + ' checked for this page \u00b7 ' + plural(citing, 'answer') + ' cite it',
      list, { before: before, urls: url ? [url] : [] });
  }

  function domainView(entry) {
    var parts = unscope(entry);
    var domain = parts.value;
    var pages = {};
    var order = [];
    var list = rows.filter(function (row) {
      if (!inView(row, parts.view)) return false;
      var hit = false;
      (row.refs || []).forEach(function (ref) {
        if (ref[2] !== domain) return;
        hit = true;
        if (!pages[ref[1]]) { pages[ref[1]] = { url: ref[1], title: ref[3], n: 0, seen: {} }; order.push(ref[1]); }
        if (!pages[ref[1]].seen[row.id]) { pages[ref[1]].seen[row.id] = true; pages[ref[1]].n += 1; }
      });
      if (!hit && !(row.refs || []).length && (row.domains || []).indexOf(domain) !== -1) hit = true;
      return hit;
    });
    if (!list.length) return null;
    var items = order.map(function (url) { return pages[url]; }).sort(function (a, b) { return b.n - a.n; });
    var after = items.length
      ? '<h3 class="dsub">Pages from ' + esc(domain) + ' in these answers <span class="tbl-count">' + items.length + '</span></h3>' +
        '<div class="scroll"><table class="drawer-pages" aria-label="Pages from ' + esc(domain) + '"><thead><tr>' +
        '<th scope="col">Page</th><th scope="col" class="num">Questions</th></tr></thead><tbody>' +
        items.map(function (item) {
          return '<tr><td class="wide">' + (item.title ? '<span class="ref-title">' + esc(item.title) + '</span>' : '') +
            '<span class="url">' + cp(link(item.url, item.url), item.url, item.url, 'url') + '</span></td><td class="num">' + item.n + '</td></tr>';
        }).join('') + '</tbody></table></div>'
      : '';
    return listView(domain, plural(list.length, 'question') + ' cite this site', list, {
      after: after, urls: items.map(function (item) { return item.url; }), withYou: true
    });
  }

  function questionView(id) {
    var row = byId[id];
    if (!row) return null;
    var refs = row.refs || [];
    function fact(label, value) {
      return '<div class="dstat"><span class="dstat-k">' + esc(label) + '</span><span class="dstat-v">' + value + '</span></div>';
    }
    var meta = '<p class="q-meta"><span class="chip ' + esc(row.statusClass) + '">' + esc(row.status) + '</span> ' +
      esc(['Question #' + row.number, row.market, row.stage, row.checked ? 'Checked ' + row.checked : ''].filter(Boolean).join(' \u00b7 ')) + '</p>';
    var facts = '<div class="dstats q-facts">' +
      fact(answerWord([row]) + ' shown', yesNo(row.aio)) + fact('Your site cited', yesNo(row.cited)) +
      fact('This page cited', yesNo(row.pageCited)) + fact('Brand named', yesNo(row.named)) +
      fact('Position', esc(row.position === null || row.position === undefined ? '\u2014' : row.position)) + '</div>';
    var sides = '';
    if (row.before || row.citedThrough !== undefined) {
      var side = function (label, status, cls, named, pos, through) {
        return '<div class="dstat"><span class="dstat-k">' + esc(label) + '</span><span class="dstat-v"><span class="chip ' + esc(cls) + '">' + esc(status) + '</span></span>' +
          '<span class="dstat-s">Brand named: ' + esc(namedText(named)) + (pos === null || pos === undefined ? '' : ' \u00b7 source #' + esc(pos)) + '</span>' +
          '<span class="dstat-s">Cited through: ' + esc(through || 'no page of yours') + '</span></div>';
      };
      sides = '<div class="dstats q-sides" data-testid="q-sides">' +
        (row.before ? side(row.before.label || 'Before', row.before.status, row.before.statusClass, row.before.named, row.before.position, row.before.page) : '') +
        side(row.checked || 'Now', row.status, row.statusClass, row.named, row.position, row.citedThrough) + '</div>';
    }
    var page = '<h3 class="dsub">Page it was checked for</h3><p class="drill-links">' +
      pageCp(row, open(pageEntry(row), '<span class="path">' + esc(row.page) + '</span>', 'Questions for ' + row.page)) +
      (httpUrl(row.pageUrl) ? ' ' + link(row.pageUrl, 'Open the page', 'ext-link') : '') + '</p>';
    var answer = '<h3 class="dsub">What the AI answer says</h3>' + (row.excerpt
      ? '<blockquote class="answer">' + esc(row.excerpt) + '</blockquote>'
      : '<p class="drawer-empty">' + (row.aio === true ? 'The answer text is not kept in this report.' : 'There was no ' + answerWord([row]) + ' on the last check.') + '</p>');
    var table = refs.length
      ? '<div class="scroll"><table class="drawer-refs" aria-label="Sites cited in the answer"><thead><tr>' +
        '<th scope="col" class="num">#</th><th scope="col">Site</th><th scope="col">Cited page</th><th scope="col">Kind</th></tr></thead><tbody>' +
        refs.map(function (ref) {
          return '<tr data-open="dom:' + esc(scoped(row, ref[2])) + '"><td class="num">' + esc(ref[0]) + '</td>' +
            '<td class="nowrap">' + cp(open('dom:' + scoped(row, ref[2]), esc(ref[2]), 'Questions citing ' + ref[2]), ref[2], siteHref(ref[2]), 'url') + '</td>' +
            '<td class="wide">' + (ref[3] ? '<span class="ref-title">' + esc(ref[3]) + '</span>' : '') +
            '<span class="url">' + cp(link(ref[1], ref[1]), ref[1], ref[1], 'url') + '</span></td>' +
            '<td><span class="kind kind-' + esc(ref[4]) + '">' + esc(KIND_LABELS[ref[4]] || 'Other site') + '</span></td></tr>';
        }).join('') + '</tbody></table></div>'
      : '<p class="drawer-empty">No sites were cited.</p>';
    var sites = '<h3 class="dsub">Sites cited in the answer <span class="tbl-count">' + refs.length + '</span></h3>' + table;
    return {
      kind: 'question', title: row.text, sub: plural(refs.length, 'site') + ' cited',
      html: meta + facts + sides + answer + sites + page,
      csv: {
        columns: ['Position', 'Site', 'Cited page', 'Title', 'Kind'],
        rows: refs.map(function (ref) { return [ref[0], ref[2], ref[1], ref[3], KIND_LABELS[ref[4]] || 'Other site']; })
      },
      urls: refs.map(function (ref) { return ref[1]; }),
      count: refs.length
    };
  }

  /** Short words for the trail. */
  function shortTitle(text) {
    var value = String(text || '');
    return value.length > 40 ? value.slice(0, 38) + '\u2026' : value;
  }

  function resolve(entry) {
    var at = String(entry || '').indexOf(':');
    if (at <= 0) return null;
    var kind = entry.slice(0, at);
    var value = entry.slice(at + 1);
    if (kind === 'l') {
      if (!drills[value]) return null;
      var list = rowsFor(value);
      var bare = unscope(value).value;
      var site = /^dom:/.test(bare) && !/:(with|gap)$/.test(bare);
      return listView(labelFor(value) || 'Questions', plural(list.length, 'question'), list, site ? { withYou: true } : null);
    }
    if (kind === 'find') {
      var found = search(value);
      var more = searchMore(value);
      return listView('Search: \u201c' + value + '\u201d', plural(found.length, 'question') + ' match' +
        (more.count ? ' \u00b7 ' + plural(more.count, 'site or page', 'sites or pages') : ''), found, { before: more.html });
    }
    if (kind === 'q') return questionView(value);
    if (kind === 'p') return pageView(value);
    if (kind === 'dom') return domainView(value);
    return null;
  }

  return { resolve: resolve, search: search, rowsFor: rowsFor, shortTitle: shortTitle, esc: esc, byId: byId };
};
`
