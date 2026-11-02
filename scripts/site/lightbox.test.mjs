// The screenshot zoom (site/lightbox.js) in a simulated page: opens from a
// thumbnail, shows the alt text, moves with the arrow keys, closes with Esc,
// the × button or a click outside, and gives focus back to the thumbnail.
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Window } from 'happy-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { REPO_ROOT } from './build-site.mjs'

const { initLightbox } = await import(pathToFileURL(join(REPO_ROOT, 'site', 'lightbox.js')).href)

const thumb = (name, alt) =>
  `<figure class="shot"><a class="zoom" href="media/${name}" data-zoom><img src="media/${name}" alt="${alt}" /></a></figure>`

let doc, window, dialog, links
beforeEach(() => {
  window = new Window({ url: 'https://example.test/' })
  doc = window.document
  doc.body.innerHTML = `${thumb('a.png', 'First screen')}${thumb('b.png', 'Second screen')}${thumb('c.png', 'Third screen')}<video class="shot"></video>`
  dialog = initLightbox(doc)
  links = [...doc.querySelectorAll('a[data-zoom]')]
})

const key = (k) =>
  dialog.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true }))
const shown = () => dialog.querySelector('.lb-img').getAttribute('src')
const caption = () => dialog.querySelector('.lb-caption').textContent

describe('screenshot zoom', () => {
  it('opens a labelled dialog with the full image and its alt text as the caption', () => {
    links[1].click()
    expect(dialog.hasAttribute('open')).toBe(true)
    expect(dialog.tagName).toBe('DIALOG')
    expect(dialog.getAttribute('aria-label')).toBe('Screenshot')
    expect(shown()).toBe('media/b.png')
    expect(dialog.querySelector('.lb-img').getAttribute('alt')).toBe('Second screen')
    expect(caption()).toBe('Second screen (2 of 3)')
    expect(doc.activeElement).toBe(dialog.querySelector('.lb-close'))
  })

  it('moves with the arrow keys and wraps around', () => {
    links[0].click()
    key('ArrowRight')
    expect(shown()).toBe('media/b.png')
    key('ArrowLeft')
    key('ArrowLeft')
    expect(shown()).toBe('media/c.png')
    expect(caption()).toBe('Third screen (3 of 3)')
  })

  it('closes with Esc and gives focus back to the thumbnail last shown', () => {
    links[0].click()
    key('ArrowRight')
    key('Escape')
    expect(dialog.hasAttribute('open')).toBe(false)
    expect(doc.activeElement).toBe(links[1])
  })

  it('closes with the × button and with a click outside the image', () => {
    links[2].click()
    dialog.querySelector('.lb-close').click()
    expect(dialog.hasAttribute('open')).toBe(false)
    expect(doc.activeElement).toBe(links[2])
    links[0].click()
    dialog.querySelector('.lb-img').click()
    expect(dialog.hasAttribute('open')).toBe(true)
    dialog.click()
    expect(dialog.hasAttribute('open')).toBe(false)
  })

  it('has labelled previous and next buttons, and none for a single screenshot', () => {
    expect(dialog.querySelector('.lb-prev').getAttribute('aria-label')).toBe('Previous screenshot')
    links[0].click()
    dialog.querySelector('.lb-next').click()
    expect(shown()).toBe('media/b.png')

    doc.body.innerHTML = thumb('a.png', 'Only screen')
    const single = initLightbox(doc)
    expect(single.querySelector('.lb-prev')).toBeNull()
    doc.querySelector('a[data-zoom]').click()
    expect(single.querySelector('.lb-caption').textContent).toBe('Only screen')
  })

  it('does nothing on a page without screenshots', () => {
    doc.body.innerHTML = '<p>No images</p>'
    expect(initLightbox(doc)).toBeNull()
  })
})
