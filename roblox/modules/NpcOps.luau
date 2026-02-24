--[[
  NpcOps — NPC操作モジュール

  操作: move_to / say / emote
]]

local PathfindingService = game:GetService("PathfindingService")
local TextChatService = game:GetService("TextChatService")

-- R15デフォルトアニメーションID
local ANIM_IDS = {
	walk = "rbxassetid://507777826",
	wave = "rbxassetid://507770239",
	cheer = "rbxassetid://507770677",
	dance = "rbxassetid://507771019",
	laugh = "rbxassetid://507770818",
	point = "rbxassetid://507770453",
}

local NPC_NAME = "SpectraCommunicator"

local function getNpc()
	local npc = workspace:FindFirstChild(NPC_NAME)
	if not npc then
		warn("[NpcOps] NPCが見つかりません: " .. NPC_NAME)
	end
	return npc
end

-- Animator取得（なければ作成）
local function getAnimator(humanoid)
	local animator = humanoid:FindFirstChildOfClass("Animator")
	if not animator then
		animator = Instance.new("Animator")
		animator.Parent = humanoid
	end
	return animator
end

-- アニメーション再生
local function playAnimation(humanoid, animId)
	local animator = getAnimator(humanoid)
	local anim = Instance.new("Animation")
	anim.AnimationId = animId
	local track = animator:LoadAnimation(anim)
	track:Play()
	return track
end

-- move_to: PathfindingServiceで目的地まで歩く（歩行アニメーション付き）
local function handleMoveTo(op)
	local npc = getNpc()
	if not npc then return end

	local humanoid = npc:FindFirstChildOfClass("Humanoid")
	if not humanoid then return end

	local pos = op.pos or { 0, 0, 0 }
	local target = Vector3.new(pos[1] or 0, pos[2] or 0, pos[3] or 0)
	local path = PathfindingService:CreatePath({
		AgentRadius = 2,
		AgentHeight = 5,
		AgentCanJump = true,
	})

	path:ComputeAsync(npc.HumanoidRootPart.Position, target)
	if path.Status ~= Enum.PathStatus.Success then
		warn("[NpcOps] 経路計算失敗: " .. tostring(path.Status))
		return
	end

	-- 歩行アニメーション開始
	local walkTrack = playAnimation(humanoid, ANIM_IDS.walk)

	for _, waypoint in ipairs(path:GetWaypoints()) do
		if waypoint.Action == Enum.PathWaypointAction.Jump then
			humanoid.Jump = true
		end
		humanoid:MoveTo(waypoint.Position)
		humanoid.MoveToFinished:Wait()
	end

	-- 歩行アニメーション停止
	walkTrack:Stop()
	print("[NpcOps] 移動完了: " .. tostring(target))
end

-- say: 吹き出し表示
local function handleSay(op)
	local npc = getNpc()
	if not npc then return end

	local text = op.text or ""
	if text == "" then return end

	TextChatService:DisplayBubble(npc, text)
	print("[NpcOps] 発話: " .. text)
end

-- emote: アニメーション再生
local function handleEmote(op)
	local npc = getNpc()
	if not npc then return end

	local humanoid = npc:FindFirstChildOfClass("Humanoid")
	if not humanoid then return end

	local emoteName = op.name or "wave"
	local animId = ANIM_IDS[emoteName]
	if not animId then
		warn("[NpcOps] 未知のエモート: " .. emoteName)
		return
	end

	local track = playAnimation(humanoid, animId)
	-- アニメーション完了まで待機
	track.Stopped:Wait()
	print("[NpcOps] エモート: " .. emoteName)
end

local module = {}

function module.execute(ops)
	for _, op in ipairs(ops) do
		if op.op == "move_to" then
			handleMoveTo(op)
		elseif op.op == "say" then
			handleSay(op)
		elseif op.op == "emote" then
			handleEmote(op)
		else
			warn("[NpcOps] 未知の操作: " .. tostring(op.op))
		end
	end
end

return module
