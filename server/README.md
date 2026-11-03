# CiteFox registration backend (Google Apps Script)

"Join CiteFox", the daily version ping and the update emails run on a free Google Apps Script
bound to a Google Sheet, owned by the CiteFox Gmail account. No server to pay for, no SMTP
password anywhere: the script sends mail as that Gmail account. What is collected and why:
`Docs/PRIVACY.md`.

Files:

- `apps-script/Code.gs`: the whole script (web app + admin menu). Paste it as one file.
- `apps-script/appsscript.json`: the project manifest (time zone, V8, web app access, and the
  permissions the script asks for; see "Permissions" below).

The script logic is unit-tested in `src/main/account/apps-script.test.ts` (it runs `Code.gs`
with fake Google services).

## One-time setup (about 10 minutes)

1. **Gmail.** Create the CiteFox Gmail account (for example `citefox.app@gmail.com`) and sign
   in to it in a browser. Everything below is done as this account.
2. **Sheet.** Open https://sheets.new and name the sheet `CiteFox users`.
3. **Script.** In the sheet: **Extensions › Apps Script**. Name the project `CiteFox backend`.
   - Delete the sample code in `Code.gs` and paste all of `server/apps-script/Code.gs`.
   - **Project Settings** (gear) › tick **Show "appsscript.json" manifest file in editor**,
     open `appsscript.json` and replace it with `server/apps-script/appsscript.json`.
   - Save (Ctrl S / ⌘S).
4. **Run Set up once.** In the editor pick the `setup` function and press **Run**. Google asks
   for permission: choose the CiteFox account, **Advanced › Go to CiteFox backend (unsafe)** (it
   is your own script) › **Allow**. This makes the tabs `Users`, `Installs`, `Sends`,
   `Compose` and `Reports`, and the script settings `APP_TOKEN` and `UNSUBSCRIBE_SECRET`.
5. **Deploy as a web app.** **Deploy › New deployment** › type **Web app**:
   - Description: `CiteFox v1`
   - Execute as: **Me** (the CiteFox account)
   - Who has access: **Anyone**
   - **Deploy**, then copy the **Web app URL**. It looks like
     `https://script.google.com/macros/s/AKfy…/exec`.
6. **Mailing address.** In the `Compose` tab, put your business mailing address next to
   `Mailing address`. Canada's CASL needs it in every commercial email.
7. **Build CiteFox with the URL.** Set the environment variable when building a release:

   ```sh
   CITEFOX_REGISTER_URL="https://script.google.com/macros/s/AKfy…/exec" npm run dist
   ```

   In GitHub Actions, add a repository **variable** (not a secret is fine, it is public)
   `CITEFOX_REGISTER_URL` and pass it to the build step's `env`. To test locally:
   `CITEFOX_REGISTER_URL=… npm run dev`.

Optional: to use your own token, set the script property `APP_TOKEN` (Project Settings ›
Script properties) to 8–128 letters, digits, `.`, `_` or `-`, and build with the same value in
`CITEFOX_REGISTER_TOKEN`. The default is `citefox-public-v1`. The token ships inside the app,
so treat it as public: it only keeps random traffic out. Abuse is limited by input checks and
rate limits.

## Update the script (6 steps, about 5 minutes)

Do this each time a new `Code.gs` is released. You do not need to be a developer.

1. **Open the script.** Open the `CiteFox users` Sheet, then **Extensions › Apps Script**.
2. **Replace the code.** Click `Code.gs`, select everything (Ctrl A / ⌘A), delete it, and paste all of
   `server/apps-script/Code.gs`. Then open `appsscript.json` (if you cannot see it: **Project
   Settings** (gear) › tick **Show "appsscript.json" manifest file in editor**), select all and
   paste all of `server/apps-script/appsscript.json`. Save (Ctrl S / ⌘S).
3. **Run `setup` once.** In the function list at the top pick `setup`, press **Run**. Google asks
   for the new permissions (Drive files and sending email). Click **Review permissions**, pick the
   CiteFox account, and you will see a warning "Google hasn't verified this app". That is normal:
   it is your own script. Click **Advanced › Go to CiteFox backend (unsafe) › Allow**. When the
   log says "Execution completed", the new `Reports` tab exists.
4. **Publish the new version, on the same address.** **Deploy › Manage deployments**, click the
   pencil (edit) on the existing deployment, set **Version** to **New version**, press **Deploy**.
   The web app address stays the same. **Never use "New deployment" for an update**: it makes a
   new address and every installed app would stop reaching the script.
5. **Test it.** Reload the Sheet and check the **CiteFox** menu now shows **Delete a report by
   reference…**. Run **Send test email to me** (it also proves the new mail permission works).
   In CiteFox, open **Report a problem**, write "test" and press **Send to CiteFox**.
6. **Check where it landed** (next section). Then delete the test report with **CiteFox › Delete a
   report by reference…**.

If step 5 sends nothing, open **Executions** in the Apps Script editor (left bar) and read the
error. A "not saved" in the Reports tab's `File` column means Drive refused: run `setup` again
and click Allow on every screen.

## Problem reports ("Report a problem" › "Send to CiteFox")

A user's report goes to three places, all private to the CiteFox account:

- **Reports tab** in the Sheet: one row per report (Received, Reference, Install, Version, Build,
  OS, Arch, a short Note and Summary, a link to the File, Status `new`, and empty `Handled by`
  and `Notes` columns for you). Change `Status` and fill `Handled by` as you work; do not rename or
  reorder the columns.
- **Drive folder `CiteFox reports`**: the zip, named after the reference (`CF-XXXXXX.zip`). The
  script makes the folder the first time and remembers it (script property `REPORTS_FOLDER_ID`).
  Files are private. Never share the folder: the zip holds logs from a user's computer.
