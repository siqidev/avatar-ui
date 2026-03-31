# /deploy — spectraデプロイ

devブランチの最新コードをspectra (VPS) にデプロイする。

## 手順

1. **push**: `git push origin dev`
2. **pull + build**: `ssh spectra "cd avatar-ui && git pull && npm run build"`
3. **.env同期**（差分がある場合のみ）:
   - ローカル.envをscpで転送: `scp .env spectra:avatar-ui/.env`
   - **必ずAVATAR_SPACEを修正**: `ssh spectra "sed -i 's|AVATAR_SPACE=.*|AVATAR_SPACE=/home/exedev/avatar-space|' ~/avatar-ui/.env"`
   - AVATAR_SPACEはマシン固有値。ローカル=`/Users/u/Avatar/space`、spectra=`/home/exedev/avatar-space`
   - .envに変更がなければこのステップはスキップしてよい
4. **再起動**: `ssh spectra "sudo systemctl restart avatar-ui"`
5. **起動確認**: `ssh spectra "sleep 5 && sudo systemctl status avatar-ui --no-pager && tail -10 ~/avatar-ui/data/app.log"`
   - `Active: active (running)` であること
   - app.logに `[HEADLESS] 起動完了` が出ていること
   - エラーがないこと

## 注意事項

- ログは `~/avatar-ui/data/app.log`（`/tmp/avatar-ui.log` ではない）
- journalctlでも確認可: `ssh spectra "journalctl -u avatar-ui --no-pager -n 30"`
- systemdが `on-failure` で自動再起動する（5秒待機）
- VM再起動時も自動起動（`enabled`）
