import { constants as fsConstants } from "node:fs"
import * as fsSync from "node:fs"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { getConfig } from "../config.js"
import * as log from "../logger.js"
import type {
  FsImportFileArgs,
  FsImportFileResult,
  FsListArgs,
  FsListResult,
  FsReadArgs,
  FsReadResult,
  FsWriteArgs,
  FsWriteResult,
  FsMutateArgs,
  FsMutateResult,
  FsEntry,
} from "../shared/fs-schema.js"

// --- パスガード ---

const REFS_DIR = "refs"

/** Avatar Space のルートパス（正規化済み、環境変数を動的に参照） */
function getAvatarSpaceRoot(): string {
  return path.resolve(getConfig().avatarSpace)
}

/** パスがrefs/配下（読み取り専用領域）かどうか判定 */
function isUnderRefs(resolvedPath: string): boolean {
  const refsRoot = path.join(getAvatarSpaceRoot(), REFS_DIR)
  return resolvedPath === refsRoot || resolvedPath.startsWith(refsRoot + path.sep)
}

/** refs/配下への書き込みを拒否 */
function assertWritable(resolvedPath: string): void {
  if (isUnderRefs(resolvedPath)) {
    const rel = path.relative(getAvatarSpaceRoot(), resolvedPath)
    throw new Error(`refs/は読み取り専用です: ${rel}`)
  }
}

/** パスがAvatar Space内であることを検証（symlink解決込み）。違反時はthrow */
async function assertInAvatarSpace(targetPath: string): Promise<string> {
  const root = getAvatarSpaceRoot()
  const resolved = path.resolve(root, targetPath)
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(`Avatar Space外へのアクセスは拒否されました: ${targetPath}`)
  }
  // refs/配下: ユーザーが配置したシンボリックリンク先（外部リポ等）への読み取りを許可
  if (isUnderRefs(resolved)) {
    return resolved
  }
  // 非refs: symlink解決してAvatar Space内であることを検証
  // root自体もrealpath解決する（macOSの/var→/private/var等に対応）
  const realRoot = await fs.realpath(root)
  // resolved自体が存在する場合: そのままrealpath検証
  // 存在しない場合: 最も近い既存ancestorをrealpathして検証（symlink経由の外部書き込みを防ぐ）
  let probe = resolved
  let real: string
  while (true) {
    try {
      real = await fs.realpath(probe)
      break
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e
      const parent = path.dirname(probe)
      if (parent === probe) {
        // ルートまで遡っても見つからない（通常起こらない）
        throw new Error(`パスを解決できません: ${targetPath}`)
      }
      probe = parent
    }
  }
  // probeを起点にresolvedまでの相対部分（未存在部分）を実symlink解決後のrealにくっつけて再判定
  const remainder = path.relative(probe, resolved)
  const finalReal = remainder === "" ? real : path.join(real, remainder)
  if (!finalReal.startsWith(realRoot + path.sep) && finalReal !== realRoot) {
    throw new Error(`リンク先がAvatar Space外です: ${targetPath} → ${finalReal}`)
  }
  return resolved
}

/** Avatar Spaceルートのディレクトリ名を返す */
export function fsRootName(): string {
  return path.basename(getAvatarSpaceRoot())
}

// --- CRUD ---

export async function fsList(args: FsListArgs): Promise<FsListResult> {
  const resolved = await assertInAvatarSpace(args.path)
  const dirents = await fs.readdir(resolved, { withFileTypes: true })

  const entries: FsEntry[] = await Promise.all(
    dirents.map(async (d) => {
      const fullPath = path.join(resolved, d.name)
      // fs.statはsymlinkを辿るので、refs/配下のシンボリックリンク先がディレクトリの場合も
      // directoryとして正しく分類される（dirent.isDirectory()はsymlink自体を見るためfalseになる）
      const stat = await fs.stat(fullPath)
      return {
        name: d.name,
        type: stat.isDirectory() ? "directory" as const : "file" as const,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      }
    }),
  )

  // ディレクトリ優先、名前順
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return { path: args.path, entries }
}

