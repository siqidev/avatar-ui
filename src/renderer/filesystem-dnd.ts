export type MoveValidationResult =
  | { ok: true; destPath: string }
  | { ok: false; destPath: string }

export function getParentDir(targetPath: string): string {
  return targetPath.includes("/") ? targetPath.substring(0, targetPath.lastIndexOf("/")) : "."
}

export function getBaseName(targetPath: string): string {
  return targetPath.includes("/") ? targetPath.substring(targetPath.lastIndexOf("/") + 1) : targetPath
}

export function joinPath(dirPath: string, name: string): string {
  return dirPath === "." ? name : `${dirPath}/${name}`
}

export function isDescendant(ancestorPath: string, targetPath: string): boolean {
  if (ancestorPath === "." || targetPath === ".") return false
  return targetPath.startsWith(`${ancestorPath}/`)
}

export function validateTreeMove(sourcePath: string, destDir: string): MoveValidationResult {
  const destPath = joinPath(destDir, getBaseName(sourcePath))
  if (sourcePath === destDir || getParentDir(sourcePath) === destDir || isDescendant(sourcePath, destDir)) {
    return { ok: false, destPath }
  }
  return { ok: true, destPath }
}

export function rewritePathPrefix(targetPath: string, fromPath: string, toPath: string): string {
  if (targetPath === fromPath) return toPath
  if (targetPath.startsWith(`${fromPath}/`)) {
    return `${toPath}${targetPath.slice(fromPath.length)}`
  }
  return targetPath
}
