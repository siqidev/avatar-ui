-- GrokChat.lua
-- SPECTRAとの対話を処理するサーバースクリプト
-- 配置場所: ServerScriptService

local HttpService = game:GetService("HttpService")
local TextService = game:GetService("TextService")

-- SPECTRA API設定
local PROXY_URL = "https://spectra.siqi.jp/roblox"
local API_KEY = "YOUR_AVATAR_API_KEY_HERE"  -- .envのAVATAR_API_KEYと同じ値を設定

-- APIキーが未設定なら早期に止める。
if API_KEY == "YOUR_AVATAR_API_KEY_HERE" then
	error("SPECTRA API key is not configured")
end

-- サーバー全体で1つの会話履歴
local serverResponseId = nil

-- テキストフィルタリング関数
local function filterText(text, playerId)
	local success, result = pcall(function()
		return TextService:FilterStringAsync(text, playerId)
	end)
	if not success then
		error("Text filter failed: " .. tostring(result))
	end
	-- フィルタ処理に成功したら、その結果を返す。
	return result:GetNonChatStringForBroadcastAsync()
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

	if not success then
		error("HTTP request failed: " .. tostring(response))
	end
	if not response.Success then
		error("HTTP error: " .. tostring(response.StatusCode) .. " " .. tostring(response.StatusMessage))
	end

	local decodeOk, data = pcall(function()
		return HttpService:JSONDecode(response.Body)
	end)
	if not decodeOk then
		error("Invalid JSON response: " .. tostring(data))
	end
	if not data.success then
		error("API error: " .. tostring(data.error))
	end
	if not data.response_id then
		error("response_id is missing")
	end

	-- 成功時のみresponse_idを更新して返す。
	serverResponseId = data.response_id
	return data.text
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
