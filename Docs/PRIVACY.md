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

Both boxes start unticked. You can change them at any time in **Settings › App settings ›
Data & about › Your CiteFox account**, or with the unsubscribe link in any email.

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
