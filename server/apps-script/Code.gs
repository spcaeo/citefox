/**
 * CiteFox registration and update emails: a Google Apps Script web app bound
 * to a Google Sheet, owned by the CiteFox Gmail account. Setup: server/README.md.
 *
 * The desktop app sends three kinds of POST (JSON body, always with `token`):
 *   { kind: 'register', installId, name, email, company, role, productUpdates, news, version, build, os, arch }
 *   { kind: 'ping', installId, day, version, build, os, arch }
 *   { kind: 'report', reportId, installId, version, build, os, arch, note, summary, zipName, zipBase64 }
 * and reads `{ ok: true }` (a report: `{ ok: true, reportId }`) or `{ ok: false, error }`.
 * Apps Script cannot send an HTTP status, so errors travel in the body.
 *
 * The token ships inside the app, so it is public: it only keeps random
 * traffic out. Input is checked, every caller is rate-limited with
 * CacheService, and sheet writes hold a lock. All email is sent from here,
 * with MailApp, never from the app.
 *
 * Admin (the CiteFox menu in the Sheet, or run from the editor):
 *   setup()               make the tabs and the script settings (run once)
 *   showActiveInstalls()  installs active in the last 7 and 30 days
 *   listUsers()           everyone who joined, newest first (in the log)
 *   sendEmailToOptedIn()  send the email in the Compose tab to opted-in users
 *   sendTestEmail()       send the Compose email to yourself only
 *   deleteUserByEmail()   remove one person everywhere (privacy request)
 *   deleteReportByReference()  remove one problem report (row and Drive file)
 */

/* ---------- Settings ---------- */

var SHEETS = {
  users: 'Users',
  installs: 'Installs',
  compose: 'Compose',
  sends: 'Sends',
  reports: 'Reports'
}

var USER_COLUMNS = [
  'install_id',
  'email',
  'name',
  'company',
  'role',
  'product_updates',
  'news',
  'joined_at',
  'updated_at',
  'version',
  'os',
  'unsubscribed_at'
]

var INSTALL_COLUMNS = ['install_id', 'first_seen', 'last_seen', 'version', 'build', 'os', 'arch']
var SEND_COLUMNS = ['campaign', 'email', 'sent_at']
var REPORT_COLUMNS = [
  'Received',
  'Reference',
  'Install',
  'Version',
  'Build',
  'OS',
  'Arch',
  'Note',
  'Summary',
  'File',
  'Status',
  'Handled by',
  'Notes'
]
var REPORT_FOLDER_NAME = 'CiteFox reports'

var LIMITS = { name: 100, email: 254, company: 120, version: 40, os: 20, arch: 20 }
var REPORT_LIMITS = { note: 2000, summary: 4000, zipBase64: 3500000, zipBytes: 2600000 }
var ROLES = ['agency', 'in-house', 'solo']
var OS_NAMES = ['darwin', 'win32', 'linux']

/** Per install: at most this many calls of a kind in the window (seconds). */
var RATE = {
  register: { max: 5, seconds: 3600 },
  ping: { max: 4, seconds: 21600 },
  /** Problem reports. CacheService keeps a value 6 hours at most, so the hourly
   *  rule uses the cache and the two daily rules count rows of the Reports tab. */
  report: { max: 3, seconds: 3600 },
  reportDay: { max: 10, seconds: 86400 },
  reportAll: { max: 200, seconds: 86400 },
  /** Everyone together, per minute: keeps a flood off the Sheet and the quota. */
  all: { max: 120, seconds: 60 }
}

var DEFAULT_APP_TOKEN = 'citefox-public-v1'
var MAX_BODY = 10000
var MAX_REPORT_BODY = 3600000
var CACHE_MAX_SECONDS = 21600

/* ---------- Pure helpers (unit-tested in src/main/account/apps-script.test.ts) ---------- */

function cleanText(value, max) {
  if (typeof value !== 'string') return ''
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, max)
}

