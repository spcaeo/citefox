# Privacy

CiteFox is a desktop app. Your projects, pages, questions, check results, reports and keys stay
on your computer. This page lists the only things CiteFox sends to Space-O Technologies, why,
and how to have them deleted.

## What is sent

CiteFox sends two kinds of message to a small Google Apps Script owned by the CiteFox Gmail
account (source: `server/apps-script/Code.gs`). They are stored in a Google Sheet that only the
owner can open.

### 1. Join CiteFox (once, and when you edit your details)

| Field | Why |
| --- | --- |
| Name, work email, company (optional) | To know who uses CiteFox and to email you if you asked for it |
| Who the reports are for (clients, my company, my own sites) | To understand how CiteFox is used |
| "Product updates" ticked or not | Emails about new versions, only if ticked |
| "Occasional news and offers" ticked or not | A few other emails, only if ticked |
| A random install id | To update your details instead of adding a second row |
| CiteFox version, operating system | To know which versions are in use |

Both boxes start ticked on the Join screen, and you can untick either one before you join. You can
change them at any time in **Settings › App settings › Data & about › Your CiteFox account**, or
with the unsubscribe link in any email.

### 2. A daily version ping (at most once a day)

The random install id, the CiteFox version and build number, the operating system and the
processor type (for example `arm64`). No name, email, project, site, question or result. It
lets the owner count how many copies are in use over the last 7 and 30 days. The install id
is the same one sent with Join CiteFox, so the owner can see which versions joined people run.

### What is never sent

Your sites, pages, questions, AI answers, check results, reports, competitors, API keys,
passwords, email settings or anything else in a project. Join CiteFox and the ping are the
only messages CiteFox itself sends to the owner.

## The update check

CiteFox reads the public GitHub Releases page of its own repository (`api.github.com`) to see
whether a newer version exists: automatically about twice a day in an installed app, and when
you choose **Check for updates** in the ⚙ menu. This is a plain read, like opening the page in
a browser: nothing about you or your data is sent. GitHub's own privacy policy applies to that
request.

## Report a problem

**Help › Report a problem…** (also in **Settings › App settings › Data & about**, and next to a
failed check) builds a text report on your computer and shows you exactly what is in it. CiteFox
never sends it by itself. It is shared only when you press a button:

- **Send to CiteFox** sends it to us (see the next section) after you tick the consent line.
- **Copy report** puts it on your clipboard.
- **Save as file…** writes a text file where you choose.
- **Email it to us** and **Open a GitHub issue** copy the report first, then open your mail program
  or your browser with a short message (a link cannot carry a whole report). You paste the report
  yourself. A GitHub issue is public; email is not.

What the report contains: the CiteFox version and build, your system type and version, language and
time zone, which AI program is set up (its file name only), whether each kind of key is set up
(yes or no), the latest failed checks (engine, reason and time) and the last 300 lines of
`citefox.log`.

What it never contains: any API key or part of one, email addresses, IP addresses, your user name or
home folder (a path shows as `~/…`), and the text of your questions unless you tick **Include my
question texts**. The text is cleaned in CiteFox before it is shown, and again before it is saved.

## Send to CiteFox (a problem report)

**Report a problem** has a button, **Send to CiteFox**. It is the only way CiteFox sends a report
to us, and it needs two things from you: a tick on "I understand this report (shown above) is
sent to the CiteFox team at Space-O Technologies" and a click on the button. CiteFox never sends
a report by itself.

What is sent is exactly the report you see in the drawer, plus the same cleaned log and a small
file of facts, in one zip: `report.txt` (the text you see), `citefox.log` (the end of the log,
up to 400 KB, with keys, emails, IP addresses and your home folder removed) and `environment.json`
(version, system, which AI program and keys are set up as yes or no, and counts of failed checks).
With it go your note, a random reference such as `CF-7K2M9Q`, the random install id, and the
CiteFox version, build, system and processor type. Question texts are included only if you ticked
**Include my question texts**. Keys, email addresses, IP addresses and your user name are never
included.

Where it goes: the same Google Apps Script as Join CiteFox, into a private Google Sheet and Drive
folder owned by the CiteFox Gmail account. Only the owner can open them. A report is used only to
find and fix the problem. If the send fails (for example offline), nothing is lost: save the report
as a file or email it to **getcitifox@gmail.com**.

Deletion: email **getcitifox@gmail.com** and quote your reference (`CF-…`); the row and the zip
are deleted.

## Offline

If the computer is offline when you join, CiteFox lets you in, keeps your details on this
computer (`account.json` in the CiteFox data folder) and sends them later.

## Builds without registration

A build made without `CITEFOX_REGISTER_URL` (for example a developer build or a fork) shows no
Join step and sends nothing at all.

## Emails

Emails are sent from the CiteFox Gmail account through the Apps Script. Every email says why
you get it and has an unsubscribe link that turns off both kinds of email for your address at
once.

## Deleting your details

Email **getcitifox@gmail.com** from the address you joined with and ask for your details to be deleted. The
owner runs **CiteFox › Delete a user by email…** in the Sheet (the `deleteUserByEmail` function
in `Code.gs`), which removes your rows, your install's pings and the record of emails sent to
you. To stop CiteFox from sending anything again, uninstall it or delete `account.json` from
the data folder (you will be asked to join again on the next start).

## Who

Space-O Technologies (https://www.spaceo.ca). The registration and update notices are
"Attribution Elements" under the CiteFox license (see `LICENSE`).

## Questions

Write to **getcitifox@gmail.com**. CiteFox is made by Space-O Technologies (https://www.spaceo.ca).
