# CiteFox registration backend (Google Apps Script)

"Join CiteFox", the daily version ping and the update emails run on a free Google Apps Script
bound to a Google Sheet, owned by the CiteFox Gmail account. No server to pay for, no SMTP
password anywhere: the script sends mail as that Gmail account. What is collected and why:
`Docs/PRIVACY.md`.

Files:

- `apps-script/Code.gs`: the whole script (web app + admin menu). Paste it as one file.
- `apps-script/appsscript.json`: the project manifest (time zone, V8, web app access).

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
   is your own script) › **Allow**. This makes the tabs `Users`, `Installs`, `Sends` and
   `Compose`, and the script settings `APP_TOKEN` and `UNSUBSCRIBE_SECRET`.
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

## Updating the script

Paste the new `Code.gs`, save, then **Deploy › Manage deployments** › edit (pencil) the
existing deployment › Version: **New version** › **Deploy**. The URL stays the same, so
released apps keep working. Never make a *new* deployment for an update: that makes a new URL.

## Everyday use (the CiteFox menu in the Sheet)

Reload the Sheet once after setup to see the **CiteFox** menu.

- **Active installs**: installs that pinged in the last 7 and 30 days.
- **Send test email to me**: sends the `Compose` email to the CiteFox account only.
- **Send email to opted-in users**: sends the `Compose` email to everyone who ticked its
  audience: `updates` ("Product updates") or `news` ("Occasional news and offers"). Each
  address gets it once per `Campaign` name (the `Sends` tab remembers). A free Gmail account
  can send to about 100 people a day; the script stops at the limit and tells you how many
  are left. Run it again the next day to continue. Use a new `Campaign` name for each email.
- **Delete a user by email…**: for a privacy request. Removes their rows, their install's
  pings and their sends.

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
```

The script answers `{ "ok": true }` or `{ "ok": false, "error": "invalid | token | rate | busy" }`.
Limits: 5 registrations per install per hour, 4 pings per install per 6 hours, 120 calls a
minute in total.

## Moving to a custom domain later

Nothing in the app depends on Gmail. To send from `updates@yourdomain.com`, either add it as a
"Send mail as" alias in the Gmail account (MailApp then still sends as the Gmail address; use
`GmailApp.sendEmail(…, { from: alias })` instead), or move the Sheet and script to a Google
Workspace account on that domain and redeploy. If the web app URL changes, ship a release built
with the new `CITEFOX_REGISTER_URL`; older installs keep using the old URL, so keep the old
deployment running until most people have updated.