/** A cell value that a spreadsheet will not run as a formula. */
function safeCell(value) {
  var text = String(value)
  return /^[=+\-@\t\r]/.test(text) ? "'" + text : text
}

function isEmail(value) {
  return (
    typeof value === 'string' &&
    value.length <= LIMITS.email &&
    /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/.test(value)
  )
}

function isInstallId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(value)
}

/** Common fields every message carries. */
function readClientFacts(body) {
  var build = Number(body.build)
  return {
    version: cleanText(body.version, LIMITS.version),
    build: Number.isInteger(build) && build >= 0 && build < 1e9 ? build : '',
    os: OS_NAMES.indexOf(body.os) >= 0 ? body.os : 'other',
    arch: cleanText(body.arch, LIMITS.arch).replace(/[^A-Za-z0-9_]/g, '')
  }
}

/** `{ ok: true, value }` or `{ ok: false, error }` for a register message. */
function validateRegister(body) {
  if (!isInstallId(body.installId)) return { ok: false, error: 'invalid' }
  var name = cleanText(body.name, LIMITS.name)
  var email = cleanText(body.email, LIMITS.email).toLowerCase()
  var company = cleanText(body.company, LIMITS.company)
  if (name === '' || !isEmail(email) || ROLES.indexOf(body.role) < 0) {
    return { ok: false, error: 'invalid' }
  }
  var facts = readClientFacts(body)
  return {
    ok: true,
    value: {
      installId: body.installId,
      name: name,
      email: email,
      company: company,
      role: body.role,
      productUpdates: body.productUpdates === true,
      news: body.news === true,
      version: facts.version,
      os: facts.os
    }
  }
}

function validatePing(body) {
  if (!isInstallId(body.installId)) return { ok: false, error: 'invalid' }
  var facts = readClientFacts(body)
  return {
    ok: true,
    value: {
      installId: body.installId,
      version: facts.version,
      build: facts.build,
      os: facts.os,
      arch: facts.arch
    }
  }
}

/** Like cleanText but keeps line breaks (a report summary has lines). */
function cleanMultiline(value, max) {
  if (typeof value !== 'string') return ''
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, max)
}

var BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** True when `text` is padded standard base64 (length a multiple of 4). */
function isBase64(text) {
  return text.length % 4 === 0 && /^[A-Za-z0-9+\/]+={0,2}$/.test(text)
}

/** Size in bytes of the data a valid base64 string holds. */
function base64DecodedLength(text) {
  var pad = text.slice(-2) === '==' ? 2 : text.slice(-1) === '=' ? 1 : 0
  return (text.length / 4) * 3 - pad
}

/** True when the base64 data starts with the ZIP signature "PK" (0x50 0x4B). */
function startsWithZipSignature(text) {
  if (text.length < 4) return false
  var a = BASE64_ALPHABET.indexOf(text.charAt(0))
  var b = BASE64_ALPHABET.indexOf(text.charAt(1))
  var c = BASE64_ALPHABET.indexOf(text.charAt(2))
  if (a < 0 || b < 0 || c < 0) return false
  var first = (a << 2) | (b >> 4)
  var second = ((b & 15) << 4) | (c >> 2)
  return first === 0x50 && second === 0x4b
}

/** `{ ok: true, value }` or `{ ok: false, error: 'invalid' | 'size' }` for a report message. */
function validateReport(body) {
  if (typeof body.reportId !== 'string' || !/^CF-[A-HJ-KM-NP-Z2-9]{6}$/.test(body.reportId)) {
    return { ok: false, error: 'invalid' }
  }
  if (!isInstallId(body.installId)) return { ok: false, error: 'invalid' }
  if (typeof body.zipBase64 !== 'string' || body.zipBase64.length === 0) {
    return { ok: false, error: 'invalid' }
  }
  if (body.zipBase64.length > REPORT_LIMITS.zipBase64) return { ok: false, error: 'size' }
  if (!isBase64(body.zipBase64)) return { ok: false, error: 'invalid' }
  if (base64DecodedLength(body.zipBase64) > REPORT_LIMITS.zipBytes) {
    return { ok: false, error: 'size' }
  }
  if (!startsWithZipSignature(body.zipBase64)) return { ok: false, error: 'invalid' }
  if (body.zipName !== body.reportId + '.zip') return { ok: false, error: 'invalid' }
  var facts = readClientFacts(body)
  return {
    ok: true,
    value: {
      reportId: body.reportId,
      installId: body.installId,
      version: facts.version,
      build: facts.build,
      os: facts.os,
      arch: facts.arch,
      note: cleanText(body.note, REPORT_LIMITS.note),
      summary: cleanMultiline(body.summary, REPORT_LIMITS.summary),
      zipName: body.zipName,
      zipBase64: body.zipBase64
    }
  }
}

