# SPECTRA Command Console (Electron)

Static UI shell wired to `index.html`.
Consoleはfail-fast方針で、設定/APIの欠落は即エラー表示して停止します。
チャット領域の下に内蔵端末を常時表示します。

必須環境変数:
- `AVATAR_SHELL`（bashのフルパス）

任意環境変数:
- `AVATAR_SPACE`（Avatar Spaceの作業ディレクトリ。未指定なら `~/Avatar/space`）

## Run

```bash
cd command/console
npm install
npm run start
```
