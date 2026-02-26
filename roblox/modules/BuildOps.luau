--[[
  BuildOps — build.apply_constraintsの実行

  AIの意図+参照+制約を受け取り、ConstraintSolverで座標を解決し、
  PartOpsで実際のパーツ生成/更新を行い、物理検証結果をACKで返す。
]]

local ConstraintSolver = require(script.Parent.ConstraintSolver)
local PartOps = require(script.Parent.PartOps)

local module = {}

-- apply_constraints操作の処理
function module.applyConstraints(op): { [string]: any }
	local target = op.target
	if not target then
		return { success = false, error = { code = "NO_TARGET", message = "targetが必要" } }
	end

	local mode = target.mode or "create"
	local constraints = op.constraints or {}
	local validateChecks = op.validate or {}

	-- サイズの決定
	local sizeArr = target.size or { 4, 4, 1 }
	local baseSize = Vector3.new(sizeArr[1] or 4, sizeArr[2] or 4, sizeArr[3] or 1)

	-- 制約解決
	local solved = ConstraintSolver.solve(baseSize, constraints, op.refs)

	-- 解決時の制約違反チェック
	if #solved.violations > 0 then
		local fatalCode = nil
		for _, v in ipairs(solved.violations) do
			if string.find(v, "UNSUPPORTED_CONSTRAINT") then
				fatalCode = "UNSUPPORTED_CONSTRAINT"
				break
			end
			if string.find(v, "UNRESOLVED_REF") then
				fatalCode = "UNRESOLVED_REF"
				break
			end
		end
		if fatalCode then
			return {
				success = false,
				error = {
					code = fatalCode,
					message = table.concat(solved.violations, "; "),
					retryable = fatalCode == "UNRESOLVED_REF",
				},
			}
		end
	end

	-- non_overlap用のallowList構築
	local allowList = {}
	for _, c in ipairs(constraints) do
		if c.type == "non_overlap" and c.allow then
			for _, name in ipairs(c.allow) do
				table.insert(allowList, name)
			end
		end
	end

	-- 物理検証（配置前検証）
	if #validateChecks > 0 then
		local validation = ConstraintSolver.validate(solved.cframe, solved.size, validateChecks, allowList)
		if not validation.passed then
			return {
				success = false,
				error = {
					code = "VALIDATION_FAILED",
					message = "物理検証失敗",
					retryable = true,
				},
				data = {},
				meta = {
					validation = {
						passed = false,
						checks = validation.results,
					},
				},
			}
		end
	end

	-- パーツ生成/更新
	if mode == "create" then
		local pos = solved.cframe.Position
		local _, yaw, _ = solved.cframe:ToEulerAnglesYXZ()

		local partOp = {
			op = "create",
			shape = target.shape or "Block",
			size = { solved.size.X, solved.size.Y, solved.size.Z },
			pos = { pos.X, pos.Y, pos.Z },
			rot = { 0, math.deg(yaw), 0 },
			material = target.material,
			color = target.color,
			name = target.name,
			transparency = target.transparency,
			parent = target.parent,
			is_group = target.is_group,
		}

		-- PartOps.executeを直接呼ぶ（内部API）
		local partResults = PartOps.execute({ partOp })
		local partResult = partResults and partResults[1]

		-- PartOpsの実行結果を検証
		if not partResult or partResult.success == false then
			local err = partResult and partResult.error or { code = "PART_CREATE_FAILED", message = "パーツ生成失敗" }
			return {
				success = false,
				error = err,
			}
		end

		-- 検証結果の構築
		local validationResult = nil
		if #validateChecks > 0 then
			validationResult = ConstraintSolver.validate(solved.cframe, solved.size, validateChecks, allowList)
		end

		return {
			success = true,
			data = {
				created_ids = { partResult.data and partResult.data.name or partOp.name or "unknown" },
				resolved_pose = {
					pos = { math.floor(pos.X * 2 + 0.5) / 2, math.floor(pos.Y * 2 + 0.5) / 2, math.floor(pos.Z * 2 + 0.5) / 2 },
					yaw = math.floor(math.deg(yaw) + 0.5),
					size = { solved.size.X, solved.size.Y, solved.size.Z },
				},
			},
			meta = validationResult and {
				validation = {
					passed = validationResult.passed,
					checks = validationResult.results,
				},
			} or nil,
		}

	elseif mode == "update" then
		if not target.name then
			return { success = false, error = { code = "NO_NAME", message = "update時はtarget.nameが必要" } }
		end

		local pos = solved.cframe.Position
		local setOp = {
			op = "set",
			name = target.name,
			props = {
				pos = { pos.X, pos.Y, pos.Z },
				size = { solved.size.X, solved.size.Y, solved.size.Z },
			},
		}

		local setResults = PartOps.execute({ setOp })
		local setResult = setResults and setResults[1]

		if not setResult or setResult.success == false then
			local err = setResult and setResult.error or { code = "PART_SET_FAILED", message = "パーツ更新失敗" }
			return {
				success = false,
				error = err,
			}
		end

		return {
			success = true,
			data = {
				updated_ids = { target.name },
				resolved_pose = {
					pos = { math.floor(pos.X * 2 + 0.5) / 2, math.floor(pos.Y * 2 + 0.5) / 2, math.floor(pos.Z * 2 + 0.5) / 2 },
				},
			},
		}
	end

	return { success = false, error = { code = "UNKNOWN_MODE", message = "未知のmode: " .. tostring(mode) } }
end

-- execute: CommandRegistryから呼ばれるエントリポイント
function module.execute(ops)
	local results = {}
	for _, op in ipairs(ops) do
		local result
		if op.op == "apply_constraints" then
			result = module.applyConstraints(op)
		else
			result = { success = false, error = { code = "UNKNOWN_OP", message = "未知の操作: " .. tostring(op.op) } }
		end
		table.insert(results, result)
	end
	return results
end

return module