/**
 * True when this install, or everyone together, already sent its daily share of
 * reports in the 24 hours before `now`. `rows` are Reports rows (REPORT_COLUMNS).
 */
function reportsOverDailyLimit(rows, installId, now) {
  var since = now.getTime() - RATE.reportDay.seconds * 1000
  var mine = 0
  var all = 0
  for (var i = 0; i < rows.length; i++) {
    var at = new Date(rows[i][0]).getTime()
    if (isNaN(at) || at < since) continue
    all++
    if (String(rows[i][2]) === installId) mine++
  }
  return mine >= RATE.reportDay.max || all >= RATE.reportAll.max
}

/** Plain-text email to the owner. No HTML, no user text beyond the body. */
function buildReportEmail(report, link) {
  var summary = report.summary.slice(0, 1500)
  return {
    subject: '[CiteFox report] ' + report.reportId,
    body: [
      'Reference: ' + report.reportId,
      'Version: ' + report.version + (report.build === '' ? '' : ' (build ' + report.build + ')'),
      'OS: ' + report.os + ' ' + report.arch,
      '',
      'Note from the user:',
      report.note === '' ? '(none)' : report.note,
      '',
      'Summary' + (report.summary.length > 1500 ? ' (cut at 1500 characters)' : '') + ':',
      summary === '' ? '(none)' : summary,
      '',
      'File: ' + (link || 'not saved (see the Reports tab)'),
      'All reports: the Reports tab in the CiteFox Sheet.'
    ].join('\n')
  }
}

/**
 * Parses the POST body; null when it is not a JSON object. Bodies over 10,000
 * characters are only allowed for kind "report" (up to 3,600,000 characters).
 */
function parseBody(text) {
  if (typeof text !== 'string' || text.length > MAX_REPORT_BODY) return null
  if (text.length > MAX_BODY && text.indexOf('"report"') < 0) return null
  try {
    var value = JSON.parse(text)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    if (text.length > MAX_BODY && value.kind !== 'report') return null
    return value
  } catch (e) {
    return null
  }
}

/** Installs whose last ping is within `days` of `now`, from rows of INSTALL_COLUMNS. */
function countActive(rows, now, days) {
  var since = now.getTime() - days * 24 * 3600 * 1000
  var count = 0
  for (var i = 0; i < rows.length; i++) {
    var last = new Date(rows[i][2]).getTime()
    if (!isNaN(last) && last >= since) count++
  }
  return count
}

/**
 * Who gets an email for `audience` ('updates' or 'news'): one address once,
 * opted in on its newest row, not unsubscribed, not already sent this campaign.
 */
function pickRecipients(userRows, audience, alreadySent) {
  var newest = {}
  for (var i = 0; i < userRows.length; i++) {
    var row = userRows[i]
    var email = String(row[1]).toLowerCase()
    var updated = new Date(row[8]).getTime() || 0
    if (!newest[email] || updated >= newest[email].updated) {
      newest[email] = { row: row, updated: updated }
    }
  }
  var out = []
  for (var key in newest) {
    var r = newest[key].row
    var consent = audience === 'news' ? r[6] : r[5]
    if (consent !== true && consent !== 'TRUE') continue
    if (r[11]) continue
    if (alreadySent[key]) continue
    if (!isEmail(key)) continue
    out.push({ email: key, name: String(r[2]) })
  }
  return out
}

