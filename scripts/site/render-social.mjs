#!/usr/bin/env node
// Draws the share images from one SVG design and renders them to PNG:
//   site/og.png                    1200 x 630  (Open Graph and Twitter cards)
//   .github/social-preview.png     1280 x 640  (GitHub › Settings › Social preview)
// The SVG sources are written next to them (og.svg, social-preview.svg) so the
// design can be edited by hand. Needs rsvg-convert (librsvg). Uses the app's own
// Inter fonts through a temporary fontconfig file.
//
//   node scripts/site/render-social.mjs
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REPO_ROOT } from './build-site.mjs'

const ENGINES = ['Google AI Overviews', 'ChatGPT', 'Perplexity', 'Gemini', 'Copilot', 'AI Mode']

/** The fox head from build/icon.svg, on its 1024 grid. */
const FOX = `
  <polygon points="262 226 424 360 600 360 762 226 790 500 824 600 512 812 200 600 234 500" fill="url(#fur)"/>
  <polygon points="278 276 396 372 262 444" fill="#7c2d12"/>
  <polygon points="746 276 628 372 762 444" fill="#7c2d12"/>
  <polygon points="200 600 384 556 512 768 512 812" fill="#ffffff"/>
  <polygon points="824 600 640 556 512 768 512 812" fill="#ffffff"/>
  <polygon points="466 752 558 752 512 812" fill="#16181d"/>
  <g fill="#16181d">
    <rect x="-38" y="-17" width="76" height="34" rx="17" transform="translate(410 520) rotate(24)"/>
    <rect x="-38" y="-17" width="76" height="34" rx="17" transform="translate(614 520) rotate(-24)"/>
  </g>`

export function socialSvg(width, height) {
  const pad = Math.round(width * 0.067)
  const s = height / 630
  const chipY = height - pad - 44 * s
  let x = pad
  const chips = ENGINES.map((name) => {
    const w = (name.length * 9.6 + 34) * s
    const chip = `<g transform="translate(${x.toFixed(1)} ${chipY.toFixed(1)})"><rect width="${w.toFixed(1)}" height="${(40 * s).toFixed(1)}" rx="${(20 * s).toFixed(1)}" fill="#3a2f25" stroke="#5a4a3a"/><text x="${(w / 2).toFixed(1)}" y="${(26 * s).toFixed(1)}" text-anchor="middle" font-size="${(17 * s).toFixed(1)}" font-weight="600" fill="#f3e9d8">${name}</text></g>`
    x += w + 10 * s
    return chip
  }).join('\n  ')
  const foxSize = 300 * s
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <!-- CiteFox share image. Made by scripts/site/render-social.mjs; edit there. -->
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2a221b"/>
      <stop offset="1" stop-color="#17130f"/>
    </linearGradient>
    <linearGradient id="fur" x1="0" y1="226" x2="0" y2="812" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#f26a1b"/>
      <stop offset="1" stop-color="#c2410c"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.82" cy="0.3" r="0.5">
      <stop offset="0" stop-color="#e0763f" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#e0763f" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <rect width="${width}" height="${height}" fill="url(#glow)"/>
  <g font-family="Inter, 'Noto Sans', sans-serif">
  <g transform="translate(${(width - pad - foxSize).toFixed(1)} ${(pad * 0.7).toFixed(1)}) scale(${(foxSize / 1024).toFixed(4)})">${FOX}
  </g>
  <text x="${pad}" y="${(pad + 70 * s).toFixed(1)}" font-size="${(84 * s).toFixed(1)}" font-weight="800" fill="#f3e9d8" letter-spacing="-1.5">CiteFox</text>
  <text x="${pad}" y="${(pad + 140 * s).toFixed(1)}" font-size="${(44 * s).toFixed(1)}" font-weight="700" fill="#f0915f">Free AI visibility tracker</text>
  <text x="${pad}" y="${(pad + 200 * s).toFixed(1)}" font-size="${(28 * s).toFixed(1)}" font-weight="500" fill="#dccdb6">Is your website cited in AI answers?</text>
  <text x="${pad}" y="${(pad + 240 * s).toFixed(1)}" font-size="${(28 * s).toFixed(1)}" font-weight="500" fill="#dccdb6">Track it, fix it, report it. Six client-ready reports.</text>
  <text x="${pad}" y="${(chipY - 22 * s).toFixed(1)}" font-size="${(19 * s).toFixed(1)}" font-weight="600" fill="#c4b49c">Free desktop app · Your own API keys · Your data stays on your computer</text>
  ${chips}
  </g>
</svg>
`
}

function render(svgPath, pngPath, env) {
  execFileSync('rsvg-convert', ['-o', pngPath, svgPath], { env, stdio: 'inherit' })
}

function main() {
  const temp = mkdtempSync(join(tmpdir(), 'citefox-og-'))
  try {
    const fonts = join(REPO_ROOT, 'src', 'renderer', 'src', 'assets', 'fonts')
    const conf = join(temp, 'fonts.conf')
    writeFileSync(
      conf,
      `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><include ignore_missing="yes">/etc/fonts/fonts.conf</include><dir>${fonts}</dir><cachedir>${join(temp, 'cache')}</cachedir></fontconfig>`
    )
    const env = { ...process.env, FONTCONFIG_FILE: conf }
    for (const [dir, name, w, h] of [
      ['site', 'og', 1200, 630],
      ['.github', 'social-preview', 1280, 640]
    ]) {
      const svg = join(REPO_ROOT, dir, `${name}.svg`)
      writeFileSync(svg, socialSvg(w, h))
      render(svg, join(REPO_ROOT, dir, `${name}.png`), env)
      console.log(`Wrote ${dir}/${name}.png (${w} x ${h})`)
    }
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

main()
