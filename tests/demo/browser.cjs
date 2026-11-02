// A bare Electron window used as the headless browser for the web demo checks
// (tests/demo/*.e2e.ts, run inside Docker only). It opens CITEFOX_DEMO_URL with
// no preload and no Node, like a normal web page.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- a plain CommonJS Electron entry
const { app, BrowserWindow } = require('electron')

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    // Inside Docker's virtual display: shown, so layout and timers run as on a desktop.
    show: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  void win.loadURL(process.env.CITEFOX_DEMO_URL || 'about:blank')
})

app.on('window-all-closed', () => app.quit())
