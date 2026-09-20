import { info } from '@tauri-apps/plugin-log'

const timeOrigin = performance.now()

/**
 * Marque de performance : `+ms` depuis le chargement de la page, écrite dans
 * `BongoCat.log` (target fichier déjà configurée côté Rust). Ne casse jamais :
 * hors environnement Tauri, l'appel est simplement ignoré.
 */
export function perfMark(label: string) {
  const ms = Math.round(performance.now() - timeOrigin)

  try {
    void info(`[perf] +${ms}ms ${label}`).catch(() => {})
  } catch {}
}
