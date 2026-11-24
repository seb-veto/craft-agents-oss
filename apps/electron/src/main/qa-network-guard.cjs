// Isolated acceptance only. Loaded by fork-bootstrap.cjs when VETO_QA_LOOPBACK_ONLY=1 and an explicit
// CRAFT_CONFIG_DIR is set. Blocks every Node socket in the Electron main process that is not loopback or a
// local IPC path, so test actions (for example Share, telemetry, update checks or model calls) cannot leave
// the machine. Chromium traffic is covered separately by --proxy-server/--host-resolver-rules, and child
// processes by dead proxy environment variables. Never enabled in normal use.
'use strict'
const net = require('node:net')
const dns = require('node:dns')

const LOOPBACK_NAMES = new Set(['localhost', 'localhost.', '127.0.0.1', '::1', '[::1]', '::ffff:127.0.0.1'])
const isLoopback = (host) => {
  if (host === undefined || host === null || host === '') return true // Node defaults to localhost
  const h = String(host).toLowerCase()
  return LOOPBACK_NAMES.has(h) || /^127\./.test(h)
}
const blocked = (what) => {
  const error = new Error(`[veto-qa] blocked non-loopback network access: ${what}`)
  error.code = 'ECONNREFUSED'
  process.stderr.write(`${error.message}\n`)
  return error
}

const connect = net.Socket.prototype.connect
net.Socket.prototype.connect = function guardedConnect(...args) {
  const first = args[0]
  let host
  let path
  if (Array.isArray(first)) { host = first[0]?.host; path = first[0]?.path }
  else if (first && typeof first === 'object') { host = first.host; path = first.path }
  else if (typeof first === 'string' && !/^\d+$/.test(first)) path = first
  else host = typeof args[1] === 'string' ? args[1] : undefined
  if (!path && !isLoopback(host)) {
    const error = blocked(`${host}:${typeof first === 'object' ? first?.port : first}`)
    process.nextTick(() => this.destroy(error))
    return this
  }
  return connect.apply(this, args)
}

const lookup = dns.lookup
dns.lookup = function guardedLookup(hostname, options, callback) {
  const cb = typeof options === 'function' ? options : callback
  if (!isLoopback(hostname)) { process.nextTick(() => cb(blocked(`dns ${hostname}`))); return {} }
  return lookup.apply(this, arguments)
}
const promiseLookup = dns.promises.lookup
dns.promises.lookup = function guardedPromiseLookup(hostname, ...rest) {
  if (!isLoopback(hostname)) return Promise.reject(blocked(`dns ${hostname}`))
  return promiseLookup.call(this, hostname, ...rest)
}

process.stderr.write('[veto-qa] loopback-only network guard active in main process\n')
