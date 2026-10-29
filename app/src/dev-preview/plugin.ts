import path from 'node:path'
import type { Plugin } from 'vite'

/** Only the preview entry's module graph receives fixture adapters; index.html stays real. */
export function visualPreview(): Plugin {
  let root = ''
  const marker = '?visual-preview'
  const adapters: Record<string, string> = {
    'auth/AuthProvider.tsx': 'providers.tsx',
    'teams/TeamProvider.tsx': 'providers.tsx',
    'tasks/api.ts': 'tasks-api.ts',
    'logs/api.ts': 'logs-api.ts',
    'teams/api.ts': 'teams-api.ts',
    'auth/api.ts': 'auth-api.ts',
  }
  return {
    name: 'isolated-visual-preview',
    apply: 'serve',
    enforce: 'pre',
    configResolved(config) { root = config.root },
    async resolveId(source, importer) {
      if (!importer || !source.startsWith('.')) return null
      const cleanImporter = importer.split('?')[0]
      const entry = path.resolve(root, 'src/dev-preview/main.tsx')
      if (cleanImporter !== entry && !importer.endsWith(marker)) return null
      const resolved = await this.resolve(source, cleanImporter, { skipSelf: true })
      if (!resolved || !resolved.id.startsWith(`${root}/src/`)) return null
      if (resolved.id.includes('/dev-preview/') || /\.css$/.test(resolved.id)) return resolved
      const relative = path.relative(path.resolve(root, 'src'), resolved.id)
      const adapter = adapters[relative]
      return adapter ? path.resolve(root, 'src/dev-preview', adapter) : `${resolved.id}${marker}`
    },
  }
}
