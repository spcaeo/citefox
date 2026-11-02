/* eslint-disable @typescript-eslint/explicit-function-return-type -- plain JavaScript, no type annotations */
// Screenshot zoom: every thumbnail link (`a[data-zoom]` around an <img>) opens
// the full-size image in a modal dialog over the page. Close with Esc, the ×
// button or a click outside the image; arrow keys (and the ‹ › buttons) move
// to the previous and next screenshot on the page. Focus goes back to the
// thumbnail of the image last shown. Without JavaScript the link simply opens
// the image. Animations live in download.css under prefers-reduced-motion.

const CLOSE_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
const PREV_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>'
const NEXT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>'

function iconButton(doc, cls, label, icon) {
  const button = doc.createElement('button')
  button.type = 'button'
  button.className = `lb-btn ${cls}`
  button.setAttribute('aria-label', label)
  button.innerHTML = icon
  return button
}

/** Wires every `a[data-zoom]` in the page. Returns the dialog (or null with no thumbnails). */
export function initLightbox(doc) {
  const links = [...doc.querySelectorAll('a[data-zoom]')].filter((a) => a.querySelector('img'))
  if (links.length === 0) return null

  const dialog = doc.createElement('dialog')
  dialog.className = 'lightbox'
  dialog.setAttribute('aria-label', 'Screenshot')
  const figure = doc.createElement('figure')
  figure.className = 'lb-figure'
  const img = doc.createElement('img')
  img.className = 'lb-img'
  img.alt = ''
  const caption = doc.createElement('figcaption')
  caption.className = 'lb-caption'
  caption.id = 'lb-caption'
  dialog.setAttribute('aria-describedby', 'lb-caption')
  figure.append(img, caption)
  const close = iconButton(doc, 'lb-close', 'Close', CLOSE_ICON)
  const prev = iconButton(doc, 'lb-prev', 'Previous screenshot', PREV_ICON)
  const next = iconButton(doc, 'lb-next', 'Next screenshot', NEXT_ICON)
  dialog.append(figure, close)
  if (links.length > 1) dialog.append(prev, next)
  doc.body.append(dialog)

  let index = 0

  const show = (i) => {
    index = (i + links.length) % links.length
    const thumb = links[index].querySelector('img')
    img.src = links[index].getAttribute('href')
    img.alt = thumb.getAttribute('alt') || ''
    const count = links.length > 1 ? ` (${index + 1} of ${links.length})` : ''
    caption.textContent = `${img.alt}${count}`
  }

  const isOpen = () => dialog.hasAttribute('open')

  const open = (i) => {
    show(i)
    if (isOpen()) return
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    doc.documentElement.classList.add('lb-locked')
    close.focus()
  }

  const shut = () => {
    if (!isOpen()) return
    if (typeof dialog.close === 'function') dialog.close()
    dialog.removeAttribute('open')
    doc.documentElement.classList.remove('lb-locked')
    links[index].focus()
  }

  links.forEach((link, i) => {
    link.setAttribute('aria-haspopup', 'dialog')
    link.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button > 0) return
      event.preventDefault()
      open(i)
    })
  })

  close.addEventListener('click', shut)
  prev.addEventListener('click', () => show(index - 1))
  next.addEventListener('click', () => show(index + 1))
  // A click on the overlay (outside the image and the buttons) closes.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog || event.target === figure) shut()
  })
  // The browser's own Esc handling closes <dialog>; route it through shut() so focus returns.
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault()
    shut()
  })
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      shut()
    } else if (event.key === 'ArrowRight' && links.length > 1) {
      event.preventDefault()
      show(index + 1)
    } else if (event.key === 'ArrowLeft' && links.length > 1) {
      event.preventDefault()
      show(index - 1)
    }
  })
  return dialog
}
