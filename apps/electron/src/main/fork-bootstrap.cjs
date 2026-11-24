// Packaged Veto Agents entry point. Set isolation BEFORE main.cjs loads shared modules.
const path = require('node:path')
const os = require('node:os')
const electron = require('electron')
const { app } = electron

const profile = process.env.CRAFT_CONFIG_DIR?.trim()
process.env.CRAFT_CONFIG_DIR = profile || path.join(os.homedir(), '.veto-agents')
process.env.CRAFT_APP_NAME = 'Veto Agents'
process.env.CRAFT_DEEPLINK_SCHEME = 'vetoagents'
// This fork has no signed update channel. Never fetch/install an upstream binary.
process.env.CRAFT_DISABLE_AUTO_UPDATE = '1'
app.setName('Veto Agents')
app.setPath('userData', profile ? path.resolve(profile, 'electron-user-data') : path.join(app.getPath('appData'), 'Veto Agents'))

// Isolated acceptance only (VETO_QA_BACKGROUND=1 with an explicit CRAFT_CONFIG_DIR): run without a
// dock icon, menu bar takeover, focus stealing or visible pixels, so automated checks never take
// over the user's screen. Windows still render (shown inactive at zero opacity, click-through) so
// CDP inspection reflects real painting. Does not change Electron or renderer sandboxing.
if (process.env.VETO_QA_BACKGROUND === '1' && profile && process.platform === 'darwin') {
  require('./qa-desktop-guard.cjs')(electron)
}
// Isolated acceptance only: block non-loopback Node sockets in the main process (see qa-network-guard.cjs).
if (process.env.VETO_QA_LOOPBACK_ONLY === '1' && profile) require('./qa-network-guard.cjs')
require('./main.cjs')
