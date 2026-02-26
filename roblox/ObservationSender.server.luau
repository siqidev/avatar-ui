--[[
  ObservationSender v3 — Roblox内イベントを外部（場）にPush送信するサーバースクリプト

  配置場所: ServerScriptService
  前提: HttpServiceを有効化済み
  設定: modules/Config を編集する

  v3変更点:
  - ObservationClient経由で送信（重複ロジック排除）
  - SpatialService経由でNPC検索

  観測イベント:
  - player_proximity: プレイヤーが指定範囲に入った/出た
  - player_chat: プレイヤーがチャットメッセージを送信した
]]

local Players = game:GetService("Players")
local LogService = game:GetService("LogService")

-- 設定読み込み（オブジェクト名が "CommandReceiver.server" のためブラケット記法）
local Config = require(script.Parent["CommandReceiver.server"].modules.Config)
local ObservationClient = require(script.Parent["CommandReceiver.server"].modules.ObservationClient)
local SpatialService = require(script.Parent["CommandReceiver.server"].modules.SpatialService)

-- オーナーかどうか判定（ownerUserId=0なら全員通過）
local function isOwner(player)
	if Config.ownerUserId == 0 then return true end
	return player.UserId == Config.ownerUserId
end

-- 接近検知（定期チェック）
local nearbyPlayers = {} -- { [userId] = true }

local function checkProximity()
	local npc = SpatialService.findNpc()
	if not npc then return end
	local npcRoot = SpatialService.getRootPart(npc)
	if not npcRoot then return end

	local npcPos = npcRoot.Position

	for _, player in ipairs(Players:GetPlayers()) do
		if not isOwner(player) then continue end
		local character = player.Character
		if not character then continue end
		local charRoot = SpatialService.getRootPart(character)
		if not charRoot then continue end

		local distance = (charRoot.Position - npcPos).Magnitude
		local wasNear = nearbyPlayers[player.UserId]
		local isNear = distance <= Config.proximityRange

		if isNear and not wasNear then
			nearbyPlayers[player.UserId] = true
			ObservationClient.send("player_proximity", {
				player = player.Name,
				userId = player.UserId,
				isOwner = isOwner(player),
				action = "enter",
				distance = math.floor(distance),
			})
		elseif not isNear and wasNear then
			nearbyPlayers[player.UserId] = nil
			ObservationClient.send("player_proximity", {
				player = player.Name,
				userId = player.UserId,
				isOwner = isOwner(player),
				action = "leave",
				distance = math.floor(distance),
			})
		end
	end
end

-- プレイヤー退出時のクリーンアップ
Players.PlayerRemoving:Connect(function(player)
	if nearbyPlayers[player.UserId] then
		nearbyPlayers[player.UserId] = nil
		ObservationClient.send("player_proximity", {
			player = player.Name,
			userId = player.UserId,
			isOwner = isOwner(player),
			action = "leave",
			distance = -1,
		})
	end
end)

-- チャット検知（Player.Chatted: サーバーで発火するイベント）
local function onPlayerChatted(player, message)
	if not isOwner(player) then return end
	if message == nil or message == "" then return end

	ObservationClient.send("player_chat", {
		player = player.Name,
		userId = player.UserId,
		isOwner = isOwner(player),
		message = message,
	})
end

local function bindPlayerChat(player)
	player.Chatted:Connect(function(message)
		onPlayerChatted(player, message)
	end)
end

for _, player in ipairs(Players:GetPlayers()) do
	bindPlayerChat(player)
end

Players.PlayerAdded:Connect(bindPlayerChat)

-- 接近検知ループ
task.spawn(function()
	while true do
		checkProximity()
		task.wait(Config.proximityCheckInterval)
	end
end)

-- ログ転送（自スクリプトのログは除外して無限ループ防止）
LogService.MessageOut:Connect(function(message, messageType)
	-- [ObservationClient] のログは除外（送信処理自体のログで無限ループになる）
	if string.find(message, "%[ObservationClient%]") then return end
	-- カスタムモジュールのログのみ転送（[ModuleName] パターン）
	if not string.match(message, "^%[%w") then return end
	ObservationClient.send("roblox_log", {
		message = message,
		level = tostring(messageType),
	})
end)

print("[ObservationSender] v3 起動 — URL: " .. Config.observationUrl)