- **Email** to the CiteFox account: subject `[CiteFox report] CF-XXXXXX`, plain text, with the
  reference, version, system, the note, the start of the summary and the Drive link.

If Drive or email fails, the Sheet row is still written (`File` says `not saved`) and the user
still gets a success reply.

**Delete a report** (a privacy request, or after you fixed it): **CiteFox › Delete a report by
reference…**, type the reference (`CF-XXXXXX`). The row is removed and the Drive file goes to the
Drive trash (empty the trash to remove it for good). Run from the editor:
`deleteReportByReference('CF-XXXXXX')`.

**Limits and quotas.**

- Per install: 3 reports an hour and 10 a day. Everyone together: 200 a day. Above that the app
  gets the error `rate`. The hourly limit uses the script cache. The two daily limits count the rows
  of the last 24 hours in the `Reports` tab, so do not delete rows to "reset" them unless you mean to.
- One zip is at most about 2.6 MB (3.5 million characters as sent). Larger ones are refused
  (`size`). A report body can be 3.6 million characters; register and ping bodies stay at 10,000.
- Google daily quotas on a free account: about 100 emails a day (shared with update emails: a
  burst of reports can use the quota that "Send email to opted-in users" needs), and a Drive
  storage limit of 15 GB shared with Gmail. 200 reports a day at 2.6 MB is the worst case, about
  0.5 GB a day, so empty the Drive folder from time to time. Check **Executions** in the editor if
  email stops: it will say "Service invoked too many times".
- **Abuse.** The token ships inside the app, so anyone can read it and post to the address. The
  checks above (ZIP signature, size, per-install and global limits) are the only protection. A
  person who makes a new fake install id for every post can still send 200 files a day and use up
  the mail quota. If that happens: set a new `APP_TOKEN` (see above), build and release the app
  with it, and delete the junk rows and the Drive files.

## Permissions (`appsscript.json` › `oauthScopes`)

The manifest lists exactly what the script needs and nothing broader:

- `spreadsheets`: read and write the tabs of this Sheet.
- `drive.file`: create and trash only the folder and the files this script made itself. It cannot
  see anything else in the Drive. (The full `drive` permission is not asked for.)
- `script.send_mail`: send the update emails and the report notification.
- `script.container.ui`: the **CiteFox** menu and its dialogs inside the Sheet.
- `userinfo.email`: read the CiteFox account's own address, to send the notification to it.

The script does not call other websites, so `script.external_request` is not listed.

## Everyday use (the CiteFox menu in the Sheet)

Reload the Sheet once after setup to see the **CiteFox** menu.

- **Active installs**: installs that pinged in the last 7 and 30 days, and how many problem
  reports came in (all, last 7 days, still `new`).
- **Send test email to me**: sends the `Compose` email to the CiteFox account only.
- **Send email to opted-in users**: sends the `Compose` email to everyone who ticked its
  audience: `updates` ("Product updates") or `news` ("Occasional news and offers"). Each
  address gets it once per `Campaign` name (the `Sends` tab remembers). A free Gmail account
  can send to about 100 people a day; the script stops at the limit and tells you how many
  are left. Run it again the next day to continue. Use a new `Campaign` name for each email.
- **Delete a user by email…**: for a privacy request. Removes their rows, their install's
  pings and their sends.
- **Delete a report by reference…**: removes one problem report (row and Drive file).

From the editor you can also run `listUsers` (newest first, in the log) and
`showActiveInstalls`.

The `Users` tab is the list of everyone who joined; you can sort or filter it, but do not
rename or reorder its columns.

## What the app sends

`POST` with a JSON body, always with `token`:

```json
{ "kind": "register", "installId": "…", "name": "…", "email": "…", "company": "…",
  "role": "agency | in-house | solo", "productUpdates": true, "news": false,
  "version": "0.13.0", "build": 1500, "os": "darwin | win32 | linux", "arch": "arm64" }

{ "kind": "ping", "installId": "…", "day": "2026-11-02", "version": "0.13.0",
  "build": 1500, "os": "darwin", "arch": "arm64" }

{ "kind": "report", "reportId": "CF-ABC234", "installId": "…", "version": "0.13.2",
  "build": 1500, "os": "darwin", "arch": "arm64", "note": "…", "summary": "…",
  "zipName": "CF-ABC234.zip", "zipBase64": "UEsDB…" }
```

The script answers `{ "ok": true }` (a report: `{ "ok": true, "reportId": "CF-ABC234" }`) or
`{ "ok": false, "error": "invalid | size | token | rate | busy | failed" }`. `size` is a zip over
the limit, `failed` is a Sheet write that went wrong. A `reportId` is `CF-` plus 6 characters from
`A-HJ-KM-NP-Z2-9`; the zip must start with the ZIP signature `PK` and `zipName` must be
`reportId + ".zip"`. Limits: 5 registrations per install per hour, 4 pings per install per 6
hours, 3 reports per install per hour and 10 a day, 200 reports a day in total, 120 calls a
minute in total.

## Moving to a custom domain later

Nothing in the app depends on Gmail. To send from `updates@yourdomain.com`, either add it as a
"Send mail as" alias in the Gmail account (MailApp then still sends as the Gmail address; use
`GmailApp.sendEmail(…, { from: alias })` instead), or move the Sheet and script to a Google
Workspace account on that domain and redeploy. If the web app URL changes, ship a release built
with the new `CITEFOX_REGISTER_URL`; older installs keep using the old URL, so keep the old
deployment running until most people have updated.
