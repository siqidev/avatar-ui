--[[
  TerrainOps — 地形操作モジュール

  操作: fill / excavate / paint
  演出: 中心から外側へ波紋状に段階生成
  全操作は自動的にDataStoreに永続化される
]]

local Terrain = workspace.Terrain

local WorldStore = require(script.Parent.WorldStore)

-- メモリ上の地形操作履歴（再適用で復元）
local terrainOps = {}

local module = {}

-- DataStoreに保存
local function persistTerrain()
	task.spawn(function()
		WorldStore.saveTerrain(terrainOps)
	end)
end

-- 波紋演出: 中心から外側へ段階的に地形を埋める
local function fillWithRipple(center, radius, material, steps)
	steps = steps or 5
	local stepRadius = radius / steps
	for i = 1, steps do
		local r = stepRadius * i
		Terrain:FillBall(center, r, material)
		task.wait(0.15)
	end
end

-- fill: 地形を埋める（withEffect=falseで演出スキップ）
local function handleFill(op, withEffect)
	local pos = Vector3.new(op.pos[1] or 0, op.pos[2] or 0, op.pos[3] or 0)
	local mat = Enum.Material[op.material or "Grass"]
	if not mat then
		warn("[TerrainOps] 未知の素材: " .. tostring(op.material))
		return
	end

	local shape = op.shape or "ball"

	if shape == "ball" then
		local radius = op.radius or 10
		if withEffect then
			fillWithRipple(pos, radius, mat)
		else
			Terrain:FillBall(pos, radius, mat)
		end
		print("[TerrainOps] fill ball: r=" .. radius .. " " .. tostring(mat))

	elseif shape == "block" then
		local size = Vector3.new(op.size[1] or 10, op.size[2] or 4, op.size[3] or 10)
		if withEffect then
			local steps = 4
			local stepHeight = size.Y / steps
			for i = 1, steps do
				local partialSize = Vector3.new(size.X, stepHeight * i, size.Z)
				Terrain:FillBlock(CFrame.new(pos), partialSize, mat)
				task.wait(0.15)
			end
		else
			Terrain:FillBlock(CFrame.new(pos), size, mat)
		end
		print("[TerrainOps] fill block: " .. tostring(size) .. " " .. tostring(mat))
	end
end

-- excavate: 地形を掘る
local function handleExcavate(op, withEffect)
	local pos = Vector3.new(op.pos[1] or 0, op.pos[2] or 0, op.pos[3] or 0)
	local shape = op.shape or "ball"

	if shape == "ball" then
		local radius = op.radius or 10
		if withEffect then
			local steps = 4
			local stepRadius = radius / steps
			for i = steps, 1, -1 do
				Terrain:FillBall(pos, stepRadius * i, Enum.Material.Air)
				task.wait(0.1)
			end
		else
			Terrain:FillBall(pos, radius, Enum.Material.Air)
		end
		print("[TerrainOps] excavate ball: r=" .. radius)

	elseif shape == "block" then
		local size = Vector3.new(op.size[1] or 10, op.size[2] or 4, op.size[3] or 10)
		Terrain:FillBlock(CFrame.new(pos), size, Enum.Material.Air)
		print("[TerrainOps] excavate block: " .. tostring(size))
	end
end

-- paint: 地形の素材を塗り替える
local function handlePaint(op)
	local pos = Vector3.new(op.pos[1] or 0, op.pos[2] or 0, op.pos[3] or 0)
	local mat = Enum.Material[op.material or "Grass"]
	if not mat then return end

	local radius = op.radius or 5
	local region = Region3.new(
		pos - Vector3.new(radius, radius, radius),
		pos + Vector3.new(radius, radius, radius)
	):ExpandToGrid(4)
	local materials, occupancy = Terrain:ReadVoxels(region, 4)
	local size = materials.Size

	for x = 1, size.X do
		for y = 1, size.Y do
			for z = 1, size.Z do
				if occupancy[x][y][z] > 0 then
					materials[x][y][z] = mat
				end
			end
		end
	end

	Terrain:WriteVoxels(region, 4, materials, occupancy)
	print("[TerrainOps] paint: r=" .. radius .. " " .. tostring(mat))
end

-- DataStoreから復元
function module.restore()
	local saved = WorldStore.loadTerrain()
	if #saved == 0 then return end

	for _, op in ipairs(saved) do
		if op.op == "fill" then
			handleFill(op, false)
		elseif op.op == "excavate" then
			handleExcavate(op, false)
		elseif op.op == "paint" then
			handlePaint(op)
		end
	end
	terrainOps = saved
	print("[TerrainOps] DataStoreから復元: " .. #saved .. "件")
end

function module.execute(ops)
	for _, op in ipairs(ops) do
		if op.op == "fill" then
			handleFill(op, true)
			table.insert(terrainOps, op)
		elseif op.op == "excavate" then
			handleExcavate(op, true)
			table.insert(terrainOps, op)
		elseif op.op == "paint" then
			handlePaint(op)
			table.insert(terrainOps, op)
		else
			warn("[TerrainOps] 未知の操作: " .. tostring(op.op))
		end
	end
	persistTerrain()
end

return module
