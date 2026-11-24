import { describe, expect, it, mock } from 'bun:test'
mock.module('../logger', () => ({ mainLog: { info() {}, warn() {}, error() {} } }))
const { shouldSkipEnvVar } = await import('../shell-env')

describe('login shell environment import', () => {
  it('never overrides fork identity or isolation variables', () => {
    for (const key of ['CRAFT_CONFIG_DIR', 'CRAFT_APP_NAME', 'CRAFT_DEEPLINK_SCHEME', 'CRAFT_DISABLE_AUTO_UPDATE', 'VETO_QA_LOOPBACK_ONLY']) {
      expect(shouldSkipEnvVar(key)).toBe(true)
    }
  })
  it('still imports ordinary variables', () => {
    expect(shouldSkipEnvVar('PATH')).toBe(false)
    expect(shouldSkipEnvVar('OPENAI_BASE_URL')).toBe(false)
  })
})
