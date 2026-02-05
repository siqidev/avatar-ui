-- ChatClient.lua
-- チャット + バブル表示
-- 配置場所: StarterPlayerScripts

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TextChatService = game:GetService("TextChatService")
local Chat = game:GetService("Chat")

-- サーバーのRemoteFunctionとRemoteEventを取得
local chatFunction = ReplicatedStorage:WaitForChild("GrokChatFunction", 10)
local bubbleEvent = ReplicatedStorage:WaitForChild("SpectraBubbleEvent", 10)

-- SPECTRAキャラを取得
local spectraCharacter = workspace:WaitForChild("SpectraCommunicator", 10)

-- 必須オブジェクトが無ければ即エラーにする。
assert(chatFunction, "GrokChatFunction not found")
assert(bubbleEvent, "SpectraBubbleEvent not found")
assert(spectraCharacter, "SpectraCommunicator not found")

-- バブル表示を受信したとき
bubbleEvent.OnClientEvent:Connect(function(response)
	-- SPECTRAの頭上にバブル表示（旧式Chat:Chatを使用）
	local head = spectraCharacter:FindFirstChild("Head")
	assert(head, "SpectraCommunicator.Head not found")
	Chat:Chat(head, response, Enum.ChatColor.Blue)
end)

-- TextChatServiceのメッセージを監視
TextChatService.MessageReceived:Connect(function(textChatMessage)
	local message = textChatMessage.Text
	local sender = textChatMessage.TextSource

	-- 自分のメッセージかつ @spectra で始まる場合
	if sender and sender.UserId == Players.LocalPlayer.UserId then
		if string.lower(string.sub(message, 1, 8)) == "@spectra" then
			local prompt = string.sub(message, 10)
			print("Sending to SPECTRA: " .. prompt)

			-- サーバー経由でGrokに問い合わせ
			local response = chatFunction:InvokeServer(prompt)
			print("Got response: " .. response)

			-- チャット欄に表示
			local channel = TextChatService.TextChannels:FindFirstChild("RBXGeneral")
			assert(channel, "RBXGeneral channel not found")
			channel:DisplaySystemMessage("[SPECTRA] " .. response)
		end
	end
end)

print("ChatClient ready!")