export async function fsRead(args: FsReadArgs): Promise<FsReadResult> {
  const resolved = await assertInAvatarSpace(args.path)
  const content = await fs.readFile(resolved, "utf-8")
  const stat = await fs.stat(resolved)

  if (args.offset !== undefined || args.limit !== undefined) {
    const lines = content.split(/\r?\n/)
    const offset = args.offset ?? 0
    const limit = args.limit ?? lines.length
    const sliced = lines.slice(offset, offset + limit).join("\n")
    return { path: args.path, content: sliced, mtimeMs: stat.mtimeMs }
  }

  return { path: args.path, content, mtimeMs: stat.mtimeMs }
}

export async function fsWrite(args: FsWriteArgs): Promise<FsWriteResult> {
  const resolved = await assertInAvatarSpace(args.path)
  assertWritable(resolved)

  // 親ディレクトリの自動作成
  await fs.mkdir(path.dirname(resolved), { recursive: true })
  // AIがリテラル \n / \t を送る場合があるため実際の制御文字に変換
  const normalized = args.content.replace(/\\n/g, "\n").replace(/\\t/g, "\t")
  await fs.writeFile(resolved, normalized, "utf-8")
  const stat = await fs.stat(resolved)

  return { path: args.path, bytes: stat.size, mtimeMs: stat.mtimeMs }
}

export async function fsImportFile(args: FsImportFileArgs): Promise<FsImportFileResult> {
  if (!path.isAbsolute(args.sourcePath)) {
    throw new Error(`インポート元は絶対パスで指定してください: ${args.sourcePath}`)
  }

  const sourcePath = path.resolve(args.sourcePath)
  const sourceStat = await fs.stat(sourcePath)
  if (!sourceStat.isFile()) {
    throw new Error(`インポート元はファイルである必要があります: ${args.sourcePath}`)
  }

  const resolvedDest = await assertInAvatarSpace(args.destPath)
  assertWritable(resolvedDest)
  await fs.mkdir(path.dirname(resolvedDest), { recursive: true })

  try {
    await fs.copyFile(sourcePath, resolvedDest, fsConstants.COPYFILE_EXCL)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`同名ファイルが既に存在します: ${args.destPath}`)
    }
    throw e
  }

  const stat = await fs.stat(resolvedDest)
  return { path: args.destPath, bytes: stat.size, mtimeMs: stat.mtimeMs }
}

export async function fsMutate(args: FsMutateArgs): Promise<FsMutateResult> {
  switch (args.op) {
    case "delete": {
      const resolved = await assertInAvatarSpace(args.path)
      assertWritable(resolved)
      await fs.rm(resolved, { recursive: true })
      return { message: `削除しました: ${args.path}` }
    }
    case "rename": {
      const resolvedFrom = await assertInAvatarSpace(args.path)
      assertWritable(resolvedFrom)
      const resolvedTo = await assertInAvatarSpace(args.newPath)
      assertWritable(resolvedTo)
      await fs.mkdir(path.dirname(resolvedTo), { recursive: true })
      await fs.rename(resolvedFrom, resolvedTo)
      return { message: `リネームしました: ${args.path} → ${args.newPath}` }
    }
    case "mkdir": {
      const resolved = await assertInAvatarSpace(args.path)
      assertWritable(resolved)
      await fs.mkdir(resolved, { recursive: true })
      return { message: `ディレクトリを作成しました: ${args.path}` }
    }
    case "copy": {
      const resolvedFrom = await assertInAvatarSpace(args.path)
      const resolvedTo = await assertInAvatarSpace(args.destPath)
      assertWritable(resolvedTo)
      await fs.mkdir(path.dirname(resolvedTo), { recursive: true })
      await fs.cp(resolvedFrom, resolvedTo, { recursive: true })
      return { message: `コピーしました: ${args.path} → ${args.destPath}` }
    }
  }
}

// --- refs/ 初期化 ---

/** refs/ディレクトリを準備する（同期・起動時に1回呼ぶ） */
export function ensureRefsReady(): void {
  const root = getAvatarSpaceRoot()
  const refsDir = path.join(root, REFS_DIR)
  fsSync.mkdirSync(refsDir, { recursive: true })
  log.info(`[FS] refs/ 準備完了: ${refsDir}`)
}
