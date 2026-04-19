import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"
import { fsImportFile, fsList, fsRead, fsWrite, fsMutate, ensureRefsReady } from "./filesystem-service.js"
import { _resetConfigForTest } from "../config.js"

// テスト用の一時Avatar Spaceを作成
let tmpDir: string
let importSourceDir: string
let externalRepoDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "avatar-space-test-"))
  importSourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "avatar-import-test-"))
  externalRepoDir = await fs.mkdtemp(path.join(os.tmpdir(), "external-repo-test-"))
  _resetConfigForTest({ XAI_API_KEY: "test-key", AVATAR_SPACE: tmpDir })
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
  await fs.rm(importSourceDir, { recursive: true, force: true })
  await fs.rm(externalRepoDir, { recursive: true, force: true })
  _resetConfigForTest({ XAI_API_KEY: "test-key" })
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

describe("fsImportFile", () => {
  it("外部ファイルをAvatar Spaceへコピーする", async () => {
    const sourcePath = path.join(importSourceDir, "binary.dat")
    const sourceBytes = Buffer.from([0x00, 0x7f, 0x80, 0xff, 0x41])
    await fs.writeFile(sourcePath, sourceBytes)

    const result = await fsImportFile({ sourcePath, destPath: "imports/binary.dat" })

    expect(result.path).toBe("imports/binary.dat")
    expect(result.bytes).toBe(sourceBytes.length)
    const copied = await fs.readFile(path.join(tmpDir, "imports/binary.dat"))
    expect(Buffer.compare(copied, sourceBytes)).toBe(0)
  })

  it("移動先がAvatar Space外なら拒否する", async () => {
    const sourcePath = path.join(importSourceDir, "escape.txt")
    await fs.writeFile(sourcePath, "escape")

    await expect(
      fsImportFile({ sourcePath, destPath: "../escape.txt" }),
    ).rejects.toThrow("Avatar Space外")
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

describe("refs/（読み取り専用参照）", () => {
  beforeEach(async () => {
    // refs/ディレクトリとシンボリックリンクを手動セットアップ
    const refsDir = path.join(tmpDir, "refs")
    await fs.mkdir(refsDir, { recursive: true })
    // 外部リポにテストファイルを配置
    await fs.writeFile(path.join(externalRepoDir, "README.md"), "# External Repo")
    await fs.mkdir(path.join(externalRepoDir, "sub"))
    await fs.writeFile(path.join(externalRepoDir, "sub", "data.txt"), "nested content")
    // refs/ext → 外部リポへのシンボリックリンク
    await fs.symlink(externalRepoDir, path.join(refsDir, "ext"))
  })

  it("fsRead: refs/内のシンボリックリンク先ファイルを読める", async () => {
    const result = await fsRead({ path: "refs/ext/README.md" })
    expect(result.content).toBe("# External Repo")
  })

  it("fsList: refs/内のシンボリックリンク先ディレクトリを一覧できる", async () => {
    const result = await fsList({ path: "refs/ext" })
    expect(result.entries.some((e) => e.name === "README.md")).toBe(true)
    expect(result.entries.some((e) => e.name === "sub")).toBe(true)
  })

  it("fsList: refs/内のネストしたディレクトリも一覧できる", async () => {
    const result = await fsList({ path: "refs/ext/sub" })
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].name).toBe("data.txt")
  })

  it("fsWrite: refs/配下への書き込みを拒否", async () => {
    await expect(
      fsWrite({ path: "refs/ext/evil.txt", content: "bad" }),
    ).rejects.toThrow("refs/は読み取り専用です")
  })

  it("fsWrite: refs/直下への書き込みも拒否", async () => {
    await expect(
      fsWrite({ path: "refs/newfile.txt", content: "bad" }),
    ).rejects.toThrow("refs/は読み取り専用です")
  })

  it("fsMutate delete: refs/配下の削除を拒否", async () => {
    await expect(
      fsMutate({ op: "delete", path: "refs/ext/README.md" }),
    ).rejects.toThrow("refs/は読み取り専用です")
  })

  it("fsMutate rename: refs/配下からの移動を拒否", async () => {
    await expect(
      fsMutate({ op: "rename", path: "refs/ext/README.md", newPath: "stolen.md" }),
    ).rejects.toThrow("refs/は読み取り専用です")
  })

  it("fsMutate mkdir: refs/配下にディレクトリ作成を拒否", async () => {
    await expect(
      fsMutate({ op: "mkdir", path: "refs/newdir" }),
    ).rejects.toThrow("refs/は読み取り専用です")
  })

  it("fsImportFile: refs/配下へのインポートを拒否", async () => {
    const sourcePath = path.join(importSourceDir, "import.txt")
    await fs.writeFile(sourcePath, "data")
    await expect(
      fsImportFile({ sourcePath, destPath: "refs/ext/import.txt" }),
    ).rejects.toThrow("refs/は読み取り専用です")
  })

  it("fsMutate copy: refs/からrwへのコピーは許可（ソースは読み取りのみ）", async () => {
    const result = await fsMutate({ op: "copy", path: "refs/ext/README.md", destPath: "copied.md" })
    expect(result.message).toContain("コピー")
    const content = await fs.readFile(path.join(tmpDir, "copied.md"), "utf-8")
    expect(content).toBe("# External Repo")
  })
})

describe("非refs/ symlink経由のサンドボックス回避を拒否", () => {
  // refs/外（rw領域）にAVATAR_SPACE外を指すsymlinkがあった場合、
  // そのsymlink配下への新規書き込みは拒否される（最も近い既存ancestorのrealpath検証）
  it("fsWrite: 非refs/symlink配下の新規ファイル作成を拒否", async () => {
    await fs.symlink(externalRepoDir, path.join(tmpDir, "escape"))
    await expect(
      fsWrite({ path: "escape/leak.txt", content: "leak" }),
    ).rejects.toThrow("Avatar Space外")
  })

  it("fsMutate mkdir: 非refs/symlink配下のディレクトリ作成を拒否", async () => {
    await fs.symlink(externalRepoDir, path.join(tmpDir, "escape"))
    await expect(
      fsMutate({ op: "mkdir", path: "escape/leakdir" }),
    ).rejects.toThrow("Avatar Space外")
  })

  it("fsMutate rename: 非refs/symlink配下を宛先にしたリネームを拒否", async () => {
    await fs.writeFile(path.join(tmpDir, "src.txt"), "data")
    await fs.symlink(externalRepoDir, path.join(tmpDir, "escape"))
    await expect(
      fsMutate({ op: "rename", path: "src.txt", newPath: "escape/dest.txt" }),
    ).rejects.toThrow("Avatar Space外")
  })

  it("fsMutate copy: 非refs/symlink配下を宛先にしたコピーを拒否", async () => {
    await fs.writeFile(path.join(tmpDir, "src.txt"), "data")
    await fs.symlink(externalRepoDir, path.join(tmpDir, "escape"))
    await expect(
      fsMutate({ op: "copy", path: "src.txt", destPath: "escape/dest.txt" }),
    ).rejects.toThrow("Avatar Space外")
  })

  it("fsImportFile: 非refs/symlink配下へのインポートを拒否", async () => {
    await fs.symlink(externalRepoDir, path.join(tmpDir, "escape"))
    const sourcePath = path.join(importSourceDir, "import.txt")
    await fs.writeFile(sourcePath, "data")
    await expect(
      fsImportFile({ sourcePath, destPath: "escape/leak.txt" }),
    ).rejects.toThrow("Avatar Space外")
  })
})

describe("ensureRefsReady", () => {
  it("refs/ディレクトリを作成する", async () => {
    ensureRefsReady()
    const refsDir = path.join(tmpDir, "refs")

    const stat = await fs.stat(refsDir)
    expect(stat.isDirectory()).toBe(true)
  })

  it("既にrefs/があればエラーにならない", async () => {
    await fs.mkdir(path.join(tmpDir, "refs"), { recursive: true })
    ensureRefsReady()

    const stat = await fs.stat(path.join(tmpDir, "refs"))
    expect(stat.isDirectory()).toBe(true)
  })
})
