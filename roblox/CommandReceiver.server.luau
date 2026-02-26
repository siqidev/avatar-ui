--[[
  CommandReceiver v3 — 外部AIからの操作を受信し、CommandRegistry経由で実行するサーバースクリプト

  配置場所: ServerScriptService
  前提: ゲーム設定でHttpServiceを有効化済み、DataStoreアクセスを有効化済み

  v3変更点:
  - CommandRegistryによる登録型ルーティング（カテゴリ追加時にこのファイルの修正不要）
  - intent_id伝播と共通ACK返却
  - 新カテゴリ: build, spatial, npc_motion

  メッセージ形式:
  { "schema_version": "3", "intent_id": "uuid", "category": "...", "ops": [...], "reason": "..." }
  ※ v2形式（schema_versionなし）も後方互換で受付
]]

local MessagingService = game:GetService("MessagingService")
local HttpService = game:GetService("HttpService")

-- モジュール読み込み
local CommandRegistry = require(script.modules.CommandRegistry)
local ObservationClient = require(script.modules.ObservationClient)

-- プロトコル定数（TypeScript側projector.tsのMESSAGE_TOPICと一致）
local MESSAGE_TOPIC = "AICommands"

-- カテゴリ別モジュールを登録
CommandRegistry.register("part", require(script.modules.PartOps))
CommandRegistry.register("terrain", require(script.modules.TerrainOps))
CommandRegistry.register("npc", require(script.modules.NpcOps))
CommandRegistry.register("npc_motion", require(script.modules.NpcMotionOps))
CommandRegistry.register("effect", require(script.modules.EffectOps))
CommandRegistry.register("build", require(script.modules.BuildOps))
CommandRegistry.register("spatial", require(script.modules.SpatialService))

-- 起動時復元（DataStoreから前回の状態を読み込み）
print("[CommandReceiver] DataStoreから復元中...")
local restoreOk, restoreErr = pcall(function()
	local partOps = CommandRegistry.resolve("part")
	if partOps and partOps.restore then partOps.restore() end
	local terrainOps = CommandRegistry.resolve("terrain")
	if terrainOps and terrainOps.restore then terrainOps.restore() end
	local effectOps = CommandRegistry.resolve("effect")
	if effectOps and effectOps.restore then effectOps.restore() end
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
	local intentId = data.intent_id

	if not category or not ops then
		warn("[CommandReceiver] 不正なメッセージ形式（category/ops必須）: " .. tostring(message.Data))
		return
	end

	print("[CommandReceiver] 受信: category=" .. category .. " ops=" .. #ops .. (intentId and (" intent=" .. intentId) or ""))

	local handler = CommandRegistry.resolve(category)
	if not handler then
		warn("[CommandReceiver] 未知のカテゴリ: " .. category)
		ObservationClient.sendAck(intentId, 0, "unknown", false, nil, {
			code = "UNKNOWN_CATEGORY",
			message = "未知のカテゴリ: " .. category,
			retryable = false,
		})
		return
	end

	local execOk, execResult = pcall(function()
		return handler.execute(ops)
	end)

	if not execOk then
		warn("[CommandReceiver] 実行エラー (" .. category .. "): " .. tostring(execResult))
		ObservationClient.sendAck(intentId, 0, category, false, nil, {
			code = "EXECUTION_ERROR",
			message = tostring(execResult),
			retryable = true,
		})
		return
	end

	-- 結果がテーブル（ACK対応モジュール）なら個別ACKを送信
	if type(execResult) == "table" then
		for i, result in ipairs(execResult) do
			if type(result) == "table" and result.success ~= nil then
				ObservationClient.sendAck(
					intentId,
					i - 1,
					ops[i] and ops[i].op or category,
					result.success,
					result.data,
					result.error,
					result.meta and result.meta.validation or nil
				)
			end
		end
	end
end)

print("[CommandReceiver] v3 起動 — トピック '" .. MESSAGE_TOPIC .. "' で待機中")
print("[CommandReceiver] 登録カテゴリ: " .. table.concat(CommandRegistry.categories(), ", "))
