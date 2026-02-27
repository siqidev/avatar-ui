import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"
import { fsList, fsRead, fsWrite, fsMutate } from "./filesystem-service.js"

// テスト用の一時Avatar Spaceを作成
let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "avatar-space-test-"))
  // APP_CONFIG.avatarSpaceを一時ディレクトリに上書き
  process.env.AVATAR_SPACE = tmpDir
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
  delete process.env.AVATAR_SPACE
})

describe("fsList", () => {
  it("空ディレクトリで空配列を返す", async () => {
    const result = await fsList({ path: "." })
    expect(result.entries).toEqual([])
  })

  it("ファイルとディレクトリを一覧する", async () => {
    await fs.writeFile(path.join(tmpDir, "hello.txt"), "world")
    await fs.mkdir(path.join(tmpDir, "subdir"))

    const result = await fsList({ path: "." })
    expect(result.entries).toHaveLength(2)
    // ディレクトリ優先、名前順
    expect(result.entries[0].name).toBe("subdir")
    expect(result.entries[0].type).toBe("directory")
    expect(result.entries[1].name).toBe("hello.txt")
    expect(result.entries[1].type).toBe("file")
    expect(result.entries[1].size).toBe(5)
  })

  it("サブディレクトリの一覧を返す", async () => {
    await fs.mkdir(path.join(tmpDir, "sub"))
    await fs.writeFile(path.join(tmpDir, "sub", "a.md"), "# A")

    const result = await fsList({ path: "sub" })
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].name).toBe("a.md")
  })
})

describe("fsRead", () => {
  it("ファイルの内容を読む", async () => {
    await fs.writeFile(path.join(tmpDir, "test.txt"), "line1\nline2\nline3")

    const result = await fsRead({ path: "test.txt" })
    expect(result.content).toBe("line1\nline2\nline3")
    expect(result.mtimeMs).toBeGreaterThan(0)
  })

  it("offset/limitで行範囲を指定できる", async () => {
    await fs.writeFile(path.join(tmpDir, "test.txt"), "line0\nline1\nline2\nline3")

    const result = await fsRead({ path: "test.txt", offset: 1, limit: 2 })
    expect(result.content).toBe("line1\nline2")
  })

  it("存在しないファイルでエラー", async () => {
    await expect(fsRead({ path: "nope.txt" })).rejects.toThrow()
  })
})

describe("fsWrite", () => {
  it("ファイルを作成する", async () => {
    const result = await fsWrite({ path: "new.txt", content: "hello" })
    expect(result.bytes).toBe(5)

    const content = await fs.readFile(path.join(tmpDir, "new.txt"), "utf-8")
    expect(content).toBe("hello")
  })

  it("親ディレクトリを自動作成する", async () => {
    await fsWrite({ path: "deep/nested/file.md", content: "# Deep" })

    const content = await fs.readFile(path.join(tmpDir, "deep/nested/file.md"), "utf-8")
    expect(content).toBe("# Deep")
  })

  it("既存ファイルを上書きする", async () => {
    await fs.writeFile(path.join(tmpDir, "overwrite.txt"), "old")
    await fsWrite({ path: "overwrite.txt", content: "new" })

    const content = await fs.readFile(path.join(tmpDir, "overwrite.txt"), "utf-8")
    expect(content).toBe("new")
  })
})

describe("fsMutate", () => {
  it("delete: ファイルを削除する", async () => {
    await fs.writeFile(path.join(tmpDir, "del.txt"), "bye")
    const result = await fsMutate({ op: "delete", path: "del.txt" })
    expect(result.message).toContain("削除")

    await expect(fs.access(path.join(tmpDir, "del.txt"))).rejects.toThrow()
  })

  it("delete: ディレクトリを再帰的に削除する", async () => {
    await fs.mkdir(path.join(tmpDir, "dir"))
    await fs.writeFile(path.join(tmpDir, "dir/a.txt"), "a")
    await fsMutate({ op: "delete", path: "dir" })

    await expect(fs.access(path.join(tmpDir, "dir"))).rejects.toThrow()
  })

  it("rename: ファイルをリネームする", async () => {
    await fs.writeFile(path.join(tmpDir, "old.txt"), "content")
    await fsMutate({ op: "rename", path: "old.txt", newPath: "new.txt" })

    await expect(fs.access(path.join(tmpDir, "old.txt"))).rejects.toThrow()
    const content = await fs.readFile(path.join(tmpDir, "new.txt"), "utf-8")
    expect(content).toBe("content")
  })

  it("rename: 移動先の親ディレクトリを自動作成する", async () => {
    await fs.writeFile(path.join(tmpDir, "move.txt"), "data")
    await fsMutate({ op: "rename", path: "move.txt", newPath: "sub/moved.txt" })

    const content = await fs.readFile(path.join(tmpDir, "sub/moved.txt"), "utf-8")
    expect(content).toBe("data")
  })

  it("mkdir: ディレクトリを作成する", async () => {
    await fsMutate({ op: "mkdir", path: "newdir" })

    const stat = await fs.stat(path.join(tmpDir, "newdir"))
    expect(stat.isDirectory()).toBe(true)
  })

  it("mkdir: ネストしたディレクトリを作成する", async () => {
    await fsMutate({ op: "mkdir", path: "a/b/c" })

    const stat = await fs.stat(path.join(tmpDir, "a/b/c"))
    expect(stat.isDirectory()).toBe(true)
  })
})

describe("パスガード", () => {
  it("Avatar Space外へのアクセスを拒否する", async () => {
    await expect(fsRead({ path: "../../../etc/passwd" })).rejects.toThrow("Avatar Space外")
  })

  it("絶対パスでAvatar Space外へのアクセスを拒否する", async () => {
    await expect(fsRead({ path: "/etc/passwd" })).rejects.toThrow("Avatar Space外")
  })

  it("fsList: Avatar Space外を拒否", async () => {
    await expect(fsList({ path: "../../" })).rejects.toThrow("Avatar Space外")
  })

  it("fsWrite: Avatar Space外を拒否", async () => {
    await expect(fsWrite({ path: "../escape.txt", content: "bad" })).rejects.toThrow("Avatar Space外")
  })

  it("fsMutate: Avatar Space外を拒否", async () => {
    await expect(fsMutate({ op: "delete", path: "../escape" })).rejects.toThrow("Avatar Space外")
  })

  it("fsMutate rename: 移動先がAvatar Space外を拒否", async () => {
    await fs.writeFile(path.join(tmpDir, "safe.txt"), "data")
    await expect(
      fsMutate({ op: "rename", path: "safe.txt", newPath: "../../escape.txt" }),
    ).rejects.toThrow("Avatar Space外")
  })
})
