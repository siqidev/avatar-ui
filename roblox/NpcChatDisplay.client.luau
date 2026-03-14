--[[
  NpcChatDisplay — NPCの発話をチャット履歴に表示するクライアントスクリプト

  配置場所: StarterGui
  前提: NpcOps.luauがNpcChatEvent（RemoteEvent）を生成済み
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TextChatService = game:GetService("TextChatService")

-- NpcOps.luauが作成するRemoteEventの名前と一致させる
local CHAT_EVENT_NAME = "NpcChatEvent"
-- チャット履歴に表示する色（表示名はサーバーから受信）
local DEFAULT_DISPLAY_NAME = "Avatar"
local DISPLAY_COLOR = "#4EA4F2"

local chatEvent = ReplicatedStorage:WaitForChild(CHAT_EVENT_NAME, 10)
if not chatEvent then
	warn("[NpcChatDisplay] " .. CHAT_EVENT_NAME .. "が見つかりません")
	return
end

chatEvent.OnClientEvent:Connect(function(text, displayName)
	local name = displayName or DEFAULT_DISPLAY_NAME
	local channel = TextChatService.TextChannels:FindFirstChild("RBXGeneral")
	if channel then
		channel:DisplaySystemMessage('<font color="' .. DISPLAY_COLOR .. '"><b>' .. name .. ':</b></font> ' .. text)
	end
end)

print("[NpcChatDisplay] 起動")
