--[[
  ObservationSender — Roblox内イベントを外部（場）にPush送信するサーバースクリプト

  配置場所: ServerScriptService
  前提: HttpServiceを有効化済み

  観測イベント:
  - player_proximity: プレイヤーが指定範囲に入った/出た
  - player_chat: プレイヤーがチャットメッセージを送信した
  - projection_ack: CommandReceiverの実行結果（将来用）

  送信先: OBSERVATION_URL（HttpServiceでPOST）
]]

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local TextChatService = game:GetService("TextChatService")

-- 設定
local OBSERVATION_URL = "http://localhost:3001/observation"
local OWNER_USER_ID = 0 -- オーナーのRoblox UserID（0=全員の観測を送信）
local PROXIMITY_RANGE = 30 -- 接近検知の距離（スタッド）
local PROXIMITY_CHECK_INTERVAL = 3 -- 接近チェック間隔（秒）
local NPC_NAME = "SpectraCommunicator"

-- NPC参照
local function findNPC()
	for _, obj in ipairs(workspace:GetDescendants()) do
		if obj.Name == NPC_NAME and obj:IsA("Model") then
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

	task.spawn(function()
		local ok, err = pcall(function()
			HttpService:PostAsync(OBSERVATION_URL, json, Enum.HttpContentType.ApplicationJson)
		end)
		if not ok then
			warn("[ObservationSender] 送信失敗: " .. tostring(err))
		end
	end)
end

-- オーナーかどうか判定（OWNER_USER_ID=0なら全員通過）
local function isOwner(player)
	if OWNER_USER_ID == 0 then return true end
	return player.UserId == OWNER_USER_ID
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
		local isNear = distance <= PROXIMITY_RANGE

		if isNear and not wasNear then
			nearbyPlayers[player.UserId] = true
			sendObservation("player_proximity", {
				player = player.Name,
				userId = player.UserId,
				action = "enter",
				distance = math.floor(distance),
			})
			print("[ObservationSender] 接近検知: " .. player.Name)
		elseif not isNear and wasNear then
			nearbyPlayers[player.UserId] = nil
			sendObservation("player_proximity", {
				player = player.Name,
				userId = player.UserId,
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
			action = "leave",
			distance = -1,
		})
	end
end)

-- チャット検知
TextChatService.MessageReceived:Connect(function(message)
	local source = message.TextSource
	if not source then return end

	local player = Players:GetPlayerByUserId(source.UserId)
	if not player then return end
	if not isOwner(player) then return end

	sendObservation("player_chat", {
		player = player.Name,
		userId = player.UserId,
		message = message.Text,
	})
	print("[ObservationSender] チャット検知: " .. player.Name .. " > " .. message.Text)
end)

-- 接近検知ループ
task.spawn(function()
	while true do
		checkProximity()
		task.wait(PROXIMITY_CHECK_INTERVAL)
	end
end)

print("[ObservationSender] 起動 — URL: " .. OBSERVATION_URL)
