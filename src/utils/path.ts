import { sep } from '@tauri-apps/api/path'

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function join(...paths: string[]) {
  const separator = sep()
  const escaped = escapeRegExp(separator)
  const joinPaths = paths.map((path, index) => {
    if (index === 0) {
      return path.replace(new RegExp(`${escaped}+$`), '')
    }

    return path.replace(new RegExp(`^${escaped}+|${escaped}+$`, 'g'), '')
  })

  return joinPaths.join(separator)
}

/**
 * Normalise un chemin natif pour les URLs d'assets (`convertFileSrc`) et les
 * requêtes `fetch`/`Image` : sur Windows, les `\` mélangés aux `/` des JSON de
 * modèle produisent des URLs que Webview2 ne résout pas (texture pendue →
 * "Switching..." infini). Les API `fs` gardent, elles, le chemin natif.
 */
export function toAssetPath(path: string) {
  return path.replace(/\\/g, '/')
}
