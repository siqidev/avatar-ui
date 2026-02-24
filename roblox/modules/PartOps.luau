--[[
  PartOps — オブジェクト操作モジュール（建物・家具・装飾）

  操作: create / set / delete
  create時は「情報が物質化する」演出（パーティクル収束＋フェードイン）を自動付与
  全操作は自動的にDataStoreに永続化される
]]

local TweenService = game:GetService("TweenService")
local CollectionService = game:GetService("CollectionService")

local WorldStore = require(script.Parent.WorldStore)

local AI_TAG = "AICreated"

-- メモリ上のパーツデータ（DataStoreとの同期用）
local partsRegistry = {} -- { [name] = opData }

-- 有効なPart形状
local VALID_SHAPES = {
	Block = Enum.PartType.Block,
	Ball = Enum.PartType.Ball,
	Cylinder = Enum.PartType.Cylinder,
	Wedge = "Wedge",
	CornerWedge = "CornerWedge",
}

-- 情報物質化エフェクト: パーティクル収束 → フェードイン
local function playMaterializeEffect(part)
	local emitter = Instance.new("ParticleEmitter")
	emitter.Color = ColorSequence.new(Color3.fromRGB(100, 180, 255))
	emitter.Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 1), NumberSequenceKeypoint.new(1, 0) })
	emitter.Lifetime = NumberRange.new(0.3, 0.6)
	emitter.Rate = 60
	emitter.Speed = NumberRange.new(2, 5)
	emitter.SpreadAngle = Vector2.new(180, 180)
	emitter.LightEmission = 1
	emitter.Parent = part

	part.Transparency = 1
	local tween = TweenService:Create(part, TweenInfo.new(0.4, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
		Transparency = 0,
	})
	tween:Play()

	task.delay(0.6, function()
		emitter.Rate = 0
	end)
	task.delay(1.5, function()
		emitter:Destroy()
	end)
end

-- DataStoreに現在のパーツデータを保存
local function persistParts()
	task.spawn(function()
		WorldStore.saveParts(partsRegistry)
	end)
end

-- opデータからパーツを実体化する（復元時はエフェクトなし）
local function materializePart(op, withEffect)
	local shapeKey = op.shape or "Block"
	local shapeInfo = VALID_SHAPES[shapeKey]
	if not shapeInfo then
		warn("[PartOps] 未知の形状: " .. tostring(shapeKey))
		return nil
	end

	local part
	if shapeKey == "Wedge" then
		part = Instance.new("WedgePart")
	elseif shapeKey == "CornerWedge" then
		part = Instance.new("CornerWedgePart")
	else
		part = Instance.new("Part")
		part.Shape = shapeInfo
	end

	part.Anchored = true
	part.Name = op.name or ("AI_" .. shapeKey .. "_" .. tostring(math.random(10000, 99999)))

	if op.size then
		part.Size = Vector3.new(op.size[1] or 1, op.size[2] or 1, op.size[3] or 1)
	end
	if op.pos then
		part.CFrame = CFrame.new(op.pos[1] or 0, op.pos[2] or 0, op.pos[3] or 0)
	end
	if op.rot then
		local current = part.CFrame
		part.CFrame = current * CFrame.Angles(
			math.rad(op.rot[1] or 0),
			math.rad(op.rot[2] or 0),
			math.rad(op.rot[3] or 0)
		)
	end
	if op.material then
		local mat = Enum.Material[op.material]
		if mat then part.Material = mat end
	end
	if op.color then
		if type(op.color) == "table" then
			part.Color = Color3.fromRGB(op.color[1] or 255, op.color[2] or 255, op.color[3] or 255)
		else
			part.BrickColor = BrickColor.new(op.color)
		end
	end

	CollectionService:AddTag(part, AI_TAG)

	-- 親設定
	local parent = workspace
	if op.parent then
		for _, obj in ipairs(CollectionService:GetTagged(AI_TAG)) do
			if obj.Name == op.parent then
				parent = obj
				break
			end
		end
	end

	-- Folder（グループ用）
	if op.is_group then
		local folder = Instance.new("Folder")
		folder.Name = part.Name
		folder.Parent = parent
		CollectionService:AddTag(folder, AI_TAG)
		part:Destroy()
		return folder
	end

	part.Parent = parent

	if withEffect then
		playMaterializeEffect(part)
		if op.transparency then
			task.delay(0.5, function()
				part.Transparency = op.transparency
			end)
		end
	else
		-- 復元時はエフェクトなしで即座に表示
		if op.transparency then
			part.Transparency = op.transparency
		end
	end

	return part
