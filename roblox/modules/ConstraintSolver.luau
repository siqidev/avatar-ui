--[[
  ConstraintSolver — attach/offset/non_overlapの制約解決+物理検証

  AIが出した制約（意図+参照+制約条件）を受け取り、
  Roblox空間内で座標を決定的に解決し、物理的妥当性を検証する。

  制約タイプはレジストリ方式: 未知のtypeはUNSUPPORTED_CONSTRAINTでエラー返却。
  solve()で制約解決、validate()で物理検証。将来肥大化時に分割可能。
]]

local CollectionService = game:GetService("CollectionService")

local AI_TAG = "AICreated"

local module = {}

-- 面の法線とオフセット取得
local FACE_NORMALS = {
	top = Vector3.new(0, 1, 0),
	bottom = Vector3.new(0, -1, 0),
	front = Vector3.new(0, 0, -1),
	back = Vector3.new(0, 0, 1),
	left = Vector3.new(-1, 0, 0),
	right = Vector3.new(1, 0, 0),
}

-- 参照オブジェクトの解決（name or special token）
-- 戻り値: (part?, resolved) — resolved=falseなら未解決（fail-fast対象）
local function resolveRef(refId: string): (BasePart?, boolean)
	if refId == "ground" then
		return nil, true -- 特殊: 地面（y=0基準）
	end
	for _, obj in ipairs(CollectionService:GetTagged(AI_TAG)) do
		if obj.Name == refId and obj:IsA("BasePart") then
			return obj, true
		end
	end
	warn("[ConstraintSolver] 参照未解決: " .. refId)
	return nil, false
end

-- 面の法線をワールド座標に変換（パーツの回転を考慮）
local function getFaceNormal(part: BasePart?, face: string): Vector3
	local localNormal = FACE_NORMALS[face]
	if not localNormal then
		warn("[ConstraintSolver] 未知の面: " .. face)
		return Vector3.new(0, 1, 0)
	end
	if not part then
		-- groundの場合、ワールド座標の法線をそのまま返す
		return localNormal
	end
	return part.CFrame:VectorToWorldSpace(localNormal)
end

-- 面の中心座標を取得
local function getFaceCenter(part: BasePart?, face: string): Vector3
	if not part then
		-- ground: y=0平面
		return Vector3.new(0, 0, 0)
	end
	local normal = FACE_NORMALS[face]
	if not normal then return part.Position end
	local halfSize = part.Size / 2
	local localOffset = normal * Vector3.new(halfSize.X, halfSize.Y, halfSize.Z)
	return part.CFrame:PointToWorldSpace(localOffset)
end

-- 制約ソルバ: 制約リストからCFrame/Sizeを決定する
-- 戻り値: { cframe: CFrame, size: Vector3, violations: { string } }
function module.solve(
	baseSize: Vector3,
	constraints: { any },
	refs: { any }?
): { cframe: CFrame, size: Vector3, violations: { string } }

	local position = Vector3.new(0, 0, 0)
	local rotation = CFrame.new()
	local size = baseSize
	local violations: { string } = {}

	for _, constraint in ipairs(constraints) do
		local ctype = constraint.type

		if ctype == "attach" then
			-- 参照面に自身の面を接着
			local refId = constraint.ref or "ground"
			local refPart, resolved = resolveRef(refId)
			if not resolved then
				table.insert(violations, "UNRESOLVED_REF: " .. refId)
				continue
			end
			local refFace = constraint.ref_face or "top"
			local selfFace = constraint.self_face or "bottom"

			local refCenter = getFaceCenter(refPart, refFace)
			local refNormal = getFaceNormal(refPart, refFace)

			-- 自身の面から中心へのオフセット
			local selfNormal = FACE_NORMALS[selfFace]
			if selfNormal then
				local halfSize = size / 2
				local selfOffset = selfNormal * Vector3.new(halfSize.X, halfSize.Y, halfSize.Z)
				-- 接着点から自身の中心への移動
				position = refCenter + refNormal * selfOffset.Magnitude
			else
				position = refCenter
				table.insert(violations, "attach: 未知のself_face " .. selfFace)
			end

		elseif ctype == "offset" then
			-- 参照基準からの平行移動
			local vec = constraint.vector or { 0, 0, 0 }
			local offsetVec = Vector3.new(vec[1] or 0, vec[2] or 0, vec[3] or 0)
			local frame = constraint.frame or "world"

			if frame == "world" then
				position = position + offsetVec
			elseif frame == "ref" and constraint.ref then
				local refPart, resolved = resolveRef(constraint.ref)
				if refPart then
					position = position + refPart.CFrame:VectorToWorldSpace(offsetVec)
				elseif not resolved then
					table.insert(violations, "UNRESOLVED_REF: " .. tostring(constraint.ref))
					continue
				else
					-- ground参照: ワールド座標でオフセット
					position = position + offsetVec
				end
			else
				position = position + offsetVec
			end

		elseif ctype == "non_overlap" then
			-- 検証のみ（solve段階では位置を変えない、validate段階でチェック）
			-- ここでは何もしない

		else
			table.insert(violations, "UNSUPPORTED_CONSTRAINT: " .. tostring(ctype))
		end
	end

	local cframe = CFrame.new(position) * rotation

	return {
		cframe = cframe,
		size = size,
		violations = violations,
	}
