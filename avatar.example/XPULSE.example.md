# XPULSE（テンプレート）

X（Twitter）向け定期実行時にアバターに渡すプロンプト。
ルート直下に XPULSE.md としてコピーするか、AVATAR_DIR で指定したディレクトリに配置する。

## 素材の読み込み

XPulse実行時、AIはfs_read/fs_listツールを使用できる。
XPULSE.md内で読むべきファイルを指示すれば、AIが自分で読んで投稿に反映する。

```markdown
# 素材の読み込み
投稿前にfs_readで以下のファイルを読み、内容を踏まえて投稿する:
- refs/self/CHANGELOG.md
- refs/self/package.json
```

refs/ 配下にシンボリックリンクで外部リポジトリへの参照を配置できる（例: `ln -s /path/to/repo <avatar-space>/refs/myrepo`）。
