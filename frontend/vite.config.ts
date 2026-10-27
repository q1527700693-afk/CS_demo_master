import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const tokenFile =
    env.LOCAL_PARSER_TOKEN_FILE ||
    fileURLToPath(new URL('../local_parser/token.txt', import.meta.url))
  return {
    plugins: [
      vue(),
      {
        name: 'local-analysis-connection',
        configureServer(server) {
          server.middlewares.use('/local', (req, res, next) => {
            const host = req.headers.host || ''
            if (
              !/^(127\.0\.0\.1|localhost):\d+$/.test(host) ||
              (req.headers.origin && req.headers.origin !== `http://${host}`) ||
              req.headers['sec-fetch-site'] === 'cross-site'
            ) {
              res.statusCode = 403
              res.setHeader('Content-Type', 'application/json; charset=utf-8')
              res.end(
                JSON.stringify({
                  code: 40300,
                  message: '本机解析连接仅限当前网页使用',
                  data: null,
                }),
              )
              return
            }
            try {
              if (!readFileSync(tokenFile, 'utf8').trim()) throw new Error('Missing token')
            } catch {
              res.statusCode = 503
              res.setHeader('Content-Type', 'application/json; charset=utf-8')
              res.end(
                JSON.stringify({
                  code: 50300,
                  message: '解析服务尚未准备好，请重新运行本机启动器',
                  data: null,
                }),
              )
              return
            }
            next()
          })
        },
      },
    ],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/local': {
          target: env.LOCAL_PARSER_TARGET || 'http://127.0.0.1:8877',
          changeOrigin: true,
          timeout: 300000,
          proxyTimeout: 300000,
          configure(proxy) {
            proxy.on('proxyReq', (request) => {
              request.setHeader('Authorization', `Bearer ${readFileSync(tokenFile, 'utf8').trim()}`)
              request.setHeader('Origin', 'http://127.0.0.1:5173')
            })
          },
        },
        '/api': { target: env.VITE_PROXY_TARGET || 'http://127.0.0.1:8000', changeOrigin: true },
        '/uploads': {
          target: env.VITE_PROXY_TARGET || 'http://127.0.0.1:8000',
          changeOrigin: true,
        },
      },
    },
    build: { chunkSizeWarningLimit: 700 },
    // Keep optional browser fixtures and temporary backend checkouts out of Vitest.
    test: { include: ['src/**/*.test.ts'] },
  }
})
