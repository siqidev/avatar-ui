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

return module
