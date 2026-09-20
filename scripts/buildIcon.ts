import { execSync } from 'node:child_process'
import { env, platform } from 'node:process'

(() => {
  try {
    const isMac = env.PLATFORM?.startsWith('macos') ?? platform === 'darwin'

    const logoName = isMac ? 'logo-mac' : 'logo'

    const command = `tauri icon src-tauri/assets/${logoName}.png`

    execSync(command, { stdio: 'inherit' })
  } catch (error) {
    // Non bloquant pour `pnpm dev` : l'icône n'empêche jamais Vite de servir
    // localhost:1420. En CI release, `tauri build` régénère les icônes.
    console.warn('[buildIcon] skipped (non-blocking):', error instanceof Error ? error.message : error)
  }
})()