end

-- create: パーツ生成 + 永続化
local function handleCreate(op)
	local result = materializePart(op, true)
	if not result then return end

	-- 永続化用にopデータを名前で登録
	local name = result.Name
	op.name = name
	partsRegistry[name] = op
	persistParts()

	print("[PartOps] create: " .. name)
	return result
end

-- set: 既存パーツのプロパティ変更 + 永続化
local function handleSet(op)
	if not op.name then
		warn("[PartOps] set: name が必要")
		return
	end

	local target = nil
	for _, obj in ipairs(CollectionService:GetTagged(AI_TAG)) do
		if obj.Name == op.name then
			target = obj
			break
		end
	end

	if not target then
		warn("[PartOps] set: 対象が見つかりません: " .. op.name)
		return
	end

	local props = op.props or {}
	local tweenProps = {}

	if props.color and target:IsA("BasePart") then
		if type(props.color) == "table" then
			target.Color = Color3.fromRGB(props.color[1] or 255, props.color[2] or 255, props.color[3] or 255)
		else
			target.BrickColor = BrickColor.new(props.color)
		end
	end
	if props.material and target:IsA("BasePart") then
		local mat = Enum.Material[props.material]
		if mat then target.Material = mat end
	end
	if props.transparency then
		tweenProps.Transparency = props.transparency
	end
	if props.size then
		tweenProps.Size = Vector3.new(props.size[1], props.size[2], props.size[3])
	end
	if props.pos then
		tweenProps.CFrame = CFrame.new(props.pos[1], props.pos[2], props.pos[3])
	end

	if next(tweenProps) and target:IsA("BasePart") then
		TweenService:Create(target, TweenInfo.new(0.3), tweenProps):Play()
	end

	-- 永続化データも更新
	local stored = partsRegistry[op.name]
	if stored then
		for key, value in pairs(props) do
			if key == "color" then stored.color = value end
			if key == "material" then stored.material = value end
			if key == "transparency" then stored.transparency = value end
			if key == "size" then stored.size = value end
			if key == "pos" then stored.pos = value end
		end
		persistParts()
	end

	print("[PartOps] set: " .. target.Name)
end

-- delete: パーツ削除 + 永続化
local function handleDelete(op)
	local targets = {}

	if op.name then
		for _, obj in ipairs(CollectionService:GetTagged(AI_TAG)) do
			if obj.Name == op.name then
				table.insert(targets, obj)
				break
			end
		end
	elseif op.all then
		targets = CollectionService:GetTagged(AI_TAG)
	end

	for _, target in ipairs(targets) do
		-- 永続化データから削除
		partsRegistry[target.Name] = nil

		if target:IsA("BasePart") then
			local emitter = Instance.new("ParticleEmitter")
			emitter.Color = ColorSequence.new(Color3.fromRGB(100, 180, 255))
			emitter.Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.5), NumberSequenceKeypoint.new(1, 0) })
			emitter.Lifetime = NumberRange.new(0.3, 0.5)
			emitter.Rate = 40
			emitter.Speed = NumberRange.new(3, 8)
			emitter.SpreadAngle = Vector2.new(180, 180)
			emitter.LightEmission = 1
			emitter.Parent = target

			TweenService:Create(target, TweenInfo.new(0.3), { Transparency = 1 }):Play()
			task.delay(0.5, function()
				target:Destroy()
			end)
		else
			target:Destroy()
		end
	end

	persistParts()
	print("[PartOps] delete: " .. #targets .. "個")
end

local module = {}

-- DataStoreから復元
function module.restore()
	local saved = WorldStore.loadParts()
	local count = 0
	for name, opData in pairs(saved) do
		partsRegistry[name] = opData
		materializePart(opData, false)
		count += 1
	end
	if count > 0 then
		print("[PartOps] DataStoreから復元: " .. count .. "個")
	end
end

function module.execute(ops)
	for i, op in ipairs(ops) do
		if op.op == "create" then
			handleCreate(op)
		elseif op.op == "set" then
			handleSet(op)
		elseif op.op == "delete" then
			handleDelete(op)
		else
			warn("[PartOps] 未知の操作: " .. tostring(op.op))
		end
		if i < #ops and op.op == "create" then
			task.wait(0.2)
		end
	end
end

return module
