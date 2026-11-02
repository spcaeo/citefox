// Docs and glossary pages: the shared copy icon for values written in the page
// (the contact email in the footer) and the screenshot zoom. The home and
// download pages do the same in app.js.
import { initLightbox } from './lightbox.js'
import { enhanceCopyables } from './release.js'

enhanceCopyables(document)
initLightbox(document)
