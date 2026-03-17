import * as fs from "node:fs/promises"
import * as path from "node:path"
import { getConfig } from "../config.js"
import type {
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

/** Avatar Space のルートパス（正規化済み、環境変数を動的に参照） */
function getAvatarSpaceRoot(): string {
  return path.resolve(getConfig().avatarSpace)
}

/** パスがAvatar Space内であることを検証（symlink解決込み）。違反時はthrow */
async function assertInAvatarSpace(targetPath: string): Promise<string> {
  const root = getAvatarSpaceRoot()
  const resolved = path.resolve(root, targetPath)
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(`Avatar Space外へのアクセスは拒否されました: ${targetPath}`)
  }
  // symlink解決: リンク先の実体パスもAvatar Space内か検証
  // root自体もrealpath解決する（macOSの/var→/private/var等に対応）
  try {
    const realRoot = await fs.realpath(root)
    const real = await fs.realpath(resolved)
    if (!real.startsWith(realRoot + path.sep) && real !== realRoot) {
      throw new Error(`リンク先がAvatar Space外です: ${targetPath} → ${real}`)
    }
  } catch (e) {
    // ENOENT: ファイルが存在しない場合はsymlink検証不要（write/mkdir等の新規作成）
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e
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
      const stat = await fs.stat(fullPath)
      return {
        name: d.name,
        type: d.isDirectory() ? "directory" as const : "file" as const,
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
    const lines = content.split("\n")
    const offset = args.offset ?? 0
    const limit = args.limit ?? lines.length
    const sliced = lines.slice(offset, offset + limit).join("\n")
    return { path: args.path, content: sliced, mtimeMs: stat.mtimeMs }
  }

  return { path: args.path, content, mtimeMs: stat.mtimeMs }
}

export async function fsWrite(args: FsWriteArgs): Promise<FsWriteResult> {
  const resolved = await assertInAvatarSpace(args.path)

  // 親ディレクトリの自動作成
  await fs.mkdir(path.dirname(resolved), { recursive: true })
  // AIがリテラル \n / \t を送る場合があるため実際の制御文字に変換
  const normalized = args.content.replace(/\\n/g, "\n").replace(/\\t/g, "\t")
  await fs.writeFile(resolved, normalized, "utf-8")
  const stat = await fs.stat(resolved)

  return { path: args.path, bytes: stat.size, mtimeMs: stat.mtimeMs }
}

export async function fsMutate(args: FsMutateArgs): Promise<FsMutateResult> {
  switch (args.op) {
    case "delete": {
      const resolved = await assertInAvatarSpace(args.path)
      await fs.rm(resolved, { recursive: true })
      return { message: `削除しました: ${args.path}` }
    }
    case "rename": {
      const resolvedFrom = await assertInAvatarSpace(args.path)
      const resolvedTo = await assertInAvatarSpace(args.newPath)
      await fs.mkdir(path.dirname(resolvedTo), { recursive: true })
      await fs.rename(resolvedFrom, resolvedTo)
      return { message: `リネームしました: ${args.path} → ${args.newPath}` }
    }
    case "mkdir": {
      const resolved = await assertInAvatarSpace(args.path)
      await fs.mkdir(resolved, { recursive: true })
      return { message: `ディレクトリを作成しました: ${args.path}` }
    }
    case "copy": {
      const resolvedFrom = await assertInAvatarSpace(args.path)
      const resolvedTo = await assertInAvatarSpace(args.destPath)
      await fs.mkdir(path.dirname(resolvedTo), { recursive: true })
      await fs.cp(resolvedFrom, resolvedTo, { recursive: true })
      return { message: `コピーしました: ${args.path} → ${args.destPath}` }
    }
  }
}
