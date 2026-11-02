# Sponsors

CiteFox is free, source-available and runs on your own computer. Sponsors pay for its
development, so it can stay that way.

| Tier   | Sponsor                                   | What they do                                                 |
| ------ | ----------------------------------------- | ------------------------------------------------------------ |
| Gold   | [FoxCue](https://foxcue.com/)             | Get cited in AI answers, with you on camera.                 |
| Silver | [FreshlyCited](https://freshlycited.com/) | Help Google and Bing find your new and updated pages sooner. |

## Where they appear in the app

- **Gold**: a card at the end of every screen, after its content, in the main scroll area (a slim
  strip on the first-run start screens). "Hide for now" (✕) folds it to a thin line until the next
  launch.
- **Silver**: a small card at the foot of the sidebar (only the mark in the collapsed sidebar).
- Both are listed in **Settings › About**.

Sponsor placements never cover content, do not move or flash, and do not appear in the first-run
onboarding screens.

## Privacy

CiteFox sends sponsors nothing about you, your projects or your usage.

- A sponsor link is the sponsor's home page plus `utm_source=citefox&utm_medium=app&utm_campaign=sponsor`,
  and nothing else. It opens in your browser.
- Logos are bundled with the app (`src/renderer/src/assets/sponsors`). Nothing is loaded from a
  sponsor, and there are no tracking pixels or remote images.
- Everything about the sponsors (names, links, words, colours) is in one file:
  `src/shared/sponsors.ts`.

## A request to forks

The CiteFox Source-Available License requires every copy you share to keep the sponsor slots,
their links and the partner links exactly as they are: they are how this project is paid for.
Keep `LICENSE` and `NOTICE` intact too.

## Becoming a sponsor

Open an issue on the repository or write to getcitifox@gmail.com.
