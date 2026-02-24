--[[
  SpectraChatDisplay — Spectraの発話をチャット履歴に表示するクライアントスクリプト

  配置場所: StarterGui
  前提: NpcOps.luauがSpectraChatEvent（RemoteEvent）を生成済み
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TextChatService = game:GetService("TextChatService")

local chatEvent = ReplicatedStorage:WaitForChild("SpectraChatEvent", 10)
if not chatEvent then
	warn("[SpectraChatDisplay] SpectraChatEventが見つかりません")
	return
end

chatEvent.OnClientEvent:Connect(function(text)
	local channel = TextChatService.TextChannels:FindFirstChild("RBXGeneral")
	if channel then
		channel:DisplaySystemMessage('<font color="#4EA4F2"><b>Spectra:</b></font> ' .. text)
	end
end)

print("[SpectraChatDisplay] 起動")
