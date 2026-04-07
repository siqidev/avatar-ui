--[[
  DisplayOps — テキスト表示操作モジュール

  操作: set_text / clear
  Workspace内の指定パーツ/モデルにSurfaceGuiでテキストを表示する。
  用途: データフィード表示、ステータス表示等の汎用テキスト出力。
]]

local module = {}

-- SurfaceGui名のプレフィックス（AI生成の表示を識別する）
local GUI_PREFIX = "AIDisplay_"

-- テキスト配色（近未来ゴールド/アンバー系）
local TITLE_COLOR = Color3.fromRGB(255, 200, 80)  -- 明るいゴールド
local BODY_COLOR = Color3.fromRGB(220, 175, 80)   -- アンバー

-- Workspace全体から名前でインスタンスを再帰検索（最初に見つかったものを返す）
local function findByName(name: string): Instance?
	local function search(parent: Instance): Instance?
		for _, child in parent:GetChildren() do
			if child.Name == name then
				return child
			end
			local found = search(child)
			if found then return found end
		end
		return nil
	end
	return search(workspace)
end

-- NormalId文字列をenumに変換
local FACE_MAP = {
	front = Enum.NormalId.Front,
	back = Enum.NormalId.Back,
	top = Enum.NormalId.Top,
	bottom = Enum.NormalId.Bottom,
	left = Enum.NormalId.Left,
	right = Enum.NormalId.Right,
}

-- SurfaceGuiを付与するBasePartを決定する
-- BasePart → そのまま返す
-- Model → PrimaryPart → 最初のBasePart子孫の順で検索
local function resolveBasePart(target: Instance): BasePart?
	if target:IsA("BasePart") then
		return target :: BasePart
	end
	if target:IsA("Model") then
		local primary = (target :: Model).PrimaryPart
		if primary then return primary end
		return target:FindFirstChildWhichIsA("BasePart", true) :: BasePart?
	end
	return nil
end

-- TextLabelを再帰検索する
local function findTextLabel(parent: Instance, name: string): TextLabel?
	local direct = parent:FindFirstChild(name, true)
	if direct and direct:IsA("TextLabel") then
		return direct :: TextLabel
	end
	return nil
end

-- TextLabelが無ければ作成する（既存のガワを壊さない）
local function ensureTextLabel(parent: Instance, name: string, props: {
	size: UDim2, position: UDim2, textSize: number, color: Color3
}): TextLabel
	local existing = findTextLabel(parent, name)
	if existing then return existing end

	-- 配置先: Background フレームがあればその中、なければSurfaceGui直下
	local container = parent:FindFirstChild("Background") or parent

	local label = Instance.new("TextLabel")
	label.Name = name
	label.Size = props.size
	label.Position = props.position
	label.BackgroundTransparency = 1
	label.TextColor3 = props.color
	label.TextSize = props.textSize
	label.Font = if name == "Title" then Enum.Font.GothamBold else Enum.Font.GothamMedium
	label.TextXAlignment = Enum.TextXAlignment.Left
	label.TextYAlignment = Enum.TextYAlignment.Top
	label.TextWrapped = true
	label.ZIndex = 5
	label.Text = ""
	label.Parent = container
	return label
end

