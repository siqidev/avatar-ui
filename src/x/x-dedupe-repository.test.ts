import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { markSeen, _resetForTest } from "./x-dedupe-repository.js"

// config.dataDir をtmpディレクトリに向ける
let tmpDir: string

vi.mock("../config.js", () => ({
  getConfig: () => ({
    dataDir: tmpDir,
  }),
}))

vi.mock("../logger.js", () => ({
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "x-dedupe-test-"))
  _resetForTest()
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe("markSeen", () => {
  it("新規IDはtrueを返す", () => {
    expect(markSeen("tweet_1")).toBe(true)
  })

  it("既知IDはfalseを返す", () => {
    markSeen("tweet_1")
    expect(markSeen("tweet_1")).toBe(false)
  })

  it("異なるIDは別々に管理される", () => {
    expect(markSeen("tweet_1")).toBe(true)
    expect(markSeen("tweet_2")).toBe(true)
    expect(markSeen("tweet_1")).toBe(false)
  })

  it("ファイルに永続化される", () => {
    markSeen("tweet_1")
    const filePath = path.join(tmpDir, "x-seen-tweets.json")
    expect(fs.existsSync(filePath)).toBe(true)
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as string[]
    expect(data).toContain("tweet_1")
  })

  it("再起動後も既知IDを保持する（ファイル読み込み）", () => {
    markSeen("tweet_1")
    _resetForTest() // メモリをクリア → 次のmarkSeenでファイルから読み込み
    expect(markSeen("tweet_1")).toBe(false)
  })
})
