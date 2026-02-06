const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const nodePtyRoot = path.join(root, 'node_modules', 'node-pty');

const candidates = new Set([
  path.join(nodePtyRoot, 'build', 'Release', 'spawn-helper'),
  path.join(nodePtyRoot, 'prebuilds', 'darwin-arm64', 'spawn-helper'),
  path.join(nodePtyRoot, 'prebuilds', 'darwin-x64', 'spawn-helper'),
  path.join(nodePtyRoot, 'prebuilds', 'linux-arm64', 'spawn-helper'),
  path.join(nodePtyRoot, 'prebuilds', 'linux-x64', 'spawn-helper'),
]);

const prebuildsDir = path.join(nodePtyRoot, 'prebuilds');
if (fs.existsSync(prebuildsDir)) {
  for (const entry of fs.readdirSync(prebuildsDir)) {
    candidates.add(path.join(prebuildsDir, entry, 'spawn-helper'));
  }
}

let fixed = 0;
for (const target of candidates) {
  try {
    if (!fs.existsSync(target)) {
      continue;
    }
    fs.chmodSync(target, 0o755);
    fixed += 1;
    console.log(`[fix-pty-perms] chmod +x ${target}`);
  } catch (error) {
    console.warn(`[fix-pty-perms] failed ${target}: ${error.message}`);
  }
}

if (fixed === 0) {
  console.log('[fix-pty-perms] no spawn-helper found');
}
