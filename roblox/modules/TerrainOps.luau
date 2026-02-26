--[[
  TerrainOps — 地形操作モジュール（v3）

  操作: fill / excavate / paint / apply_constraints
  演出: 中心から外側へ波紋状に段階生成
  全操作は自動的にDataStoreに永続化される

  v3変更点:
  - apply_constraints: ConstraintSolver経由で制約ベースの地形操作
  - 全操作がACK対応（{success, data, error}を返す）
]]

local Terrain = workspace.Terrain

local WorldStore = require(script.Parent.WorldStore)
local ConstraintSolver = require(script.Parent.ConstraintSolver)

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
		return { success = false, error = { code = "UNKNOWN_MATERIAL", message = "未知の素材: " .. tostring(op.material) } }
	end

	local shape = op.shape or "ball"

	if shape == "ball" then
		local radius = op.radius or 10
		if withEffect then
			fillWithRipple(pos, radius, mat)
		else
			Terrain:FillBall(pos, radius, mat)
		end
		return { success = true, data = { shape = "ball", radius = radius, material = tostring(mat) } }

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
		return { success = true, data = { shape = "block", size = { size.X, size.Y, size.Z }, material = tostring(mat) } }
	end

	return { success = false, error = { code = "UNKNOWN_SHAPE", message = "未知の形状: " .. tostring(shape) } }
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
		return { success = true, data = { shape = "ball", radius = radius } }

	elseif shape == "block" then
		local size = Vector3.new(op.size[1] or 10, op.size[2] or 4, op.size[3] or 10)
		Terrain:FillBlock(CFrame.new(pos), size, Enum.Material.Air)
		return { success = true, data = { shape = "block", size = { size.X, size.Y, size.Z } } }
	end

	return { success = false, error = { code = "UNKNOWN_SHAPE", message = "未知の形状: " .. tostring(shape) } }
end

-- paint: 地形の素材を塗り替える
local function handlePaint(op)
	local pos = Vector3.new(op.pos[1] or 0, op.pos[2] or 0, op.pos[3] or 0)
	local mat = Enum.Material[op.material or "Grass"]
	if not mat then
		return { success = false, error = { code = "UNKNOWN_MATERIAL", message = "未知の素材: " .. tostring(op.material) } }
	end

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
	return { success = true, data = { radius = radius, material = tostring(mat) } }
end

-- apply_constraints: 制約ベースの地形操作
local function handleApplyConstraints(op)
	local target = op.target
	if not target then
		return { success = false, error = { code = "NO_TARGET", message = "targetが必要" } }
	end

	local constraints = op.constraints or {}
	local fillOp = target.fill_op or "fill"
	local material = target.material or "Grass"
	local shape = target.shape or "ball"

	-- サイズの決定
	local sizeArr = target.size or { 10, 4, 10 }
	local baseSize = Vector3.new(sizeArr[1] or 10, sizeArr[2] or 4, sizeArr[3] or 10)

	-- 制約解決
	local solved = ConstraintSolver.solve(baseSize, constraints, op.refs)

	-- 制約違反チェック
	if #solved.violations > 0 then
		for _, v in ipairs(solved.violations) do
			if string.find(v, "UNSUPPORTED_CONSTRAINT") then
				return {
					success = false,
					error = {
						code = "UNSUPPORTED_CONSTRAINT",
						message = table.concat(solved.violations, "; "),
						retryable = false,
					},
				}
			end
		end
	end

	local pos = solved.cframe.Position

	-- 地形操作を構築
	local terrainOp = {
		op = fillOp,
		pos = { pos.X, pos.Y, pos.Z },
		material = material,
		shape = shape,
	}

	if shape == "ball" then
		terrainOp.radius = target.radius or math.max(baseSize.X, baseSize.Y, baseSize.Z) / 2
	else
		terrainOp.size = { solved.size.X, solved.size.Y, solved.size.Z }
	end

	-- 実行
	local result
	if fillOp == "fill" then
		result = handleFill(terrainOp, true)
	elseif fillOp == "excavate" then
		result = handleExcavate(terrainOp, true)
	elseif fillOp == "paint" then
		result = handlePaint(terrainOp)
	else
		return { success = false, error = { code = "UNKNOWN_FILL_OP", message = "未知の操作: " .. tostring(fillOp) } }
	end

	if result and result.success then
		table.insert(terrainOps, terrainOp)
		persistTerrain()
		result.data.resolved_pose = {
			pos = { math.floor(pos.X * 2 + 0.5) / 2, math.floor(pos.Y * 2 + 0.5) / 2, math.floor(pos.Z * 2 + 0.5) / 2 },
		}
	end

	return result
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
	local results = {}
	for _, op in ipairs(ops) do
		local result
		if op.op == "fill" then
			result = handleFill(op, true)
			if result.success then
				table.insert(terrainOps, op)
			end
		elseif op.op == "excavate" then
			result = handleExcavate(op, true)
			if result.success then
				table.insert(terrainOps, op)
			end
		elseif op.op == "paint" then
			result = handlePaint(op)
			if result.success then
				table.insert(terrainOps, op)
			end
		elseif op.op == "apply_constraints" then
			result = handleApplyConstraints(op)
		else
			result = { success = false, error = { code = "UNKNOWN_OP", message = "未知の操作: " .. tostring(op.op) } }
		end
		table.insert(results, result)
	end
	-- fill/excavate/paintの場合のみ永続化（apply_constraintsは内部で永続化）
	persistTerrain()
	return results
end

return module
