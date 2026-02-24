--[[
  Config — Roblox側の全設定を集約するモジュール

  セットアップ: このファイルを Config.luau にコピーして値を書き換える
  配置場所: CommandReceiver.server > modules > Config（ModuleScript）
  ※ Config.luau は .gitignore 済み（個人値がリポジトリに入らない）
]]

return {
	-- 観測イベントの送信先URL（TypeScript側のObservationServerのアドレス）
	-- Studio（ローカル開発）: http://localhost:3001/observation
	-- 本番: トンネルや公開サーバーのURLに変更する
	observationUrl = "http://localhost:3001/observation",

	-- 観測送信の認証シークレット（TypeScript側の ROBLOX_OBSERVATION_SECRET と一致させる）
	-- 空文字列 = 認証なし（ローカル開発用）
	-- 本番では必ず設定すること
	observationSecret = "",

	-- オーナーのRoblox UserID（このユーザーのチャット・接近のみ検知する）
	-- 0 = 全プレイヤーの観測を送信
	-- 確認方法: roblox.comのプロフィールURL https://www.roblox.com/users/XXXXXXXX/profile のXXXXXXXX
	ownerUserId = 0,

	-- NPCの名前（Workspace内のModelの名前と一致させる）
	npcName = "NPC",

	-- 接近検知の距離（スタッド）
	proximityRange = 30,

	-- 接近チェック間隔（秒）
	proximityCheckInterval = 3,
}