/** Web-safe base64 of an HMAC-SHA256, from the byte array Apps Script returns. */
function toWebSafe(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '')
}

function unsubscribeSignature(email, secret) {
  return toWebSafe(Utilities.computeHmacSha256Signature(email, secret)).slice(0, 32)
}

function unsubscribeLink(baseUrl, email, secret) {
  return (
    baseUrl +
    '?a=unsubscribe&e=' +
    encodeURIComponent(email) +
    '&s=' +
    unsubscribeSignature(email, secret)
  )
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** The email for one person: plain text and simple HTML, both with the unsubscribe link. */
function buildEmail(input) {
  var greeting = input.name ? 'Hi ' + input.name.split(' ')[0] + ',' : 'Hi,'
  var why =
    input.audience === 'news'
      ? 'You get this because you ticked "Occasional news and offers" in CiteFox.'
      : 'You get this because you ticked "Product updates" in CiteFox.'
  var footer = [why, 'Unsubscribe: ' + input.unsubscribe]
  if (input.address) footer.push(input.address)
  var text = greeting + '\n\n' + input.body + '\n\n--\n' + footer.join('\n')
  var html =
    '<p>' +
    escapeHtml(greeting) +
    '</p>' +
    input.body
      .split(/\n{2,}/)
      .map(function (p) {
        return '<p>' + escapeHtml(p).replace(/\n/g, '<br>') + '</p>'
      })
      .join('') +
    '<hr><p style="color:#666;font-size:12px">' +
    escapeHtml(why) +
    '<br><a href="' +
    escapeHtml(input.unsubscribe) +
    '">Unsubscribe</a>' +
    (input.address ? '<br>' + escapeHtml(input.address) : '') +
    '</p>'
  return { subject: input.subject, text: text, html: html }
}

/* ---------- Web app ---------- */

function json(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(
    ContentService.MimeType.JSON
  )
}

function props() {
  return PropertiesService.getScriptProperties()
}

function appToken() {
  return props().getProperty('APP_TOKEN') || DEFAULT_APP_TOKEN
}

/** True when this caller is still under its limit; counts the call. */
function allow(kind, id) {
  var cache = CacheService.getScriptCache()
  var rule = RATE[kind]
  var key = 'rl:' + kind + ':' + id
  var used = Number(cache.get(key) || 0)
  if (used >= rule.max) return false
  cache.put(key, String(used + 1), Math.min(rule.seconds, CACHE_MAX_SECONDS))
  return true
}

function doPost(e) {
  var body = parseBody(e && e.postData ? e.postData.contents : null)
  if (body === null) return json({ ok: false, error: 'invalid' })
  if (body.token !== appToken()) return json({ ok: false, error: 'token' })
  var kind = body.kind
  if (kind !== 'register' && kind !== 'ping' && kind !== 'report') {
    return json({ ok: false, error: 'invalid' })
  }
  var checked =
    kind === 'register'
      ? validateRegister(body)
      : kind === 'ping'
        ? validatePing(body)
        : validateReport(body)
  if (!checked.ok) return json(checked)
  if (!allow('all', 'everyone') || !allow(kind, checked.value.installId)) {
    return json({ ok: false, error: 'rate' })
  }
  var lock = LockService.getScriptLock()
  if (!lock.tryLock(10000)) return json({ ok: false, error: 'busy' })
  try {
    if (kind === 'register') saveUser(checked.value, new Date())
    else if (kind === 'ping') saveInstall(checked.value, new Date())
    else {
      var now = new Date()
      var tab = sheet(SHEETS.reports, REPORT_COLUMNS)
      var existing = rowsOf(tab, REPORT_COLUMNS.length)
      if (reportsOverDailyLimit(existing, checked.value.installId, now)) {
        return json({ ok: false, error: 'rate' })
      }
      try {
        return json(saveReport(checked.value, now))
      } catch (err) {
        Logger.log('Report not saved: ' + err)
        return json({ ok: false, error: 'failed' })
      }
    }
  } finally {
    lock.releaseLock()
  }
  return json({ ok: true })
}

function doGet(e) {
  var p = (e && e.parameter) || {}
  if (p.a === 'unsubscribe') return unsubscribePage(String(p.e || ''), String(p.s || ''))
  return HtmlService.createHtmlOutput('<p>CiteFox</p>')
}

function unsubscribePage(email, signature) {
  var secret = props().getProperty('UNSUBSCRIBE_SECRET')
  var lower = email.toLowerCase()
  if (!secret || !isEmail(lower) || signature !== unsubscribeSignature(lower, secret)) {
    return HtmlService.createHtmlOutput(
      '<p>This unsubscribe link is not valid. Reply to any CiteFox email and we will remove you.</p>'
    )
  }
  var lock = LockService.getScriptLock()
  lock.waitLock(10000)
  try {
    unsubscribe(lower, new Date())
  } finally {
    lock.releaseLock()
  }
  return HtmlService.createHtmlOutput(
    '<p>You are unsubscribed. CiteFox will not email ' + escapeHtml(lower) + ' again.</p>'
  )
}

/* ---------- Sheet ---------- */

function sheet(name, columns) {
  var book = SpreadsheetApp.getActiveSpreadsheet()
  var tab = book.getSheetByName(name)
  if (!tab) {
    tab = book.insertSheet(name)
    if (columns) {
      tab.getRange(1, 1, 1, columns.length).setValues([columns])
      tab.setFrozenRows(1)
    }
  }
  return tab
}

/** Data rows (no header). */
function rowsOf(tab, width) {
  var last = tab.getLastRow()
  if (last < 2) return []
  return tab.getRange(2, 1, last - 1, width).getValues()
}

function findRow(rows, column, value) {
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][column]) === value) return i
  }
  return -1
}

