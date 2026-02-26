--[[
  SpatialService — pose取得・近傍探索・相対距離/方位計算

  AIからの spatial.query を処理する空間照会基盤。
  NpcMotionOps（追従制御）やBuildOps（制約解決）からも内部利用される。
]]

local CollectionService = game:GetService("CollectionService")
local Players = game:GetService("Players")

local Config = require(script.Parent.Config)

local AI_TAG = "AICreated"

local module = {}

-- ModelのルートPartを取得（PrimaryPart → HumanoidRootPart → 最初のBasePartにフォールバック）
function module.getRootPart(model: Model): BasePart?
	if model.PrimaryPart then return model.PrimaryPart end
	local hrp = model:FindFirstChild("HumanoidRootPart")
	if hrp and hrp:IsA("BasePart") then return hrp end
	-- 最終フォールバック
	return model:FindFirstChildWhichIsA("BasePart")
end

-- NPC参照
function module.findNpc(): Model?
	for _, obj in ipairs(workspace:GetDescendants()) do
		if obj.Name == Config.npcName and obj:IsA("Model") then
			return obj
		end
	end
	return nil
end

-- プレイヤー参照（userId: 数値のみ、省略時はオーナー）
-- 開発中: 型不正はfail-fast（文字列ユーザー名は受け付けない）
function module.findPlayer(userId: number?): Player?
	if userId then
		if type(userId) ~= "number" then
			error("[SpatialService] findPlayer: userIdはnumber必須（受信値: " .. tostring(userId) .. " 型: " .. type(userId) .. "）")
		end
		for _, p in ipairs(Players:GetPlayers()) do
			if p.UserId == userId then return p end
		end
		return nil
	end
	-- オーナー検索
	if Config.ownerUserId == 0 then
		local players = Players:GetPlayers()
		return players[1]
	end
	for _, p in ipairs(Players:GetPlayers()) do
		if p.UserId == Config.ownerUserId then return p end
	end
	return nil
end

-- エンティティのpose取得（{pos, yaw, vel?}）
function module.getEntityPose(entityType: string, entityId: string?): { pos: { number }?, yaw: number?, vel: { number }? }?
	if entityType == "npc" then
		local npc = module.findNpc()
		if not npc then return nil end
		local root = module.getRootPart(npc)
		if not root then return nil end
		local cf = root.CFrame
		local _, yaw, _ = cf:ToEulerAnglesYXZ()
		return {
			pos = { math.floor(cf.Position.X * 2 + 0.5) / 2, math.floor(cf.Position.Y * 2 + 0.5) / 2, math.floor(cf.Position.Z * 2 + 0.5) / 2 },
			yaw = math.floor(math.deg(yaw) + 0.5),
		}
	elseif entityType == "player" then
		local player = module.findPlayer(entityId and tonumber(entityId) or nil)
		if not player or not player.Character then return nil end
		local root = module.getRootPart(player.Character)
		if not root then return nil end
		local cf = root.CFrame
		local _, yaw, _ = cf:ToEulerAnglesYXZ()
		local vel = root.AssemblyLinearVelocity
		return {
			pos = { math.floor(cf.Position.X * 2 + 0.5) / 2, math.floor(cf.Position.Y * 2 + 0.5) / 2, math.floor(cf.Position.Z * 2 + 0.5) / 2 },
			yaw = math.floor(math.deg(yaw) + 0.5),
			vel = { math.floor(vel.X + 0.5), math.floor(vel.Y + 0.5), math.floor(vel.Z + 0.5) },
		}
	elseif entityType == "part" then
		if not entityId then return nil end
		for _, obj in ipairs(CollectionService:GetTagged(AI_TAG)) do
			if obj.Name == entityId and obj:IsA("BasePart") then
				local cf = obj.CFrame
				local _, yaw, _ = cf:ToEulerAnglesYXZ()
				return {
					pos = { math.floor(cf.Position.X * 2 + 0.5) / 2, math.floor(cf.Position.Y * 2 + 0.5) / 2, math.floor(cf.Position.Z * 2 + 0.5) / 2 },
					yaw = math.floor(math.deg(yaw) + 0.5),
				}
			end
		end
		return nil
	end
	return nil
end

