import { describe, it, expect } from "vitest"
import {
  createCanvasFocusState,
  pushFocus,
  popFocus,
  canPopFocus,
} from "./canvas-focus-stack.js"
import type { CanvasFocusItem, CanvasFileFocusItem } from "./canvas-focus-stack.js"

const fileItem = (path: string, actor: "human" | "ai" = "human"): CanvasFileFocusItem => ({
  kind: "file",
  path,
  content: `content of ${path}`,
  actor,
  origin: "space",
  focusedAt: Date.now(),
})

const imageItem = (url: string, actor: "human" | "ai" = "ai"): CanvasFocusItem => ({
  kind: "image",
  imageUrl: url,
  alt: "test image",
  actor,
  origin: "stream",
  focusedAt: Date.now(),
})

describe("canvas-focus-stack", () => {
  it("初期状態: currentはnull、履歴は空", () => {
    const state = createCanvasFocusState()
    expect(state.current).toBeNull()
    expect(state.history).toEqual([])
    expect(canPopFocus(state)).toBe(false)
  })

  it("初回push: currentに設定、履歴は空のまま", () => {
    const state = pushFocus(createCanvasFocusState(), fileItem("/a.ts"))
    expect(state.current?.kind).toBe("file")
    expect(state.history.length).toBe(0)
  })

  it("2回push: 旧currentが履歴に移動", () => {
    let state = createCanvasFocusState()
    state = pushFocus(state, fileItem("/a.ts"))
    state = pushFocus(state, fileItem("/b.ts"))
    expect((state.current as { path: string }).path).toBe("/b.ts")
    expect(state.history.length).toBe(1)
    expect((state.history[0] as { path: string }).path).toBe("/a.ts")
  })

  it("pop: 履歴末尾がcurrentに復帰（LIFO）", () => {
    let state = createCanvasFocusState()
    state = pushFocus(state, fileItem("/a.ts"))
    state = pushFocus(state, fileItem("/b.ts"))
    state = pushFocus(state, fileItem("/c.ts"))
    state = popFocus(state)
    expect((state.current as { path: string }).path).toBe("/b.ts")
    expect(state.history.length).toBe(1)
  })

  it("全pop後: currentがnull", () => {
    let state = createCanvasFocusState()
    state = pushFocus(state, fileItem("/a.ts"))
    state = popFocus(state)
    expect(state.current).toBeNull()
    expect(canPopFocus(state)).toBe(false)
  })

  it("空状態でpop: 変化なし", () => {
    const state = popFocus(createCanvasFocusState())
    expect(state.current).toBeNull()
  })

  it("同一ターゲット連続push: 履歴を増やさずcurrent更新", () => {
    let state = createCanvasFocusState()
    state = pushFocus(state, fileItem("/a.ts"))
    const updated: CanvasFocusItem = { ...fileItem("/a.ts"), content: "updated" }
    state = pushFocus(state, updated)
    expect(state.history.length).toBe(0)
    expect((state.current as { content: string }).content).toBe("updated")
  })

  it("file→image混在のpush/pop", () => {
    let state = createCanvasFocusState()
    state = pushFocus(state, fileItem("/a.ts"))
    state = pushFocus(state, imageItem("https://example.com/img.png"))
    expect(state.current?.kind).toBe("image")
    state = popFocus(state)
    expect(state.current?.kind).toBe("file")
  })

  it("maxDepth超過: 古い履歴が削除される", () => {
    let state = createCanvasFocusState(3)
    for (let i = 0; i < 5; i++) {
      state = pushFocus(state, fileItem(`/${i}.ts`))
    }
    // current=/4.ts, history=[/1.ts, /2.ts, /3.ts]（/0.tsは溢れ）
    expect(state.history.length).toBe(3)
    expect((state.history[0] as { path: string }).path).toBe("/1.ts")
  })

  it("起点対称性: human/aiでpush/pop規則は同一", () => {
    let stateH = createCanvasFocusState()
    stateH = pushFocus(stateH, fileItem("/a.ts", "human"))
    stateH = pushFocus(stateH, imageItem("https://x.com/img.png", "human"))

    let stateA = createCanvasFocusState()
    stateA = pushFocus(stateA, fileItem("/a.ts", "ai"))
    stateA = pushFocus(stateA, imageItem("https://x.com/img.png", "ai"))

    // 構造が同じ（actorだけ異なる）
    expect(stateH.history.length).toBe(stateA.history.length)
    expect(stateH.current?.kind).toBe(stateA.current?.kind)
  })

  it("immutable: pushは元stateを変更しない", () => {
    const original = createCanvasFocusState()
    pushFocus(original, fileItem("/a.ts"))
    expect(original.current).toBeNull()
    expect(original.history.length).toBe(0)
  })
})
