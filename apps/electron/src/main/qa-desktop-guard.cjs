// Packaged, disposable QA only. The test renderer can paint and accept CDP input,
// but it must not affect the login session's screen, pasteboard, or sound.
module.exports = function installQaDesktopGuard({ app, clipboard, Notification, Menu, shell, globalShortcut }) {
  const ignore = () => {}
  for (const name of ['write', 'writeText', 'writeHTML', 'writeRTF', 'writeBookmark', 'writeFindText', 'writeImage', 'writeBuffer', 'clear']) {
    if (typeof clipboard[name] === 'function') clipboard[name] = ignore
  }
  Notification.prototype.show = ignore
  Menu.prototype.popup = ignore
  shell.beep = ignore
  shell.openExternal = async () => { throw new Error('External app launches are disabled in background QA') }
  globalShortcut.register = () => false
  globalShortcut.registerAll = ignore

  app.on('will-finish-launching', () => app.setActivationPolicy('accessory'))
  app.on('web-contents-created', (_event, contents) => contents.setAudioMuted(true))
  app.on('browser-window-created', (_event, win) => {
    // All app windows use show:false. Never show one before opacity and focus are set.
    win.setOpacity(0)
    win.setIgnoreMouseEvents(true)
    win.setFocusable(false)
    win.show = () => { if (!win.isDestroyed()) win.showInactive() }
    win.focus = ignore
  })
  app.focus = ignore
  process.stderr.write('[veto-qa] background desktop guard active\n')
}