/** Adds or updates the person's row for this install. Ticking a box again clears an old unsubscribe. */
function saveUser(user, now) {
  var tab = sheet(SHEETS.users, USER_COLUMNS)
  var rows = rowsOf(tab, USER_COLUMNS.length)
  var at = findRow(rows, 0, user.installId)
  var stamp = now.toISOString()
  var joined = at >= 0 ? rows[at][7] : stamp
  var unsubscribed = at >= 0 && !user.productUpdates && !user.news ? rows[at][11] : ''
  var row = [
    user.installId,
    safeCell(user.email),
    safeCell(user.name),
    safeCell(user.company),
    user.role,
    user.productUpdates,
    user.news,
    joined,
    stamp,
    safeCell(user.version),
    user.os,
    unsubscribed
  ]
  if (at >= 0) tab.getRange(at + 2, 1, 1, row.length).setValues([row])
  else tab.appendRow(row)
}

function saveInstall(ping, now) {
  var tab = sheet(SHEETS.installs, INSTALL_COLUMNS)
  var rows = rowsOf(tab, INSTALL_COLUMNS.length)
  var at = findRow(rows, 0, ping.installId)
  var stamp = now.toISOString()
  var row = [
    ping.installId,
    at >= 0 ? rows[at][1] : stamp,
    stamp,
    safeCell(ping.version),
    ping.build,
    ping.os,
    ping.arch
  ]
  if (at >= 0) tab.getRange(at + 2, 1, 1, row.length).setValues([row])
  else tab.appendRow(row)
}

/** The private Drive folder for report files; made once, its id kept in REPORTS_FOLDER_ID. */
function reportsFolder() {
  var id = props().getProperty('REPORTS_FOLDER_ID')
  if (id) {
    try {
      return DriveApp.getFolderById(id)
    } catch (e) {
      // Deleted by hand: make a new one below.
    }
  }
  var folder = DriveApp.createFolder(REPORT_FOLDER_NAME)
  props().setProperty('REPORTS_FOLDER_ID', folder.getId())
  return folder
}

