--[[
  NpcMotionOps — go_to_player/follow_player/stop_followingの移動制御

  追従ループはRoblox内で閉じ、AIには状態変化イベントのみ送信する。
  PathfindingServiceで経路計算、0.5秒ごとに再計算。
]]

local PathfindingService = game:GetService("PathfindingService")

local SpatialService = require(script.Parent.SpatialService)
local ObservationClient = require(script.Parent.ObservationClient)

-- R15デフォルトアニメーション
local WALK_ANIM_ID = "rbxassetid://507777826"
local IDLE_ANIM_ID = "rbxassetid://507766666"

-- 追従状態
local activeFollow: {
	followId: string,
	userId: number,
	standoff: number,
	running: boolean,
	walkTrack: AnimationTrack?,
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

-- Animator上の全再生中トラックを即停止（残留アニメ防止）
local function stopAllTracks(humanoid: Humanoid)
	local animator = getAnimator(humanoid)
	for _, track in ipairs(animator:GetPlayingAnimationTracks()) do
		track:Stop(0)
	end
end

-- Animateスクリプトを無効化（存在すれば）
local function disableAnimateScript(npc: Model)
	local animateScript = npc:FindFirstChild("Animate")
	if animateScript then
		animateScript.Disabled = true
	end
end

-- アニメーショントラック作成（再生はしない）
local function loadAnim(humanoid: Humanoid, animId: string): AnimationTrack
	local animator = getAnimator(humanoid)
	local anim = Instance.new("Animation")
	anim.AnimationId = animId
	return animator:LoadAnimation(anim)
end

-- 歩行アニメーション開始（開始前に全トラック停止）
local function startWalk(humanoid: Humanoid): AnimationTrack
	stopAllTracks(humanoid)
	local track = loadAnim(humanoid, WALK_ANIM_ID)
	track:Play()
	return track
end

-- パスに沿って歩く（ワンショット）
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

	local walkTrack = startWalk(humanoid)

	for _, waypoint in ipairs(waypoints) do
		if waypoint.Action == Enum.PathWaypointAction.Jump then
			humanoid.Jump = true
		end
		humanoid:MoveTo(waypoint.Position)
		humanoid.MoveToFinished:Wait()
	end

	walkTrack:Stop(0)
	stopAllTracks(humanoid) -- 残留トラックも含めて全停止
	humanoid:Move(Vector3.zero) -- 移動ベクトルをゼロに

	local finalDistance = (rootPart.Position - targetPos).Magnitude
	print("[NpcMotionOps] walkPath完了: 最終距離=" .. math.floor(finalDistance + 0.5))
	return true, "SUCCESS", math.floor(finalDistance + 0.5)
end

-- go_to_player: プレイヤーの現在位置へワンショット移動
function module.goToPlayer(op): { [string]: any }
	local npc = SpatialService.findNpc()
	if not npc then error("[NpcMotionOps] goToPlayer: NPCが見つからない") end

	-- Animateスクリプト無効化 + 全トラック停止（go_to_playerでも必要）
	disableAnimateScript(npc)
	local humanoid = npc:FindFirstChildOfClass("Humanoid")
	if humanoid then stopAllTracks(humanoid) end

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
		walkTrack = nil,
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
		local ok, err = xpcall(function()
		local humanoid = npc:FindFirstChildOfClass("Humanoid")
		if not humanoid then error("[NpcMotionOps] followループ: Humanoidが見つからない") end

		-- Animate無効化 + 全トラック停止
		disableAnimateScript(npc)
		stopAllTracks(humanoid)

		local walkTrack = loadAnim(humanoid, WALK_ANIM_ID)
		local idleTrack = loadAnim(humanoid, IDLE_ANIM_ID)
		-- 開始時はアイドル浮遊から
		idleTrack:Play()
		if activeFollow then
			activeFollow.walkTrack = walkTrack
		end

		local lostTimer = 0

		while activeFollow and activeFollow.followId == followId and activeFollow.running do
			local player = SpatialService.findPlayer(userId)
			if not player or not player.Character then
				lostTimer += repathInterval
				if lostTimer >= lostTimeout then
					warn("[NpcMotionOps] followループ: プレイヤーを見失った")
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

			local playerRoot = SpatialService.getRootPart(player.Character)
			if not playerRoot then
				lostTimer += repathInterval
				if lostTimer >= lostTimeout then
					break
				end
				task.wait(repathInterval)
				continue
			end
			lostTimer = 0

			local playerPos = playerRoot.Position
			local npcPos = rootPart.Position
			-- 水平距離（XZ）で判定（段差でstandoff判定が狂うのを防ぐ）
			local diff2d = Vector3.new(playerPos.X - npcPos.X, 0, playerPos.Z - npcPos.Z)
			local distance = diff2d.Magnitude

			if distance > standoff then
				-- 移動開始: walk再生、idle停止
				if not walkTrack.IsPlaying then
					idleTrack:Stop()
					walkTrack:Play()
				end

				-- standoff手前を目標（ゼロ距離ガード）
				local diff = playerPos - npcPos
				local targetPos = if diff.Magnitude > 0.1
					then playerPos - diff.Unit * standoff
					else playerPos

				local path = PathfindingService:CreatePath({
					AgentRadius = 2,
					AgentHeight = 5,
					AgentCanJump = true,
				})

				path:ComputeAsync(npcPos, targetPos)
				if path.Status == Enum.PathStatus.Success then
					local waypoints = path:GetWaypoints()
					-- 最初の数ウェイポイントだけ歩く（再計算のため）
					local maxWaypoints = math.min(3, #waypoints)
					for i = 1, maxWaypoints do
						if not activeFollow or activeFollow.followId ~= followId or not activeFollow.running then
							break
						end
						local wp = waypoints[i]
						if wp.Action == Enum.PathWaypointAction.Jump then
							humanoid.Jump = true
						end
						humanoid:MoveTo(wp.Position)
						humanoid.MoveToFinished:Wait()
					end
				else
					-- 経路計算失敗: 全停止 + idle再生
					humanoid:Move(Vector3.zero)
					stopAllTracks(humanoid)
					idleTrack:Play()
					ObservationClient.send("npc_follow_event", {
						follow_id = followId,
						state = "path_failed",
						user_id = userId,
					})
				end
			else
				-- standoff距離内: 全停止 + idle再生
				humanoid:Move(Vector3.zero)
				stopAllTracks(humanoid)
				idleTrack:Play()
			end

			task.wait(repathInterval)
		end

		walkTrack:Stop()
		idleTrack:Stop()

		-- Animateスクリプトを復帰
		if animateScript then
			animateScript.Disabled = false
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
		end, debug.traceback) -- xpcall終了
		if not ok then
			warn("[NpcMotionOps] followループ内エラー（fail-fast）: " .. tostring(err))
			activeFollow = nil
		end
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
