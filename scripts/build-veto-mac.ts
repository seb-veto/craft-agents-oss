import { spawn } from 'bun'
import { copyFileSync, existsSync, mkdirSync, symlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { copyPiAgentServer, downloadBun, downloadUv, verifySubprocessServersExist } from './build/common'
import { verifyPackagedSDK } from './build/darwin'

if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('This release script currently supports macOS arm64 only')
const rootDir = resolve(import.meta.dir, '..')
const electronDir = join(rootDir, 'apps/electron')
const config = { platform: 'darwin' as const, arch: 'arm64' as const, upload: false, uploadLatest: false, uploadScript: false, rootDir, electronDir }

async function run(cmd: string[], cwd = rootDir) {
  const process = spawn({ cmd, cwd, stdout: 'inherit', stderr: 'inherit', env: { ...Bun.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } })
  if (await process.exited !== 0) throw new Error(`Build step failed: ${cmd.join(' ')}`)
}

// Public pinned-runtime downloads only. No credential loading, release uploads or live app changes.
await downloadBun(config)
await downloadUv(config)
for (const [alias, source] of [
  ['@anthropic-ai/claude-agent-sdk', '@anthropic-ai/claude-agent-sdk'],
  ['@anthropic-ai/claude-agent-sdk-binary', '@anthropic-ai/claude-agent-sdk-darwin-arm64'],
  ['@vscode/ripgrep', '@vscode/ripgrep'],
]) {
  const target = join(electronDir, 'node_modules', alias)
  if (!existsSync(target)) {
    mkdirSync(resolve(target, '..'), { recursive: true })
    symlinkSync(join(rootDir, 'node_modules', source), target, 'dir')
  }
}
if (!existsSync(join(electronDir, 'resources/veto/icon.icns'))) {
  await run(['swift', 'scripts/generate-veto-icon.swift', 'apps/electron/resources/veto/AppIcon.iconset'])
  await run(['iconutil', '-c', 'icns', 'apps/electron/resources/veto/AppIcon.iconset', '-o', 'apps/electron/resources/veto/icon.icns'])
}
await run(['bun', 'run', 'electron:build'])
// electron:build bundles packages/pi-agent-server/dist; the release pipeline then copies it into
// packaged resources. Without this, every Pi/custom-endpoint chat fails with "piServerPath not configured".
copyPiAgentServer(config)
verifySubprocessServersExist(config)
copyFileSync(join(electronDir, 'src/main/fork-bootstrap.cjs'), join(electronDir, 'dist/fork-bootstrap.cjs'))
copyFileSync(join(electronDir, 'src/main/qa-network-guard.cjs'), join(electronDir, 'dist/qa-network-guard.cjs'))
copyFileSync(join(electronDir, 'src/main/qa-desktop-guard.cjs'), join(electronDir, 'dist/qa-desktop-guard.cjs'))
await run(['bun', 'run', 'electron-builder', '--config', 'electron-builder.veto.yml', '--mac', '--arm64', ...(Bun.argv.includes('--dir') ? ['--dir'] : []), '--publish', 'never'], electronDir)
// Fail the build if a runtime the app spawns is missing from the bundle.
const appPath = join(electronDir, 'release-veto', 'mac-arm64', 'Veto Agents.app')
verifyPackagedSDK(appPath, 'arm64')
for (const required of ['resources/pi-agent-server/index.js', 'dist/interceptor.cjs', 'dist/fork-bootstrap.cjs', 'dist/qa-network-guard.cjs', 'dist/qa-desktop-guard.cjs', 'node_modules/@vscode/ripgrep/bin/rg']) {
  if (!existsSync(join(appPath, 'Contents', 'Resources', 'app', required))) throw new Error(`Packaged app is missing ${required}`)
}
console.log('Veto Agents artifact written to apps/electron/release-veto. Current Craft Agents app/profile were not touched.')