/** Saves the zip in the private folder (never shared) and returns the file's link. */
function saveReportFile(report) {
  var bytes = Utilities.base64Decode(report.zipBase64)
  var blob = Utilities.newBlob(bytes, 'application/zip', report.zipName)
  return reportsFolder().createFile(blob).getUrl()
}

/**
 * Records one problem report: a row in the Reports tab, the zip in Drive and an
 * email to the owner. A Drive or mail failure never loses the row.
 */
function saveReport(report, now) {
  var tab = sheet(SHEETS.reports, REPORT_COLUMNS)
  var rows = rowsOf(tab, REPORT_COLUMNS.length)
  // The same reference again (the app retried): already saved.
  if (findRow(rows, 1, report.reportId) >= 0) return { ok: true, reportId: report.reportId }
  var link = ''
  try {
    link = saveReportFile(report)
  } catch (e) {
    Logger.log('Report file not saved: ' + e)
  }
  tab.appendRow([
    now,
    report.reportId,
    report.installId,
    safeCell(report.version),
    report.build,
    report.os,
    report.arch,
    safeCell(report.note.slice(0, 300)),
    safeCell(report.summary.slice(0, 500)),
    link || 'not saved',
    'new',
    '',
    ''
  ])
  try {
    var email = buildReportEmail(report, link)
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(), email.subject, email.body)
  } catch (e) {
    Logger.log('Report email not sent: ' + e)
  }
  return { ok: true, reportId: report.reportId }
}

function unsubscribe(email, now) {
  var tab = sheet(SHEETS.users, USER_COLUMNS)
  var rows = rowsOf(tab, USER_COLUMNS.length)
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][1]).toLowerCase() !== email) continue
    tab.getRange(i + 2, 6, 1, 2).setValues([[false, false]])
    tab.getRange(i + 2, 12).setValue(now.toISOString())
  }
}

/* ---------- Admin ---------- */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('CiteFox')
    .addItem('Set up (run once)', 'setup')
    .addItem('Active installs', 'showActiveInstalls')
    .addSeparator()
    .addItem('Send test email to me', 'sendTestEmail')
    .addItem('Send email to opted-in users', 'sendEmailToOptedIn')
    .addSeparator()
    .addItem('Delete a user by email…', 'deleteUserByEmail')
    .addItem('Delete a report by reference…', 'deleteReportByReference')
    .addToUi()
}

/** Makes the tabs and the script settings. Safe to run again. */
function setup() {
  sheet(SHEETS.users, USER_COLUMNS)
  sheet(SHEETS.installs, INSTALL_COLUMNS)
  sheet(SHEETS.sends, SEND_COLUMNS)
  sheet(SHEETS.reports, REPORT_COLUMNS)
  var compose = sheet(SHEETS.compose, null)
  if (compose.getLastRow() === 0) {
    compose.getRange(1, 1, 5, 2).setValues([
      ['Campaign', '2026-11-v0.13.0'],
      ['Audience', 'updates'],
      ['Subject', 'CiteFox v0.13.0 is out'],
      ['Body', 'Write the email here. Blank lines start a new paragraph.'],
      ['Mailing address', 'Space-O Technologies, your street, city, country']
    ])
    compose.setColumnWidth(2, 640)
  }
  var p = props()
  if (!p.getProperty('APP_TOKEN')) p.setProperty('APP_TOKEN', DEFAULT_APP_TOKEN)
  if (!p.getProperty('UNSUBSCRIBE_SECRET')) {
    p.setProperty('UNSUBSCRIBE_SECRET', Utilities.getUuid() + Utilities.getUuid())
  }
  return 'ready'
}

function activeInstalls(now) {
  var rows = rowsOf(sheet(SHEETS.installs, INSTALL_COLUMNS), INSTALL_COLUMNS.length)
  var at = now || new Date()
  return { last7: countActive(rows, at, 7), last30: countActive(rows, at, 30), total: rows.length }
}

