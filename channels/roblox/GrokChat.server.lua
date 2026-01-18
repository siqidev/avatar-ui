-- GrokChat.lua
-- SPECTRAとの対話を処理するサーバースクリプト
-- 配置場所: ServerScriptService

local HttpService = game:GetService("HttpService")
local TextService = game:GetService("TextService")

-- SPECTRA API設定
local PROXY_URL = "https://spectra.siqi.jp/roblox"
local API_KEY = "YOUR_SPECTRA_API_KEY_HERE"  -- .envのSPECTRA_API_KEYと同じ値を設定

-- サーバー全体で1つの会話履歴
local serverResponseId = nil

-- テキストフィルタリング関数
local function filterText(text, playerId)
	local success, result = pcall(function()
		return TextService:FilterStringAsync(text, playerId)
	end)
	if success then
		local filtered = result:GetNonChatStringForBroadcastAsync()
		return filtered
	end
	return "[フィルタエラー]"
end

-- Grok APIを呼び出す関数
local function askGrok(playerName, prompt)
	local messageWithName = playerName .. ": " .. prompt

	local requestBody = {
		prompt = messageWithName
	}

	if serverResponseId then
		requestBody.previous_response_id = serverResponseId
	end

	local success, response = pcall(function()
		return HttpService:RequestAsync({
			Url = PROXY_URL,
			Method = "POST",
			Headers = {
				["Content-Type"] = "application/json",
				["X-API-Key"] = API_KEY
			},
			Body = HttpService:JSONEncode(requestBody)
		})
	end)

	if success and response.Success then
		local data = HttpService:JSONDecode(response.Body)
		if data.success then
			serverResponseId = data.response_id
			return data.text
		else
			return "エラー: " .. tostring(data.error)
		end
	else
		return "通信エラーが発生しました"
	end
end

-- RemoteEvent（チャットバブル表示用）
local bubbleEvent = Instance.new("RemoteEvent")
bubbleEvent.Name = "SpectraBubbleEvent"
bubbleEvent.Parent = game.ReplicatedStorage

-- RemoteFunction（クライアントからの呼び出し用）
local chatFunction = Instance.new("RemoteFunction")
chatFunction.Name = "GrokChatFunction"
chatFunction.Parent = game.ReplicatedStorage

-- クライアントからの呼び出しを処理
chatFunction.OnServerInvoke = function(player, message)
	print(player.Name .. " asked: " .. message)
	local response = askGrok(player.Name, message)
	print("SPECTRA (raw): " .. response)

	-- フィルタリング適用
	local filteredResponse = filterText(response, player.UserId)
	print("SPECTRA (filtered): " .. filteredResponse)

	-- 全クライアントにバブル表示を通知
	bubbleEvent:FireAllClients(filteredResponse)

	return filteredResponse
end

print("GrokChat server ready!")
