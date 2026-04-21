--[[
  ObservationClient — 観測イベントとACK送信の共通HTTPクライアント

  ObservationSenderおよび各OpsモジュールからACK/イベントを送信する共通基盤。
  認証ヘッダ管理、送信失敗時の警告を集約する。
]]

local HttpService = game:GetService("HttpService")

local Config = require(script.Parent.Config)

local module = {}

-- 共通HTTP送信（非同期、fire-and-forget）
function module.send(eventType: string, payload: { [string]: any })
	local data = {
		type = eventType,
		serverId = tostring(game.JobId),
		timestamp = os.date("!%Y-%m-%dT%H:%M:%SZ"),
		payload = payload,
	}

	local json = HttpService:JSONEncode(data)

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
				warn("[ObservationClient] HTTP失敗: " .. tostring(result.StatusCode) .. " " .. tostring(result.StatusMessage))
			end
		else
			warn("[ObservationClient] 送信失敗: " .. tostring(result))
		end
	end)
end

-- ACK送信（全操作共通）
function module.sendAck(intentId: string?, opIndex: number, opName: string, success: boolean, data: { [string]: any }?, errorInfo: { [string]: any }?, validation: { [string]: any }?)
	module.send("command_ack", {
		schema_version = "3",
		intent_id = intentId or "",
		category = "",
		op_index = opIndex,
		op = opName,
		success = success,
		data = data or {},
		error = errorInfo,
		meta = {
			validation = validation,
		},
	})
end

-- 最新display状態を取得（サーバー起動時のpull用）
function module.fetchLatestDisplays(): { { target: string, title: string, text: string } }?
	local url = Config.observationUrl .. "/display-state"
	local headers: { [string]: string } = {}
	if Config.observationSecret ~= "" then
		headers["Authorization"] = "Bearer " .. Config.observationSecret
	end

	local ok, result = pcall(function()
		return HttpService:RequestAsync({
			Url = url,
			Method = "GET",
			Headers = headers,
		})
	end)

	if not ok then
		warn("[ObservationClient] display-state取得失敗: " .. tostring(result))
		return nil
	end

	if not result.Success then
		warn("[ObservationClient] display-state HTTP " .. tostring(result.StatusCode))
		return nil
	end

	local decodeOk, data = pcall(function()
		return HttpService:JSONDecode(result.Body)
	end)

	if not decodeOk or not data or not data.displays then
		warn("[ObservationClient] display-state JSONデコード失敗")
		return nil
	end

	return data.displays
end

return module