/** Problem reports: all, in the last 7 days, and still marked "new". */
function reportCounts(now) {
  var rows = rowsOf(sheet(SHEETS.reports, REPORT_COLUMNS), REPORT_COLUMNS.length)
  var since = (now || new Date()).getTime() - 7 * 24 * 3600 * 1000
  var counts = { total: rows.length, last7: 0, unhandled: 0 }
  rows.forEach(function (r) {
    var at = new Date(r[0]).getTime()
    if (!isNaN(at) && at >= since) counts.last7++
    if (String(r[10]) === 'new') counts.unhandled++
  })
  return counts
}

function showActiveInstalls() {
  var counts = activeInstalls()
  var reports = reportCounts()
  var text =
    'Active in the last 7 days: ' +
    counts.last7 +
    '\nActive in the last 30 days: ' +
    counts.last30 +
    '\nAll installs ever: ' +
    counts.total +
    '\nProblem reports: ' +
    reports.total +
    ' (' +
    reports.last7 +
    ' in the last 7 days, ' +
    reports.unhandled +
    ' still new)'
  Logger.log(text)
  try {
    SpreadsheetApp.getUi().alert(text)
  } catch (e) {
    // Run from the editor: the log has it.
  }
  return counts
}

function listUsers() {
  var rows = rowsOf(sheet(SHEETS.users, USER_COLUMNS), USER_COLUMNS.length)
  rows.sort(function (a, b) {
    return new Date(b[7]).getTime() - new Date(a[7]).getTime()
  })
  rows.forEach(function (r) {
    Logger.log([r[7], r[1], r[2], r[3], r[4], 'updates=' + r[5], 'news=' + r[6]].join(' | '))
  })
  return rows
}

function readCompose() {
  var values = sheet(SHEETS.compose, null).getRange(1, 1, 5, 2).getValues()
  var get = function (label) {
    for (var i = 0; i < values.length; i++) if (values[i][0] === label) return String(values[i][1])
    return ''
  }
  var audience = get('Audience') === 'news' ? 'news' : 'updates'
  return {
    campaign: get('Campaign').trim(),
    audience: audience,
    subject: get('Subject').trim(),
    body: get('Body').trim(),
    address: get('Mailing address').trim()
  }
}

function sendOne(to, name, compose, secret, baseUrl) {
  var email = buildEmail({
    name: name,
    subject: compose.subject,
    body: compose.body,
    audience: compose.audience,
    address: compose.address,
    unsubscribe: unsubscribeLink(baseUrl, to, secret)
  })
  MailApp.sendEmail({
    to: to,
    subject: email.subject,
    body: email.text,
    htmlBody: email.html,
    name: 'CiteFox'
  })
}

function sendTestEmail() {
  var compose = readCompose()
  var me = Session.getEffectiveUser().getEmail()
  sendOne(
    me,
    'Test',
    compose,
    props().getProperty('UNSUBSCRIBE_SECRET') || 'test',
    ScriptApp.getService().getUrl()
  )
  return me
}

/**
 * Sends the Compose email to everyone opted in to its audience. Gmail's daily
 * limit (about 100 recipients on a free account) is read first; whoever is left
 * gets it when you run this again tomorrow, because the Sends tab remembers
 * who already got this campaign.
 */
function sendEmailToOptedIn() {
  var compose = readCompose()
  if (!compose.campaign || !compose.subject || !compose.body) {
    throw new Error('Fill in Campaign, Subject and Body in the Compose tab.')
  }
  var secret = props().getProperty('UNSUBSCRIBE_SECRET')
  if (!secret) throw new Error('Run Set up first.')
  var baseUrl = ScriptApp.getService().getUrl()
  var sendsTab = sheet(SHEETS.sends, SEND_COLUMNS)
  var sent = {}
  rowsOf(sendsTab, SEND_COLUMNS.length).forEach(function (r) {
    if (r[0] === compose.campaign) sent[String(r[1]).toLowerCase()] = true
  })
  var users = rowsOf(sheet(SHEETS.users, USER_COLUMNS), USER_COLUMNS.length)
  var recipients = pickRecipients(users, compose.audience, sent)
  var quota = MailApp.getRemainingDailyQuota()
  var batch = recipients.slice(0, Math.max(0, quota))
  batch.forEach(function (r) {
    sendOne(r.email, r.name, compose, secret, baseUrl)
    sendsTab.appendRow([compose.campaign, r.email, new Date().toISOString()])
  })
  var left = recipients.length - batch.length
  var text =
    'Sent ' +
    batch.length +
    '.' +
    (left > 0 ? ' ' + left + ' left: run this again tomorrow (daily Gmail limit).' : '')
  Logger.log(text)
  try {
    SpreadsheetApp.getUi().alert(text)
  } catch (e) {
    // Run from the editor.
  }
  return { sent: batch.length, left: left }
}

