--[[
  NpcMotionOps — go_to_player/follow_player/stop_followingの移動制御

  追従ループはRoblox内で閉じ、AIには状態変化イベントのみ送信する。
  PathfindingServiceで経路計算、0.5秒ごとに再計算。

  アニメーション制御:
  Humanoid.Runningイベント駆動（物理速度に連動）。
  移動ロジックからアニメーションを完全分離し、
  「止まっているのに走りモーション」問題を根治する。
  速度ウォッチドッグ（AssemblyLinearVelocity）をフォールバックとして併用。
]]

local PathfindingService = game:GetService("PathfindingService")

local SpatialService = require(script.Parent.SpatialService)
local ObservationClient = require(script.Parent.ObservationClient)

-- R15デフォルトアニメーション
local WALK_ANIM_ID = "rbxassetid://507777826"
local IDLE_ANIM_ID = "rbxassetid://507766666"

-- ヒステリシス幅（standoff境界での移動/停止振動を防ぐ）
local HYSTERESIS_MARGIN = 1.5

-- アニメーション速度閾値（Humanoid.Running速度でのヒステリシス）
local WALK_SPEED_THRESHOLD = 0.8
local IDLE_SPEED_THRESHOLD = 0.2

-- 追従状態
local activeFollow: {
	followId: string,
	userId: number,
	standoff: number,
	running: boolean,
}? = nil

local followCounter = 0

local module = {}

-- user_idバリデーション（システム境界: JSON由来の値をnumberに正規化）
-- 数値文字列は変換、非数値文字列はerror（AIのツール呼出しバグを即検出）
local function resolveUserId(rawUserId: any): number?
	if rawUserId == nil then return nil end
	if type(rawUserId) == "number" then return rawUserId end
	if type(rawUserId) == "string" then
		local num = tonumber(rawUserId)
		if num then return num end
		error("[NpcMotionOps] user_idに非数値文字列が渡された: \"" .. rawUserId .. "\" — AIがUserId(数値)ではなくユーザー名を送信している")
	end
	error("[NpcMotionOps] user_idの型が不正: " .. type(rawUserId))
end

-- Animator取得（なければ作成）
local function getAnimator(humanoid: Humanoid): Animator
	local animator = humanoid:FindFirstChildOfClass("Animator")
	if not animator then
		animator = Instance.new("Animator")
		animator.Parent = humanoid
	end
	return animator
end

-- Animator上の全再生中トラックを停止
local function stopAllTracks(humanoid: Humanoid)
	local animator = getAnimator(humanoid)
	for _, track in ipairs(animator:GetPlayingAnimationTracks()) do
		track:Stop(0.1)
	end
end

-- アニメーショントラック作成（再生はしない）
local function loadAnim(humanoid: Humanoid, animId: string): AnimationTrack
	local animator = getAnimator(humanoid)
	local anim = Instance.new("Animation")
	anim.AnimationId = animId
	return animator:LoadAnimation(anim)
end

--[[
  アニメーションコントローラ（Humanoid.Runningイベント駆動）

  移動ロジックからアニメーションを完全分離する。
  - Humanoid.Running: NPCの物理速度に連動して自動切替（一次情報源）
  - checkVelocity: AssemblyLinearVelocity監視（Runningイベント不発時のフォールバック）
  - destroy: 接続解除＋全トラック停止（必ず呼ぶこと）
]]
local function createAnimController(humanoid: Humanoid, rootPart: BasePart)
	stopAllTracks(humanoid)

	local walkTrack = loadAnim(humanoid, WALK_ANIM_ID)
	local idleTrack = loadAnim(humanoid, IDLE_ANIM_ID)
	local isWalking = false

	local function switchToWalk()
		if not isWalking then
			idleTrack:Stop(0.1)
			walkTrack:Play()
			isWalking = true
		end
	end

	local function switchToIdle()
		if isWalking then
			walkTrack:Stop(0.1)
			idleTrack:Play()
			isWalking = false
		end
	end

	-- Humanoid.Running: NPCの物理的な移動速度に直結
	local runningConn = humanoid.Running:Connect(function(speed)
		if speed > WALK_SPEED_THRESHOLD then
			switchToWalk()
		elseif speed < IDLE_SPEED_THRESHOLD then
			switchToIdle()
		end
	end)

	-- 初期状態: idle
	idleTrack:Play()

	return {
		switchToIdle = switchToIdle,
		isWalking = function() return isWalking end,

		-- 速度ウォッチドッグ: Runningイベントが発火しない場合のフォールバック
		checkVelocity = function()
			local vel = rootPart.AssemblyLinearVelocity
			local horizSpeed = Vector3.new(vel.X, 0, vel.Z).Magnitude
			if isWalking and horizSpeed < IDLE_SPEED_THRESHOLD then
				switchToIdle()
			end
		end,

		destroy = function()
			runningConn:Disconnect()
			walkTrack:Stop(0.1)
			idleTrack:Stop(0.1)
			stopAllTracks(humanoid)
		end,
	}
