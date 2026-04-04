# XPULSE（テンプレート）

X（Twitter）向け定期実行時にアバターに渡すプロンプト。
ルート直下に XPULSE.md としてコピーするか、AVATAR_DIR で指定したディレクトリに配置する。

## 素材ファイル機能

`# 素材ファイル` セクションにAvatar Space相対パスを列挙すると、XPulse実行時にアプリが自動読み込みしてプロンプトに添付する。AIがfs_readで探索する必要がなく、1ラウンドで完結する。

```markdown
# 素材ファイル
- refs/self/CHANGELOG.md
- refs/self/package.json
```

refs/ 配下にシンボリックリンクで外部リポジトリへの参照を配置できる（例: `ln -s /path/to/repo <avatar-space>/refs/myrepo`）。
