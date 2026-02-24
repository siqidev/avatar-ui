--[[
  EffectOps — 演出操作モジュール（照明・パーティクル・音）

  操作: create / set / delete
  照明やパーティクルを既存パーツに付与したり、単独で配置する
  全操作は自動的にDataStoreに永続化される
]]

local CollectionService = game:GetService("CollectionService")

local WorldStore = require(script.Parent.WorldStore)

local AI_TAG = "AICreated"
local EFFECT_TAG = "AIEffect"

-- メモリ上のエフェクトデータ
local effectsRegistry = {} -- { [name] = opData }

-- DataStoreに保存
local function persistEffects()
	task.spawn(function()
		WorldStore.saveEffects(effectsRegistry)
	end)
end

-- 親パーツを検索
local function findParent(parentName)
	if not parentName then return workspace end
	for _, obj in ipairs(CollectionService:GetTagged(AI_TAG)) do
		if obj.Name == parentName then
			return obj
		end
	end
	warn("[EffectOps] 親が見つかりません: " .. parentName)
	return workspace
end

-- エフェクトを実体化する（create + 復元の共通処理）
local function materializeEffect(op)
	local effectType = op.type
	local parent = findParent(op.parent)
	local instance = nil

	if effectType == "PointLight" then
		instance = Instance.new("PointLight")
		instance.Brightness = op.brightness or 1
		instance.Range = op.range or 16
		if op.color then
			instance.Color = Color3.fromRGB(op.color[1] or 255, op.color[2] or 200, op.color[3] or 100)
		end

	elseif effectType == "SpotLight" then
		instance = Instance.new("SpotLight")
		instance.Brightness = op.brightness or 1
		instance.Range = op.range or 30
		instance.Angle = op.angle or 45
		if op.color then
			instance.Color = Color3.fromRGB(op.color[1] or 255, op.color[2] or 255, op.color[3] or 255)
		end

	elseif effectType == "Fire" then
		instance = Instance.new("Fire")
		instance.Size = op.size or 5
		instance.Heat = op.heat or 10
		if op.color then
			instance.Color = Color3.fromRGB(op.color[1] or 255, op.color[2] or 100, op.color[3] or 0)
		end

	elseif effectType == "Smoke" then
		instance = Instance.new("Smoke")
		instance.Size = op.size or 3
		instance.Opacity = op.opacity or 0.5
		instance.RiseVelocity = op.rise or 5

	elseif effectType == "Sparkles" then
		instance = Instance.new("Sparkles")
		if op.color then
			instance.SparkleColor = Color3.fromRGB(op.color[1] or 100, op.color[2] or 180, op.color[3] or 255)
		end

	elseif effectType == "ParticleEmitter" then
		instance = Instance.new("ParticleEmitter")
		instance.Rate = op.rate or 20
		instance.Lifetime = NumberRange.new(op.lifetime or 2)
		instance.Speed = NumberRange.new(op.speed or 3)
		instance.LightEmission = op.light_emission or 0
		if op.color then
			instance.Color = ColorSequence.new(
				Color3.fromRGB(op.color[1] or 255, op.color[2] or 255, op.color[3] or 255)
			)
		end

	elseif effectType == "Sound" then
		instance = Instance.new("Sound")
		instance.SoundId = op.sound_id or ""
		instance.Volume = op.volume or 0.5
		instance.Looped = op.looped or false
		instance.Playing = true

	else
		warn("[EffectOps] 未知のエフェクト: " .. tostring(effectType))
		return nil
	end

	instance.Name = op.name or ("AIEffect_" .. effectType .. "_" .. tostring(math.random(10000, 99999)))
	instance.Parent = parent
	CollectionService:AddTag(instance, EFFECT_TAG)

	return instance
end

-- create: エフェクト生成 + 永続化
local function handleCreate(op)
	local instance = materializeEffect(op)
	if not instance then return end

	op.name = instance.Name
	effectsRegistry[instance.Name] = op
	persistEffects()

	print("[EffectOps] create: " .. instance.Name .. " → " .. instance.Parent.Name)
end

-- set: エフェクトのプロパティ変更 + 永続化
local function handleSet(op)
	if not op.name then
		warn("[EffectOps] set: name が必要")
		return
	end

	local target = nil
	for _, obj in ipairs(CollectionService:GetTagged(EFFECT_TAG)) do
		if obj.Name == op.name then
			target = obj
			break
		end
	end

	if not target then
		warn("[EffectOps] set: 対象が見つかりません: " .. op.name)
		return
	end

	local props = op.props or {}
	for key, value in pairs(props) do
		if key == "color" and typeof(value) == "table" then
			local color = Color3.fromRGB(value[1] or 255, value[2] or 255, value[3] or 255)
			if target:IsA("Light") then
				target.Color = color
			elseif target:IsA("Fire") then
				target.Color = color
			elseif target:IsA("Sparkles") then
				target.SparkleColor = color
			end
		else
			pcall(function()
				target[key] = value
			end)
		end
	end

	-- 永続化データも更新
	local stored = effectsRegistry[op.name]
	if stored then
		for key, value in pairs(props) do
			stored[key] = value
		end
		persistEffects()
	end

	print("[EffectOps] set: " .. target.Name)
end

-- delete: エフェクト削除 + 永続化
local function handleDelete(op)
	local targets = {}

	if op.name then
		for _, obj in ipairs(CollectionService:GetTagged(EFFECT_TAG)) do
			if obj.Name == op.name then
				table.insert(targets, obj)
				break
			end
		end
	elseif op.all then
		targets = CollectionService:GetTagged(EFFECT_TAG)
	end

	for _, target in ipairs(targets) do
		effectsRegistry[target.Name] = nil
		target:Destroy()
	end

	persistEffects()
	print("[EffectOps] delete: " .. #targets .. "個")
end

local module = {}

-- DataStoreから復元
function module.restore()
	local saved = WorldStore.loadEffects()
	local count = 0
	for name, opData in pairs(saved) do
		effectsRegistry[name] = opData
		materializeEffect(opData)
		count += 1
	end
	if count > 0 then
		print("[EffectOps] DataStoreから復元: " .. count .. "個")
	end
end

function module.execute(ops)
	for _, op in ipairs(ops) do
		if op.op == "create" then
			handleCreate(op)
		elseif op.op == "set" then
			handleSet(op)
		elseif op.op == "delete" then
			handleDelete(op)
		else
			warn("[EffectOps] 未知の操作: " .. tostring(op.op))
		end
	end
end

return module
