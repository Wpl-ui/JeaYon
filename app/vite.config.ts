import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { visualPreview } from './src/dev-preview/plugin.ts'

// 发布到反代域名后：必须监听 0.0.0.0、放行反代 Host，并遵守平台注入的 PORT。
// 否则 Vite 会直接拒掉请求（Blocked request. This host is not allowed.），
// 或者起在写死的端口上而探活探不到。
const port = Number(process.env.PORT) || 5183

/**
 * 上线域名带分享门禁：**只有带上 `?sharecode=` 的请求才放行**。
 *
 * `index.html` 本身是带参数访问的，所以能拿到 200；但它里面写死的
 * `./assets/index-xxx.js` / `.css` 是浏览器另发的请求，不带任何参数，
 * 会被门禁拦成 403（"链接不完整"），线上表现就是一片白屏。
 *
 * 这里在构建收尾时把这两个静态引用摘掉，换成一个内联 loader：
 * 由它在运行时读出当前 URL 上的 sharecode，拼到资源地址后再加载。
 * 门禁照常生效（没有 sharecode 依然拿不到资源），只是不再无谓地漏掉参数。
 *
 * 只作用于 build，`npm run dev` / `npm run preview` 不受影响；
 * 本地没有 sharecode 时 loader 不拼参数，行为与普通构建一致。
 */
function sharecodeAwareAssets(): Plugin {
  return {
    name: 'sharecode-aware-assets',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html: string) {
        const scripts: string[] = []
        const styles: string[] = []

        let out = html.replace(
          /<script\b[^>]*\bsrc="([^"]+)"[^>]*>\s*<\/script>/g,
          (_all, src: string) => {
            if (/\.m?js$/.test(src)) scripts.push(src)
            return ''
          },
        )
        out = out.replace(
          /<link\b[^>]*\bhref="([^"]+\.css)"[^>]*>/g,
          (_all, href: string) => {
            styles.push(href)
            return ''
          },
        )

        if (scripts.length === 0 && styles.length === 0) return out

        const loader = [
          '<script>',
          '(function () {',
          '  var code = new URLSearchParams(window.location.search).get("sharecode");',
          '  var q = code ? "?sharecode=" + encodeURIComponent(code) : "";',
          `  var css = ${JSON.stringify(styles[0] ?? '')};`,
          `  var js = ${JSON.stringify(scripts[0] ?? '')};`,
          '  if (css) {',
          '    var l = document.createElement("link");',
          '    l.rel = "stylesheet";',
          '    l.href = css + q;',
          '    document.head.appendChild(l);',
          '  }',
          '  var s = document.createElement("script");',
          '  s.type = "module";',
          '  s.src = js + q;',
          '  document.body.appendChild(s);',
          '})();',
          '</script>',
        ].join('\n    ')

        return out.replace('</body>', `  ${loader}\n  </body>`)
      },
    },
  }
}

// HashRouter + 相对 base：静态托管的任意子路径都能直接打开，不依赖服务端 rewrite。
export default defineConfig({
  plugins: [visualPreview(), react(), sharecodeAwareAssets()],
  base: './',
  server: {
    host: '0.0.0.0',
    port,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port,
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
