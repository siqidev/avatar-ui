import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    electron([
      {
        entry: resolve(__dirname, 'src/main/index.ts'),  // 絶対パス
        vite: {
          build: {
            outDir: resolve(__dirname, 'dist-electron'),
          },
        },
      },
    ]),
    // renderer() は削除（セキュリティ強化のためNode統合を除外）
  ],
  root: 'src/renderer',  // 開発時のroot
  publicDir: resolve(__dirname, 'src/renderer/assets'),
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
  },
})