/** Removes every row for one email from Users and Sends (and their installs). */
function deleteUserByEmail(emailArg) {
  var email = typeof emailArg === 'string' ? emailArg : null
  if (email === null) {
    var ui = SpreadsheetApp.getUi()
    var answer = ui.prompt('Delete a CiteFox user', 'Their email address:', ui.ButtonSet.OK_CANCEL)
    if (answer.getSelectedButton() !== ui.Button.OK) return 0
    email = answer.getResponseText()
  }
  email = String(email).trim().toLowerCase()
  if (!isEmail(email)) throw new Error('That is not an email address.')
  var users = sheet(SHEETS.users, USER_COLUMNS)
  var installs = sheet(SHEETS.installs, INSTALL_COLUMNS)
  var sends = sheet(SHEETS.sends, SEND_COLUMNS)
  var ids = {}
  var removed = 0
  var userRows = rowsOf(users, USER_COLUMNS.length)
  for (var i = userRows.length - 1; i >= 0; i--) {
    if (String(userRows[i][1]).toLowerCase() === email) {
      ids[String(userRows[i][0])] = true
      users.deleteRow(i + 2)
      removed++
    }
  }
  var installRows = rowsOf(installs, INSTALL_COLUMNS.length)
  for (var j = installRows.length - 1; j >= 0; j--) {
    if (ids[String(installRows[j][0])]) installs.deleteRow(j + 2)
  }
  var sendRows = rowsOf(sends, SEND_COLUMNS.length)
  for (var k = sendRows.length - 1; k >= 0; k--) {
    if (String(sendRows[k][1]).toLowerCase() === email) sends.deleteRow(k + 2)
  }
  Logger.log('Deleted ' + removed + ' row(s) for ' + email)
  return removed
}

/** Removes one problem report: its Reports row, and its zip in Drive (moved to the trash). */
function deleteReportByReference(refArg) {
  var ref = typeof refArg === 'string' ? refArg : null
  if (ref === null) {
    var ui = SpreadsheetApp.getUi()
    var answer = ui.prompt(
      'Delete a CiteFox report',
      'Its reference (CF-XXXXXX):',
      ui.ButtonSet.OK_CANCEL
    )
    if (answer.getSelectedButton() !== ui.Button.OK) return 0
    ref = answer.getResponseText()
  }
  ref = String(ref).trim().toUpperCase()
  if (!/^CF-[A-HJ-KM-NP-Z2-9]{6}$/.test(ref)) throw new Error('That is not a report reference.')
  var tab = sheet(SHEETS.reports, REPORT_COLUMNS)
  var rows = rowsOf(tab, REPORT_COLUMNS.length)
  var removed = 0
  for (var i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][1]) !== ref) continue
    var link = String(rows[i][9])
    var match = /\/d\/([A-Za-z0-9_-]+)/.exec(link) || /[?&]id=([A-Za-z0-9_-]+)/.exec(link)
    if (match) {
      try {
        DriveApp.getFileById(match[1]).setTrashed(true)
      } catch (e) {
        Logger.log('Could not trash the file, delete it by hand in Drive: ' + link)
      }
    }
    tab.deleteRow(i + 2)
    removed++
  }
  Logger.log('Deleted ' + removed + ' report row(s) for ' + ref)
  return removed
}
