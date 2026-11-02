// Runs before the page paints (a classic script in <head>): sets the first
// <html data-theme> so a dark or sepia window never flashes light. With no
// saved choice it starts in sepia, the default. Main sets
// nativeTheme.themeSource from Settings › Appearance before the window loads,
// so prefers-color-scheme already is the chosen light or dark; sepia is not a
// system mode, so the renderer keeps the last choice in localStorage
// ('citefox.theme', src/theme/themeStore.ts), which takes over once the app starts.
;(function () {
  try {
    var saved = window.localStorage.getItem('citefox.theme')
    if (saved === 'sepia' || saved === 'light' || saved === 'dark') {
      document.documentElement.dataset.theme = saved
      return
    }
    // Nothing chosen yet: the default is sepia (DEFAULT_THEME in shared/domain/settings.ts).
    if (saved === null) {
      document.documentElement.dataset.theme = 'sepia'
      return
    }
    var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  } catch {
    document.documentElement.dataset.theme = 'light'
  }
})()
