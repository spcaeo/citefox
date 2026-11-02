import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { loadUiFonts } from './fontsReady'
import { startThemeSync } from './theme/themeStore'
import './styles.css'

// Light, dark or system (Settings › Appearance) before anything renders.
startThemeSync()

const root = document.getElementById('root')
if (!root) {
  throw new Error('Root element #root is missing')
}

// Fonts first, so measured layouts see Inter (bounded wait; local files).
void loadUiFonts().then(() => {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
})
