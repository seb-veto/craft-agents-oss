import { test, expect } from 'bun:test'
import { EventEmitter } from 'node:events'

const install = require('../qa-desktop-guard.cjs')

test('background QA suppresses native effects and never shows a window before making it invisible', async () => {
  const calls: unknown[][] = []
  const record = (...args: unknown[]) => calls.push(args)
  const app = Object.assign(new EventEmitter(), { setActivationPolicy: record, focus: record })
  const clipboard = { writeText: record, writeImage: record, write: record, clear: record, readText: () => 'fixture' }
  // Match Electron's native methods on the prototype.
  class NativeNotification { show() { record('notification') } }
  class Menu { popup() { record('menu') } }
  const shell = { beep: record, openExternal: async () => { record('external') } }
  const globalShortcut = { register: () => true, registerAll: record }
  install({ app, clipboard, Notification: NativeNotification, Menu, shell, globalShortcut })
  const win = {
    setOpacity: (value: number) => record('opacity', value),
    setIgnoreMouseEvents: (value: boolean) => record('ignoreMouse', value),
    setFocusable: (value: boolean) => record('focusable', value),
    showInactive: () => record('inactive'),
    isDestroyed: () => false,
    show: () => record('show'),
    focus: () => record('focus'),
  }
  app.emit('will-finish-launching')
  app.emit('web-contents-created', {}, { setAudioMuted: (value: boolean) => record('muted', value) })
  app.emit('browser-window-created', {}, win)
  win.show()
  win.focus()
  app.focus()
  clipboard.writeText('synthetic text')
  clipboard.writeImage('synthetic image')
  clipboard.write({ text: 'synthetic text' })
  clipboard.clear()
  new NativeNotification().show()
  new Menu().popup()
  shell.beep()
  await expect(shell.openExternal()).rejects.toThrow('disabled')
  expect(globalShortcut.register()).toBe(false)
  globalShortcut.registerAll()
  expect(clipboard.readText()).toBe('fixture')
  expect(calls).toEqual([['accessory'], ['muted', true], ['opacity', 0], ['ignoreMouse', true], ['focusable', false], ['inactive']])
})