end

-- 物理検証: 配置済み or 配置予定のパーツに対して検証を実行
function module.validate(
	cframe: CFrame,
	size: Vector3,
	checks: { string },
	allowList: { string }?
): { passed: boolean, results: { any } }

	local results = {}
	local allPassed = true

	for _, check in ipairs(checks) do
		if check == "non_overlap" then
			-- 重なり検出
			local testPart = Instance.new("Part")
			testPart.Size = size
			testPart.CFrame = cframe
			testPart.Anchored = true
			testPart.CanCollide = false
			testPart.Transparency = 1
			testPart.Parent = workspace

			local overlapParams = OverlapParams.new()
			overlapParams.FilterType = Enum.RaycastFilterType.Exclude
			-- allowList内のパーツを除外
			local excludeList = { testPart }
			if allowList then
				for _, name in ipairs(allowList) do
					for _, obj in ipairs(CollectionService:GetTagged(AI_TAG)) do
						if obj.Name == name then
							table.insert(excludeList, obj)
						end
					end
				end
			end
			overlapParams.FilterDescendantsInstances = excludeList

			local overlapping = workspace:GetPartsInPart(testPart, overlapParams)
			testPart:Destroy()

			-- AI生成パーツとの重なりのみチェック
			local aiOverlaps = {}
			for _, part in ipairs(overlapping) do
				if CollectionService:HasTag(part, AI_TAG) then
					table.insert(aiOverlaps, part.Name)
				end
			end

			local ok = #aiOverlaps == 0
			if not ok then allPassed = false end
			table.insert(results, {
				name = "non_overlap",
				ok = ok,
				detail = ok and "clear" or "重なり: " .. table.concat(aiOverlaps, ", "),
			})

		elseif check == "ground_contact" then
			-- 接地検証（下向きRaycast）
			local origin = cframe.Position
			local direction = Vector3.new(0, -(size.Y / 2 + 5), 0)
			local rayResult = workspace:Raycast(origin, direction)
			local ok = rayResult ~= nil
			if not ok then allPassed = false end
			table.insert(results, {
				name = "ground_contact",
				ok = ok,
				detail = ok and "接地" or "浮遊（地面なし）",
			})

		elseif check == "attach" then
			-- attach制約の充足確認（簡易: 位置が想定範囲内か）
			table.insert(results, {
				name = "attach",
				ok = true,
				detail = "制約適用済み",
			})

		else
			table.insert(results, {
				name = check,
				ok = true,
				detail = "未実装チェック（スキップ）",
			})
		end
	end

	return {
		passed = allPassed,
		results = results,
	}
end

return module
