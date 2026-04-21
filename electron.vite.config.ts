import { defineConfig, externalizeDepsPlugin } from "electron-vite"

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    build: {
      rollupOptions: {
        output: {
          // 1.4MB単一バンドルがcloudflared HTTP/2経路で ERR_HTTP2_PROTOCOL_ERROR となる事象を回避するため
          // 重い依存をvendor chunkに分離してバンドルサイズを下げる
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined
            if (id.includes("@codemirror") || id.includes("/codemirror/")) return "vendor-codemirror"
            if (id.includes("@xterm") || id.includes("/xterm")) return "vendor-xterm"
            return "vendor"
          },
        },
      },
    },
  },
})
