import { contextBridge } from "electron";

// レンダラから使える API を定義するプリロードスクリプトのエントリ
contextBridge.exposeInMainWorld("avatarBridge", {
  // 今後ブラウザ側に公開したい機能があればここへ追加する
});