end

-- パスに沿って歩く（ワンショット）— アニメーションはRunningイベント駆動
local function walkPath(npc: Model, targetPos: Vector3): (boolean, string, number)
	local humanoid = npc:FindFirstChildOfClass("Humanoid")
	local rootPart = SpatialService.getRootPart(npc)
	if not humanoid then error("[NpcMotionOps] walkPath: Humanoidが見つからない") end
	if not rootPart then error("[NpcMotionOps] walkPath: ルートPartが見つからない") end

	print("[NpcMotionOps] walkPath開始: " .. tostring(rootPart.Position) .. " → " .. tostring(targetPos))

	local path = PathfindingService:CreatePath({
		AgentRadius = 2,
		AgentHeight = 5,
		AgentCanJump = true,
	})

	path:ComputeAsync(rootPart.Position, targetPos)
	if path.Status ~= Enum.PathStatus.Success then
		print("[NpcMotionOps] 経路計算失敗（外部条件）: " .. tostring(path.Status))
		return false, "NO_PATH", -1
	end

	local waypoints = path:GetWaypoints()
	print("[NpcMotionOps] 経路計算成功: " .. #waypoints .. "ウェイポイント")

	-- アニメーションはRunningイベントが自動制御
	local animCtrl = createAnimController(humanoid, rootPart)

	local reached = true
	for _, waypoint in ipairs(waypoints) do
		if waypoint.Action == Enum.PathWaypointAction.Jump then
			humanoid.Jump = true
		end
		humanoid:MoveTo(waypoint.Position)
		local waypointReached = humanoid.MoveToFinished:Wait()
		if not waypointReached then
			-- 8秒タイムアウト: 経路到達失敗
			print("[NpcMotionOps] walkPath: ウェイポイント到達タイムアウト")
			reached = false
			break
		end
	end

	-- 移動停止 → Runningイベントでidle化 → ウォッチドッグで確認
	humanoid:Move(Vector3.zero)
	task.wait(0.15)
	animCtrl.checkVelocity()
	animCtrl.destroy()

	local finalDistance = (rootPart.Position - targetPos).Magnitude
	print("[NpcMotionOps] walkPath完了: 最終距離=" .. math.floor(finalDistance + 0.5))
	return reached, reached and "SUCCESS" or "MOVE_TIMEOUT", math.floor(finalDistance + 0.5)
end

-- go_to_player: プレイヤーの現在位置へワンショット移動
function module.goToPlayer(op): { [string]: any }
	local npc = SpatialService.findNpc()
	if not npc then error("[NpcMotionOps] goToPlayer: NPCが見つからない") end

	local humanoid = npc:FindFirstChildOfClass("Humanoid")
	if not humanoid then error("[NpcMotionOps] goToPlayer: Humanoidが見つからない") end

	local rootPart = SpatialService.getRootPart(npc)
	if not rootPart then error("[NpcMotionOps] goToPlayer: NPCにルートPartがない") end

	local userId = resolveUserId(op.user_id)
	local standoff = op.standoff or 3
	local player = SpatialService.findPlayer(userId)
	if not player or not player.Character then
		error("[NpcMotionOps] goToPlayer: プレイヤーが見つからない: userId=" .. tostring(userId))
	end

	local playerRoot = SpatialService.getRootPart(player.Character)
	if not playerRoot then error("[NpcMotionOps] goToPlayer: プレイヤーキャラクターにルートPartがない") end

	local targetPos = playerRoot.Position
	-- standoff分手前を目標にする（ゼロ距離ガード: 同一座標ならオフセットなし）
	local diff = targetPos - rootPart.Position
	if diff.Magnitude > 0.1 then
		targetPos = targetPos - diff.Unit * standoff
	end

	print("[NpcMotionOps] go_to_player: プレイヤー=" .. player.Name .. " standoff=" .. standoff)

	local reached, pathStatus, finalDist = walkPath(npc, targetPos)

	local npcPose = SpatialService.getEntityPose("npc")
	local playerPose = SpatialService.getEntityPose("player", userId and tostring(userId) or nil)

	return {
		success = reached,
		data = {
			reached = reached,
			final_distance = finalDist,
			path_status = pathStatus,
			npc_pose = npcPose,
			target_pose = playerPose,
		},
		error = not reached and { code = pathStatus, message = "経路到達失敗", retryable = true } or nil,
	}
end

-- follow_player: 追従ループ開始
function module.followPlayer(op): { [string]: any }
	-- 既存の追従を停止
	if activeFollow then
		module.stopFollowing({})
	end

	local npc = SpatialService.findNpc()
	if not npc then error("[NpcMotionOps] followPlayer: NPCが見つからない") end

	local rootPart = SpatialService.getRootPart(npc)
	if not rootPart then error("[NpcMotionOps] followPlayer: NPCにルートPartがない") end

	local userId = resolveUserId(op.user_id)
	local standoff = op.standoff or 4
	local repathInterval = (op.repath_interval_ms or 500) / 1000
	local lostTimeout = op.lost_timeout_s or 3

	-- 事前検証: プレイヤー存在確認（started ACK前に失敗させる）
	local player = SpatialService.findPlayer(userId)
	if not player or not player.Character then
		error("[NpcMotionOps] followPlayer: プレイヤーが見つからない: userId=" .. tostring(userId))
	end
	local playerRoot = SpatialService.getRootPart(player.Character)
	if not playerRoot then
		error("[NpcMotionOps] followPlayer: プレイヤーキャラクターにルートPartがない")
	end

	followCounter += 1
	local followId = "follow-" .. tostring(followCounter)

	activeFollow = {
		followId = followId,
		userId = userId,
		standoff = standoff,
		running = true,
	}

	print("[NpcMotionOps] follow_player開始: followId=" .. followId .. " userId=" .. tostring(userId) .. " standoff=" .. standoff)

	-- イベント送信: started（事前検証通過後のみ）
	ObservationClient.send("npc_follow_event", {
		follow_id = followId,
		state = "started",
		user_id = userId,
	})

	-- 追従ループ（非同期、xpcallでエラー可視化）
	task.spawn(function()
		-- クリーンアップ対象をxpcall外で宣言（エラー時もdestroy可能にする）
		local animCtrl = nil
		local animateScript = nil

		local ok, err = xpcall(function()
		local humanoid = npc:FindFirstChildOfClass("Humanoid")
		if not humanoid then error("[NpcMotionOps] followループ: Humanoidが見つからない") end

		-- Animateスクリプト無効化（存在すれば。NPC手動アニメと競合防止）
		animateScript = npc:FindFirstChild("Animate")
		if animateScript then
			animateScript.Disabled = true
		end

		-- アニメーションはRunningイベント駆動（移動ロジックから完全分離）
		animCtrl = createAnimController(humanoid, rootPart)

		local lostTimer = 0

		while activeFollow and activeFollow.followId == followId and activeFollow.running do
			local currentPlayer = SpatialService.findPlayer(userId)
			if not currentPlayer or not currentPlayer.Character then
				lostTimer += repathInterval
				if lostTimer >= lostTimeout then
					warn("[NpcMotionOps] followループ: プレイヤーを見失った")
					humanoid:Move(Vector3.zero)
					ObservationClient.send("npc_follow_event", {
						follow_id = followId,
						state = "lost",
						user_id = userId,
					})
					break
				end
				task.wait(repathInterval)
				continue
			end

			local currentPlayerRoot = SpatialService.getRootPart(currentPlayer.Character)
			if not currentPlayerRoot then
				lostTimer += repathInterval
				if lostTimer >= lostTimeout then
					humanoid:Move(Vector3.zero)
					break
				end
				task.wait(repathInterval)
				continue
			end
			lostTimer = 0

			local playerPos = currentPlayerRoot.Position
			local npcPos = rootPart.Position
			-- 水平距離（XZ）で判定（段差でstandoff判定が狂うのを防ぐ）
			local diff2d = Vector3.new(playerPos.X - npcPos.X, 0, playerPos.Z - npcPos.Z)
			local distance = diff2d.Magnitude

			-- ヒステリシス: 移動開始はstandoff+マージン、停止はstandoff以内
			-- アニメ状態（物理速度由来）を参照し、距離判定の振動を防ぐ
			local shouldMove = if animCtrl.isWalking()
				then distance > standoff
				else distance > standoff + HYSTERESIS_MARGIN

			if shouldMove then
				-- standoff手前を目標（ゼロ距離ガード）
				local diff = playerPos - npcPos
				local targetPos = if diff.Magnitude > 0.1
					then playerPos - diff.Unit * standoff
					else playerPos

				-- C: 障害物チェック（Raycast）— なければ直接MoveTo
				local rayOrigin = Vector3.new(npcPos.X, npcPos.Y + 3, npcPos.Z)
				local rayGoal = Vector3.new(targetPos.X, targetPos.Y + 3, targetPos.Z)
				local rayParams = RaycastParams.new()
				rayParams.FilterDescendantsInstances = {npc}
				rayParams.FilterType = Enum.RaycastFilterType.Exclude
				local rayResult = workspace:Raycast(rayOrigin, rayGoal - rayOrigin, rayParams)

				if not rayResult then
					-- 障害物なし: 直接MoveTo（連続呼出しで滑らかに歩く）
					humanoid:MoveTo(targetPos)
					task.wait(0.3)
				else
					-- 障害物あり: Pathfinding + A: WPスキップ
					local path = PathfindingService:CreatePath({
						AgentRadius = 2,
						AgentHeight = 5,
						AgentCanJump = true,
					})

					path:ComputeAsync(npcPos, targetPos)
					if path.Status == Enum.PathStatus.Success then
						local waypoints = path:GetWaypoints()
						-- A: 2個おきにWPを歩く（減速停止回数を削減）
						local step = if #waypoints > 4 then 2 else 1
						local maxIdx = math.min(step * 4, #waypoints)
						local i = step
						while i <= maxIdx do
							if not activeFollow or activeFollow.followId ~= followId or not activeFollow.running then
								break
							end
							-- スキップ区間にジャンプWPがあればジャンプ
							for j = math.max(1, i - step + 1), i do
								if waypoints[j] and waypoints[j].Action == Enum.PathWaypointAction.Jump then
									humanoid.Jump = true
									break
								end
							end
							humanoid:MoveTo(waypoints[i].Position)
							local wpReached = humanoid.MoveToFinished:Wait()
							if not wpReached then
								humanoid:Move(Vector3.zero)
								break
							end
							i += step
						end
					else
						-- 経路計算失敗: 停止して通常間隔待機
						humanoid:Move(Vector3.zero)
						ObservationClient.send("npc_follow_event", {
							follow_id = followId,
							state = "path_failed",
							user_id = userId,
						})
						task.wait(repathInterval)
					end
				end
				continue
			else
				-- E: standoff内 — 停止してプレイヤーの方を向く
				humanoid:Move(Vector3.zero)
				local lookTarget = Vector3.new(playerPos.X, rootPart.Position.Y, playerPos.Z)
				if (lookTarget - rootPart.Position).Magnitude > 0.5 then
					rootPart.CFrame = CFrame.lookAt(rootPart.Position, lookTarget)
				end
			end

			-- standoff内: ウォッチドッグ確認 + 通常間隔で待機
			animCtrl.checkVelocity()
			task.wait(repathInterval)
		end

		-- ループ終了: 移動停止
		humanoid:Move(Vector3.zero)
		end, debug.traceback) -- xpcall終了

		-- クリーンアップ（正常終了・エラー終了とも必ず実行）
		if animCtrl then
			animCtrl.destroy()
		end
		if animateScript then
			animateScript.Disabled = false
		end

		if not ok then
			warn("[NpcMotionOps] followループ内エラー（fail-fast）: " .. tostring(err))
		end

		-- 終了処理
		if activeFollow and activeFollow.followId == followId then
			ObservationClient.send("npc_follow_event", {
				follow_id = followId,
				state = "stopped",
				user_id = userId,
			})
			activeFollow = nil
		end
		print("[NpcMotionOps] followループ終了: " .. followId)
	end)

	return {
		success = true,
		data = {
			follow_id = followId,
			state = "started",
		},
	}
end

-- stop_following: 追従停止
function module.stopFollowing(op): { [string]: any }
	if not activeFollow then
		return { success = true, data = { state = "already_stopped" } }
	end

	local followId = activeFollow.followId
	activeFollow.running = false
	print("[NpcMotionOps] stop_following: " .. followId)

	return {
		success = true,
		data = {
			follow_id = followId,
			state = "stopped",
		},
	}
end

-- execute: CommandRegistryから呼ばれるエントリポイント
function module.execute(ops)
	local results = {}
	for _, op in ipairs(ops) do
		print("[NpcMotionOps] 実行: op=" .. tostring(op.op))
		local result
		if op.op == "go_to_player" then
			result = module.goToPlayer(op)
		elseif op.op == "follow_player" then
			result = module.followPlayer(op)
		elseif op.op == "stop_following" then
			result = module.stopFollowing(op)
		else
			result = { success = false, error = { code = "UNKNOWN_OP", message = "未知の操作: " .. tostring(op.op) } }
		end
		table.insert(results, result)
	end
	return results
end

return module