-- SurfaceGuiを取得または作成する
-- 手動配置のSurfaceGui（AIDisplay_名前）があればガワを再利用し、TextLabelのみ確保
local function ensureSurfaceGui(target: Instance, face: Enum.NormalId): SurfaceGui?
	local guiName = GUI_PREFIX .. target.Name
	local adornee = resolveBasePart(target)
	if not adornee then
		warn("[DisplayOps] BasePartが見つかりません: " .. target.Name)
		return nil
	end

	-- 既存のSurfaceGuiがあれば再利用（手動配置対応）
	local existing = adornee:FindFirstChild(guiName)
	if existing and existing:IsA("SurfaceGui") then
		-- TextLabelだけ確保（ガワはそのまま）
		ensureTextLabel(existing, "Title", {
			size = UDim2.new(1, 0, 0, 24),
			position = UDim2.fromOffset(0, 0),
			textSize = 22,
			color = TITLE_COLOR,
		})
		ensureTextLabel(existing, "Body", {
			size = UDim2.new(1, 0, 1, -28),
			position = UDim2.new(0, 0, 0, 28),
			textSize = 16,
			color = BODY_COLOR,
		})
		return existing :: SurfaceGui
	end

	-- 手動配置なし → 自動生成（フォールバック）
	local gui = Instance.new("SurfaceGui")
	gui.Name = guiName
	gui.Face = face
	gui.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
	gui.PixelsPerStud = 50

	-- 背景フレーム
	local frame = Instance.new("Frame")
	frame.Name = "Background"
	frame.Size = UDim2.fromScale(1, 1)
	frame.BackgroundColor3 = Color3.fromRGB(15, 10, 5)
	frame.BackgroundTransparency = 0.1
	frame.BorderSizePixel = 0
	frame.Parent = gui

	-- 余白
	local padding = Instance.new("UIPadding")
	padding.PaddingTop = UDim.new(0, 12)
	padding.PaddingBottom = UDim.new(0, 12)
	padding.PaddingLeft = UDim.new(0, 14)
	padding.PaddingRight = UDim.new(0, 14)
	padding.Parent = frame

	-- タイトルラベル
	ensureTextLabel(gui, "Title", {
		size = UDim2.new(1, 0, 0, 24),
		position = UDim2.fromOffset(0, 0),
		textSize = 22,
		color = TITLE_COLOR,
	})

	-- 本文ラベル
	ensureTextLabel(gui, "Body", {
		size = UDim2.new(1, 0, 1, -28),
		position = UDim2.new(0, 0, 0, 28),
		textSize = 16,
		color = BODY_COLOR,
	})

	gui.Parent = adornee
	return gui
end

-- set_text: 指定オブジェクトにテキストを表示
local function handleSetText(op)
	local targetName = op.target
	if not targetName then
		return { success = false, error = { code = "NO_TARGET", message = "targetが必要" } }
	end

	local target = findByName(targetName)
	if not target then
		return { success = false, error = { code = "TARGET_NOT_FOUND", message = "対象が見つかりません: " .. targetName } }
	end

	local face = FACE_MAP[op.face or "front"] or Enum.NormalId.Front
	local gui = ensureSurfaceGui(target, face)
	if not gui then
		return { success = false, error = { code = "GUI_FAILED", message = "SurfaceGui作成失敗" } }
	end

	-- TextLabelを再帰検索して書き込み（手動配置/自動生成どちらでも動く）
	local titleLabel = findTextLabel(gui, "Title")
	local bodyLabel = findTextLabel(gui, "Body")
	if titleLabel then
		titleLabel.Text = op.title or ""
	end
	if bodyLabel then
		bodyLabel.Text = op.text or ""
	end

	print("[DisplayOps] set_text: " .. targetName)
	return { success = true, data = { target = targetName } }
end

-- clear: SurfaceGuiを削除
local function handleClear(op)
	local targetName = op.target
	if not targetName then
		return { success = false, error = { code = "NO_TARGET", message = "targetが必要" } }
	end

	local target = findByName(targetName)
	if not target then
		return { success = false, error = { code = "TARGET_NOT_FOUND", message = "対象が見つかりません: " .. targetName } }
	end

	local guiName = GUI_PREFIX .. target.Name
	local removed = false

	-- BasePartとその子孫から検索
	local adornee = resolveBasePart(target)
	if adornee then
		local existing = adornee:FindFirstChild(guiName)
		if existing then
			existing:Destroy()
			removed = true
		end
	end

	if not removed then
		return { success = false, error = { code = "NO_GUI", message = "表示が見つかりません: " .. targetName } }
	end

	print("[DisplayOps] clear: " .. targetName)
	return { success = true, data = { target = targetName } }
end

function module.execute(ops)
	local results = {}
	for _, op in ipairs(ops) do
		local result
		if op.op == "set_text" then
			result = handleSetText(op)
		elseif op.op == "clear" then
			result = handleClear(op)
		else
			result = { success = false, error = { code = "UNKNOWN_OP", message = "未知の操作: " .. tostring(op.op) } }
		end
		table.insert(results, result)
	end
	return results
end

return module
