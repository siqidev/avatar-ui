--[[
  WorldStore — AI生成オブジェクトの永続化モジュール

  DataStoreにパーツデータを自動保存し、サーバー起動時に復元する。
  操作のたびに裏で自動保存されるため、ユーザーが明示的にセーブする必要はない。
]]

local DataStoreService = game:GetService("DataStoreService")
local HttpService = game:GetService("HttpService")

local STORE_NAME = "AIWorldData"
local PARTS_KEY = "parts_v1"
local TERRAIN_KEY = "terrain_v1"
local EFFECTS_KEY = "effects_v1"

local store = DataStoreService:GetDataStore(STORE_NAME)

local module = {}

-- パーツデータの保存
function module.saveParts(partsData)
	local ok, err = pcall(function()
		store:SetAsync(PARTS_KEY, HttpService:JSONEncode(partsData))
	end)
	if not ok then
		warn("[WorldStore] パーツ保存失敗: " .. tostring(err))
	end
end

-- パーツデータの読み込み
function module.loadParts()
	local ok, raw = pcall(function()
		return store:GetAsync(PARTS_KEY)
	end)
	if not ok or not raw then
		return {}
	end
	local decodeOk, data = pcall(function()
		return HttpService:JSONDecode(raw)
	end)
	if not decodeOk then
		return {}
	end
	return data
end

-- エフェクトデータの保存
function module.saveEffects(effectsData)
	local ok, err = pcall(function()
		store:SetAsync(EFFECTS_KEY, HttpService:JSONEncode(effectsData))
	end)
	if not ok then
		warn("[WorldStore] エフェクト保存失敗: " .. tostring(err))
	end
end

-- エフェクトデータの読み込み
function module.loadEffects()
	local ok, raw = pcall(function()
		return store:GetAsync(EFFECTS_KEY)
	end)
	if not ok or not raw then
		return {}
	end
	local decodeOk, data = pcall(function()
		return HttpService:JSONDecode(raw)
	end)
	if not decodeOk then
		return {}
	end
	return data
end

-- 地形データの保存
function module.saveTerrain(terrainData)
	local ok, err = pcall(function()
		store:SetAsync(TERRAIN_KEY, HttpService:JSONEncode(terrainData))
	end)
	if not ok then
		warn("[WorldStore] 地形保存失敗: " .. tostring(err))
	end
end

-- 地形データの読み込み
function module.loadTerrain()
	local ok, raw = pcall(function()
		return store:GetAsync(TERRAIN_KEY)
	end)
	if not ok or not raw then
		return {}
	end
	local decodeOk, data = pcall(function()
		return HttpService:JSONDecode(raw)
	end)
	if not decodeOk then
		return {}
	end
	return data
end

return module
