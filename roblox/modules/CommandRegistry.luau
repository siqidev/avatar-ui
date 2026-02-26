--[[
  CommandRegistry — カテゴリ+opを実行関数に解決する登録型ルータ

  カテゴリ追加時にCommandReceiverを修正する必要をなくす。
  各Opsモジュールが自身を登録し、CommandReceiverはレジストリ経由でディスパッチする。
]]

local module = {}

-- { [category] = handler_module } — handler_moduleは execute(ops, context) を持つ
local handlers: { [string]: any } = {}

-- カテゴリハンドラを登録する
function module.register(category: string, handler: any)
	if handlers[category] then
		warn("[CommandRegistry] カテゴリ上書き: " .. category)
	end
	handlers[category] = handler
	print("[CommandRegistry] 登録: " .. category)
end

-- カテゴリに対応するハンドラを取得する（未登録ならnil）
function module.resolve(category: string): any?
	return handlers[category]
end

-- 登録済みカテゴリ一覧を返す
function module.categories(): { string }
	local result = {}
	for cat in pairs(handlers) do
		table.insert(result, cat)
	end
	return result
end

return module
