/**
 * CiteFox registration and update emails: a Google Apps Script web app bound
 * to a Google Sheet, owned by the CiteFox Gmail account. Setup: server/README.md.
 *
 * The desktop app sends two kinds of POST (JSON body, always with `token`):
 *   { kind: 'register', installId, name, email, company, role, productUpdates, news, version, build, os, arch }
 *   { kind: 'ping', installId, day, version, build, os, arch }
 * and reads `{ ok: true }` or `{ ok: false, error }`. Apps Script cannot send an
 * HTTP status, so errors travel in the body.
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
 */

/* ---------- Settings ---------- */

var SHEETS = {
  users: 'Users',
  installs: 'Installs',
  compose: 'Compose',
  sends: 'Sends'
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

var LIMITS = { name: 100, email: 254, company: 120, version: 40, os: 20, arch: 20 }
var ROLES = ['agency', 'in-house', 'solo']
var OS_NAMES = ['darwin', 'win32', 'linux']

/** Per install: at most this many calls of a kind in the window (seconds). */
var RATE = {
  register: { max: 5, seconds: 3600 },
  ping: { max: 4, seconds: 21600 },
  /** Everyone together, per minute: keeps a flood off the Sheet and the quota. */
  all: { max: 120, seconds: 60 }
}

var DEFAULT_APP_TOKEN = 'citefox-public-v1'

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

/** Parses the POST body; null when it is not a JSON object. */
function parseBody(text) {
  if (typeof text !== 'string' || text.length > 10000) return null
  try {
    var value = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
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
  cache.put(key, String(used + 1), rule.seconds)
  return true
}

function doPost(e) {
  var body = parseBody(e && e.postData ? e.postData.contents : null)
  if (body === null) return json({ ok: false, error: 'invalid' })
  if (body.token !== appToken()) return json({ ok: false, error: 'token' })
  if (body.kind !== 'register' && body.kind !== 'ping') return json({ ok: false, error: 'invalid' })
  var checked = body.kind === 'register' ? validateRegister(body) : validatePing(body)
  if (!checked.ok) return json(checked)
  if (!allow('all', 'everyone') || !allow(body.kind, checked.value.installId)) {
    return json({ ok: false, error: 'rate' })
  }
  var lock = LockService.getScriptLock()
  if (!lock.tryLock(10000)) return json({ ok: false, error: 'busy' })
  try {
    if (body.kind === 'register') saveUser(checked.value, new Date())
    else saveInstall(checked.value, new Date())
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
    .addToUi()
}

/** Makes the tabs and the script settings. Safe to run again. */
function setup() {
  sheet(SHEETS.users, USER_COLUMNS)
  sheet(SHEETS.installs, INSTALL_COLUMNS)
  sheet(SHEETS.sends, SEND_COLUMNS)
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

function showActiveInstalls() {
  var counts = activeInstalls()
  var text =
    'Active in the last 7 days: ' +
    counts.last7 +
    '\nActive in the last 30 days: ' +
    counts.last30 +
    '\nAll installs ever: ' +
    counts.total
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
