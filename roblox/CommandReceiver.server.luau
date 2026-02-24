--[[
  CommandReceiver v2 — 外部AIからの操作を受信してカテゴリ別モジュールに振り分けるサーバースクリプト

  配置場所: ServerScriptService
  前提: ゲーム設定でHttpServiceを有効化済み、DataStoreアクセスを有効化済み

  メッセージ形式:
  { "category": "part"|"terrain"|"npc"|"effect", "ops": [...] }

  各カテゴリのモジュールが create/set/delete 等の低レベル操作を実行する。
  起動時にDataStoreから前回のオブジェクト・地形・エフェクトを自動復元する。
]]

local MessagingService = game:GetService("MessagingService")
local HttpService = game:GetService("HttpService")

-- 設定読み込み
local Config = require(script.modules.Config)

-- プロトコル定数（TypeScript側projector.tsのMESSAGE_TOPICと一致）
local MESSAGE_TOPIC = "AICommands"

-- カテゴリ別モジュール
local handlers = {
	part = require(script.modules.PartOps),
	terrain = require(script.modules.TerrainOps),
	npc = require(script.modules.NpcOps),
	effect = require(script.modules.EffectOps),
}

-- 起動時復元（DataStoreから前回の状態を読み込み）
print("[CommandReceiver] DataStoreから復元中...")
local restoreOk, restoreErr = pcall(function()
	handlers.part.restore()
	handlers.terrain.restore()
	handlers.effect.restore()
end)
if not restoreOk then
	warn("[CommandReceiver] 復元エラー: " .. tostring(restoreErr))
end

-- メッセージ受信
MessagingService:SubscribeAsync(MESSAGE_TOPIC, function(message)
	local ok, data = pcall(function()
		return HttpService:JSONDecode(message.Data)
	end)

	if not ok or not data then
		warn("[CommandReceiver] JSONデコード失敗: " .. tostring(message.Data))
		return
	end

	local category = data.category
	local ops = data.ops

	if not category or not ops then
		warn("[CommandReceiver] 不正なメッセージ形式（category/ops必須）: " .. tostring(message.Data))
		return
	end

	print("[CommandReceiver] 受信: category=" .. category .. " ops=" .. #ops)

	local handler = handlers[category]
	if handler then
		local execOk, execErr = pcall(function()
			handler.execute(ops)
		end)
		if not execOk then
			warn("[CommandReceiver] 実行エラー (" .. category .. "): " .. tostring(execErr))
		end
	else
		warn("[CommandReceiver] 未知のカテゴリ: " .. category)
	end
end)

print("[CommandReceiver] v2 起動 — トピック '" .. MESSAGE_TOPIC .. "' で待機中")
