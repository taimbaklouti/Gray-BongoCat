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
