--[[
  NpcOps — NPC操作モジュール（v3）

  操作: say / emote / move_to（レガシー互換）
  移動制御はNpcMotionOpsに委譲。NPC検索はSpatialService経由。
]]

local Chat = game:GetService("Chat")

local SpatialService = require(script.Parent.SpatialService)
local NpcMotionOps = require(script.Parent.NpcMotionOps)

-- アニメーションID（R15デフォルト）
local ANIM_IDS = {
	walk = "rbxassetid://507777826",     -- R15 Walk
	run = "rbxassetid://507767714",      -- R15 Run
	idle = "rbxassetid://507766666",     -- R15 Idle
	jump = "rbxassetid://507765000",     -- R15 Jump
	fall = "rbxassetid://507767968",     -- R15 Fall
	wave = "rbxassetid://507770239",
	cheer = "rbxassetid://507770677",
	dance = "rbxassetid://507771019",
	laugh = "rbxassetid://507770818",
	point = "rbxassetid://507770453",
}

-- チャット履歴表示用RemoteEvent（サーバー→クライアント転送）
local spectraChatEvent = Instance.new("RemoteEvent")
spectraChatEvent.Name = "SpectraChatEvent"
spectraChatEvent.Parent = game.ReplicatedStorage

-- Animator取得（なければ作成）
local function getAnimator(humanoid)
	local animator = humanoid:FindFirstChildOfClass("Animator")
	if not animator then
		animator = Instance.new("Animator")
		animator.Parent = humanoid
	end
	return animator
end

-- アニメーション再生（Animateスクリプトのidle/walkより優先するためAction設定）
local function playAnimation(humanoid, animId)
	local animator = getAnimator(humanoid)
	local anim = Instance.new("Animation")
	anim.AnimationId = animId
	local track = animator:LoadAnimation(anim)
	track.Priority = Enum.AnimationPriority.Action
	track:Play()
	return track
end

-- say: 吹き出し表示（Chat:Chatで頭上バブル）
local function handleSay(op)
	local npc = SpatialService.findNpc()
	if not npc then return { success = false, error = { code = "NPC_NOT_FOUND", message = "NPCが見つかりません" } } end

	local text = op.text or ""
	if text == "" then return { success = false, error = { code = "EMPTY_TEXT", message = "textが空" } } end

	local head = npc:FindFirstChild("Head")
	if not head then
		return { success = false, error = { code = "NO_HEAD", message = "NPCにHeadがありません" } }
	end

	Chat:Chat(head, text, Enum.ChatColor.Blue)
	spectraChatEvent:FireAllClients(text)

	return { success = true, data = { text = text } }
end

-- emote: アニメーション再生
local function handleEmote(op)
	local npc = SpatialService.findNpc()
	if not npc then return { success = false, error = { code = "NPC_NOT_FOUND", message = "NPCが見つかりません" } } end

	local humanoid = npc:FindFirstChildOfClass("Humanoid")
	if not humanoid then return { success = false, error = { code = "NO_HUMANOID", message = "Humanoidが見つかりません" } } end

	local emoteName = op.name or "wave"
	local animId = ANIM_IDS[emoteName]
	if not animId then
		return { success = false, error = { code = "UNKNOWN_EMOTE", message = "未知のエモート: " .. emoteName } }
	end

	local track = playAnimation(humanoid, animId)
	track.Stopped:Wait()

	return { success = true, data = { emote = emoteName } }
end

-- move_to: レガシー互換（v2形式の絶対座標移動）→ NpcMotionOpsに委譲
local function handleMoveTo(op)
	-- v3: user_idがあればgo_to_playerとして処理
	if op.user_id then
		return NpcMotionOps.goToPlayer(op)
	end

	-- v2互換: 絶対座標移動
	local npc = SpatialService.findNpc()
	if not npc then return { success = false, error = { code = "NPC_NOT_FOUND", message = "NPCが見つかりません" } } end

	local humanoid = npc:FindFirstChildOfClass("Humanoid")
	local rootPart = SpatialService.getRootPart(npc)
	if not humanoid or not rootPart then
		return { success = false, error = { code = "NO_HUMANOID", message = "Humanoid/ルートPartが見つかりません" } }
	end

	local PathfindingService = game:GetService("PathfindingService")
	local pos = op.pos or { 0, 0, 0 }
	local target = Vector3.new(pos[1] or 0, pos[2] or 0, pos[3] or 0)
	local path = PathfindingService:CreatePath({
		AgentRadius = 2,
		AgentHeight = 5,
		AgentCanJump = true,
	})

	path:ComputeAsync(rootPart.Position, target)
	if path.Status ~= Enum.PathStatus.Success then
		return { success = false, error = { code = "NO_PATH", message = "経路計算失敗: " .. tostring(path.Status), retryable = true } }
	end

	local walkTrack = playAnimation(humanoid, ANIM_IDS.walk)

	for _, waypoint in ipairs(path:GetWaypoints()) do
		if waypoint.Action == Enum.PathWaypointAction.Jump then
			humanoid.Jump = true
		end
		humanoid:MoveTo(waypoint.Position)
		humanoid.MoveToFinished:Wait()
	end

	walkTrack:Stop(0.1)
	humanoid:Move(Vector3.zero)

	return { success = true, data = { target = { target.X, target.Y, target.Z } } }
end

local module = {}

function module.execute(ops)
	local results = {}
	for _, op in ipairs(ops) do
		local result
		if op.op == "say" then
			result = handleSay(op)
		elseif op.op == "emote" then
			result = handleEmote(op)
		elseif op.op == "move_to" then
			result = handleMoveTo(op)
		else
			result = { success = false, error = { code = "UNKNOWN_OP", message = "未知の操作: " .. tostring(op.op) } }
		end
		table.insert(results, result)
	end
	return results
end

return module
