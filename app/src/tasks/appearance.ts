const taskColors = ['mint', 'sky', 'lemon', 'peach', 'lavender', 'apricot', 'aqua', 'rose', 'sage', 'periwinkle'] as const

export function taskColor(id: number): typeof taskColors[number] {
  let hash = 2166136261
  for (const char of String(id)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return taskColors[(hash >>> 0) % taskColors.length]
}
