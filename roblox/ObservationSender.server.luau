--[[
  ObservationSender — Roblox内イベントを外部（場）にPush送信するサーバースクリプト

  配置場所: ServerScriptService
  前提: HttpServiceを有効化済み
  設定: modules/Config を編集する

  観測イベント:
  - player_proximity: プレイヤーが指定範囲に入った/出た
  - player_chat: プレイヤーがチャットメッセージを送信した
  - projection_ack: CommandReceiverの実行結果（将来用）

  送信先: Config.observationUrl（HttpServiceでPOST）
]]

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
-- TextChatService.MessageReceivedはクライアント専用のためPlayer.Chattedを使用

-- 設定読み込み（オブジェクト名が "CommandReceiver.server" のためブラケット記法）
local Config = require(script.Parent["CommandReceiver.server"].modules.Config)

-- NPC参照
local function findNPC()
	for _, obj in ipairs(workspace:GetDescendants()) do
		if obj.Name == Config.npcName and obj:IsA("Model") then
			return obj
		end
	end
	return nil
end

-- 観測イベントを送信する
local function sendObservation(eventType, payload)
	local data = {
		type = eventType,
		serverId = tostring(game.JobId),
		timestamp = os.date("!%Y-%m-%dT%H:%M:%SZ"),
		payload = payload,
	}

	local json = HttpService:JSONEncode(data)

	-- 認証ヘッダ（シークレット設定時のみ）
	local headers: { [string]: string } = {
		["Content-Type"] = "application/json",
	}
	if Config.observationSecret ~= "" then
		headers["Authorization"] = "Bearer " .. Config.observationSecret
	end

	task.spawn(function()
		local ok, result = pcall(function()
			return HttpService:RequestAsync({
				Url = Config.observationUrl,
				Method = "POST",
				Headers = headers,
				Body = json,
			})
		end)
		if ok then
			if not result.Success then
				warn("[ObservationSender] HTTP失敗: " .. tostring(result.StatusCode) .. " " .. tostring(result.StatusMessage))
			end
		else
			warn("[ObservationSender] 送信失敗: " .. tostring(result))
		end
	end)
end

-- オーナーかどうか判定（ownerUserId=0なら全員通過）
local function isOwner(player)
	if Config.ownerUserId == 0 then return true end
	return player.UserId == Config.ownerUserId
end

-- 接近検知（定期チェック）
local nearbyPlayers = {} -- { [userId] = true }

local function checkProximity()
	local npc = findNPC()
	if not npc or not npc.PrimaryPart then return end

	local npcPos = npc.PrimaryPart.Position

	for _, player in ipairs(Players:GetPlayers()) do
		if not isOwner(player) then continue end
		local character = player.Character
		if not character or not character.PrimaryPart then continue end

		local distance = (character.PrimaryPart.Position - npcPos).Magnitude
		local wasNear = nearbyPlayers[player.UserId]
		local isNear = distance <= Config.proximityRange

		if isNear and not wasNear then
			nearbyPlayers[player.UserId] = true
			sendObservation("player_proximity", {
				player = player.Name,
				userId = player.UserId,
				isOwner = isOwner(player),
				action = "enter",
				distance = math.floor(distance),
			})
			print("[ObservationSender] 接近検知: " .. player.Name)
		elseif not isNear and wasNear then
			nearbyPlayers[player.UserId] = nil
			sendObservation("player_proximity", {
				player = player.Name,
				userId = player.UserId,
				isOwner = isOwner(player),
				action = "leave",
				distance = math.floor(distance),
			})
			print("[ObservationSender] 離脱検知: " .. player.Name)
		end
	end
end

-- プレイヤー退出時のクリーンアップ
Players.PlayerRemoving:Connect(function(player)
	if nearbyPlayers[player.UserId] then
		nearbyPlayers[player.UserId] = nil
		sendObservation("player_proximity", {
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

	sendObservation("player_chat", {
		player = player.Name,
		userId = player.UserId,
		isOwner = isOwner(player),
		message = message,
	})
	print("[ObservationSender] チャット検知: " .. player.Name .. " > " .. message)
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

print("[ObservationSender] 起動 — URL: " .. Config.observationUrl)
