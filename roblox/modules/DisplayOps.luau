--[[
  DisplayOps — テキスト表示操作モジュール

  操作: set_text / clear
  Workspace内の指定パーツ/モデルにSurfaceGuiでテキストを表示する。
  用途: データフィード表示、ステータス表示等の汎用テキスト出力。
]]

local module = {}

-- SurfaceGui名のプレフィックス（AI生成の表示を識別する）
local GUI_PREFIX = "AIDisplay_"

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

-- SurfaceGuiを取得または作成する
local function ensureSurfaceGui(target: Instance, face: Enum.NormalId): SurfaceGui?
	local guiName = GUI_PREFIX .. target.Name
	local adornee = resolveBasePart(target)
	if not adornee then
		warn("[DisplayOps] BasePartが見つかりません: " .. target.Name)
		return nil
	end

	-- 既存のSurfaceGuiがあれば再利用
	local existing = adornee:FindFirstChild(guiName)
	if existing and existing:IsA("SurfaceGui") then
		return existing :: SurfaceGui
	end

	-- 新規作成
	local gui = Instance.new("SurfaceGui")
	gui.Name = guiName
	gui.Face = face
	gui.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
	gui.PixelsPerStud = 50

	-- 背景フレーム
	local frame = Instance.new("Frame")
	frame.Name = "Background"
	frame.Size = UDim2.fromScale(1, 1)
	frame.BackgroundColor3 = Color3.fromRGB(10, 15, 25)
	frame.BackgroundTransparency = 0.1
	frame.BorderSizePixel = 0
	frame.Parent = gui

	-- 余白
	local padding = Instance.new("UIPadding")
	padding.PaddingTop = UDim.new(0, 8)
	padding.PaddingBottom = UDim.new(0, 8)
	padding.PaddingLeft = UDim.new(0, 10)
	padding.PaddingRight = UDim.new(0, 10)
	padding.Parent = frame

	-- タイトルラベル
	local titleLabel = Instance.new("TextLabel")
	titleLabel.Name = "Title"
	titleLabel.Size = UDim2.new(1, 0, 0, 30)
	titleLabel.Position = UDim2.fromOffset(0, 0)
	titleLabel.BackgroundTransparency = 1
	titleLabel.TextColor3 = Color3.fromRGB(100, 200, 255)
	titleLabel.TextSize = 20
	titleLabel.Font = Enum.Font.GothamBold
	titleLabel.TextXAlignment = Enum.TextXAlignment.Left
	titleLabel.TextYAlignment = Enum.TextYAlignment.Center
	titleLabel.Text = ""
	titleLabel.Parent = frame

	-- 本文ラベル
	local bodyLabel = Instance.new("TextLabel")
	bodyLabel.Name = "Body"
	bodyLabel.Size = UDim2.new(1, 0, 1, -34)
	bodyLabel.Position = UDim2.new(0, 0, 0, 34)
	bodyLabel.BackgroundTransparency = 1
	bodyLabel.TextColor3 = Color3.fromRGB(200, 220, 240)
	bodyLabel.TextSize = 14
	bodyLabel.Font = Enum.Font.Gotham
	bodyLabel.TextXAlignment = Enum.TextXAlignment.Left
	bodyLabel.TextYAlignment = Enum.TextYAlignment.Top
	bodyLabel.TextWrapped = true
	bodyLabel.Text = ""
	bodyLabel.Parent = frame

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

	local frame = gui:FindFirstChild("Background")
	if frame then
		local titleLabel = frame:FindFirstChild("Title")
		local bodyLabel = frame:FindFirstChild("Body")
		if titleLabel then
			(titleLabel :: TextLabel).Text = op.title or ""
		end
		if bodyLabel then
			(bodyLabel :: TextLabel).Text = op.text or ""
		end
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