-- 近傍探索（center周辺のオブジェクトを返す）
function module.scanNearby(centerPos: Vector3, radius: number, limit: number?, tagFilter: string?): { any }
	local maxItems = limit or 10
	local tag = tagFilter or AI_TAG
	local results = {}

	for _, obj in ipairs(CollectionService:GetTagged(tag)) do
		if obj:IsA("BasePart") then
			local dist = (obj.Position - centerPos).Magnitude
			if dist <= radius then
				local _, yaw, _ = obj.CFrame:ToEulerAnglesYXZ()
				table.insert(results, {
					id = obj.Name,
					name = obj.Name,
					class = obj.ClassName,
					pos = { math.floor(obj.Position.X * 2 + 0.5) / 2, math.floor(obj.Position.Y * 2 + 0.5) / 2, math.floor(obj.Position.Z * 2 + 0.5) / 2 },
					size = { obj.Size.X, obj.Size.Y, obj.Size.Z },
					yaw = math.floor(math.deg(yaw) + 0.5),
					distance = math.floor(dist + 0.5),
				})
			end
		elseif obj:IsA("Folder") then
			-- グループ（Folder）はBoundingBoxで位置推定
			local cf, size = obj:GetBoundingBox()
			if cf then
				local dist = (cf.Position - centerPos).Magnitude
				if dist <= radius then
					table.insert(results, {
						id = obj.Name,
						name = obj.Name,
						class = "Folder",
						pos = { math.floor(cf.Position.X * 2 + 0.5) / 2, math.floor(cf.Position.Y * 2 + 0.5) / 2, math.floor(cf.Position.Z * 2 + 0.5) / 2 },
						size = { size.X, size.Y, size.Z },
						distance = math.floor(dist + 0.5),
					})
				end
			end
		end
	end

	-- 距離でソート
	table.sort(results, function(a, b) return a.distance < b.distance end)

	-- limit適用
	if #results > maxItems then
		local trimmed = {}
		for i = 1, maxItems do
			trimmed[i] = results[i]
		end
		return trimmed
	end
	return results
end

-- 相対関係計算（fromからtoへの距離と方位）
function module.relativeInfo(fromPos: Vector3, toPos: Vector3): { distance: number, bearing_deg: number, bearing_label: string, relation: string }
	local diff = toPos - fromPos
	local distance = diff.Magnitude
	local bearing = math.deg(math.atan2(diff.X, diff.Z)) % 360
	bearing = math.floor(bearing + 0.5)

	-- 方位ラベル（8方位）
	local labels = { "N", "NE", "E", "SE", "S", "SW", "W", "NW" }
	local idx = math.floor((bearing + 22.5) / 45) % 8 + 1
	local bearingLabel = labels[idx]

	-- 距離ラベル
	local relation = "far"
	if distance <= 5 then
		relation = "near"
	elseif distance <= 20 then
		relation = "mid"
	end

	return {
		distance = math.floor(distance + 0.5),
		bearing_deg = bearing,
		bearing_label = bearingLabel,
		relation = relation,
	}
end

-- spatial.query の実行（CommandReceiverから呼ばれる）
function module.execute(ops)
	local results = {}
	for _, op in ipairs(ops) do
		if op.op == "query" then
			local result = module.handleQuery(op)
			table.insert(results, result)
		else
			warn("[SpatialService] 未知の操作: " .. tostring(op.op))
			table.insert(results, { success = false, error = { code = "UNKNOWN_OP", message = "未知の操作: " .. tostring(op.op) } })
		end
	end
	return results
end

-- query操作の処理
function module.handleQuery(op): { [string]: any }
	local mode = op.mode or "entities"

	if mode == "entities" then
		local targets = op.targets or {}
		local entities = {}
		for _, t in ipairs(targets) do
			local pose = module.getEntityPose(t.type, t.id)
			if pose then
				local entry = {
					type = t.type,
					id = t.id or t.type,
					pos = pose.pos,
					yaw = pose.yaw,
					vel = pose.vel,
				}
				-- relative_to指定があれば相対情報を追加
				if op.relative_to then
					local refPose = module.getEntityPose(op.relative_to.type, op.relative_to.id)
					if refPose and pose.pos and refPose.pos then
						local rel = module.relativeInfo(
							Vector3.new(refPose.pos[1], refPose.pos[2], refPose.pos[3]),
							Vector3.new(pose.pos[1], pose.pos[2], pose.pos[3])
						)
						entry.distance = rel.distance
						entry.bearing_deg = rel.bearing_deg
						entry.bearing_label = rel.bearing_label
						entry.relation = rel.relation
					end
				end
				table.insert(entities, entry)
			end
		end
		return { success = true, data = { entities = entities } }

	elseif mode == "nearby" then
		-- centerの解決
		local centerPos: Vector3?
		if op.center then
			if op.center.pos then
				centerPos = Vector3.new(op.center.pos[1] or 0, op.center.pos[2] or 0, op.center.pos[3] or 0)
			else
				local pose = module.getEntityPose(op.center.type, op.center.id)
				if pose and pose.pos then
					centerPos = Vector3.new(pose.pos[1], pose.pos[2], pose.pos[3])
				end
			end
		end
		if not centerPos then
			return { success = false, error = { code = "CENTER_NOT_FOUND", message = "center解決不能" } }
		end

		local radius = op.radius or 30
		local limit = op.limit or 10
		local items = module.scanNearby(centerPos, radius, limit, op.tag)
		return { success = true, data = { items = items } }
	end

	return { success = false, error = { code = "UNKNOWN_MODE", message = "未知のmode: " .. tostring(mode) } }
end

return module
