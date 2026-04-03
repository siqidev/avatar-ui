# XPULSE（テンプレート）

X（Twitter）向け定期実行時にアバターに渡すプロンプト。
ルート直下に XPULSE.md としてコピーするか、AVATAR_DIR で指定したディレクトリに配置する。

XPulseではfs_read/fs_listツールが利用可能。refs/self/ 配下に自分のリポジトリが参照としてマウントされる。
素材取得の例: `fs_read("refs/self/CHANGELOG.md")`
