import { defineConfig, loadEnv } from 'vite'
import electron from 'vite-plugin-electron'
import { resolve } from 'path'

export default defineConfig(({ mode }) => {
  // プロジェクトルート(appの親)の.envを読み込む
  // app/ で実行されることを想定し、親ディレクトリを指す
  const env = loadEnv(mode, resolve(__dirname, '..'), '')
  
  // 必須環境変数の取得 (Fail-Fast)
  const getEnv = (key: string) => {
    const val = env[key]
    if (!val) {
      throw new Error(`Config Error: '${key}' is missing in .env`)
    }
    return val
  }

  const clientPort = parseInt(getEnv('CLIENT_PORT'))
  const serverPort = getEnv('SERVER_PORT')
  const serverHost = getEnv('SERVER_HOST')
  
  // プロキシ先のURLを構築
  const serverUrl = `http://${serverHost}:${serverPort}`

  return {
    plugins: [
      electron([
        {
          entry: resolve(__dirname, 'src/main/index.ts'),
          vite: {
            build: {
              outDir: resolve(__dirname, 'dist-electron'),
            },
          },
        },
      ]),
    ],
    server: {
      port: clientPort,
      proxy: {
        '/agui': {
          target: serverUrl,
          changeOrigin: true,
        },
      },
    },
    root: 'src/renderer',
    publicDir: resolve(__dirname, 'src/renderer/assets'),
    build: {
      outDir: resolve(__dirname, 'dist/renderer'),
    },
  }
})
