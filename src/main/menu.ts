// AUI カスタムメニュー
// AUIメニュー: テーマ・モデルのradio選択 + About
// Edit/View/Window: Electron標準

import { app, Menu, type BrowserWindow, type MenuItemConstructorOptions } from "electron"
import { getSettings, updateSettings, MODEL_CATALOG, type Theme } from "../runtime/settings-store.js"
import { resetChainForModelSwitch } from "./field-runtime.js"
import { setLocale, type Locale } from "../shared/i18n.js"
import * as log from "../logger.js"

/** メニューを構築して適用する */
export function buildAppMenu(getMainWindow: () => BrowserWindow | null): void {
  const settings = getSettings()

  const template: MenuItemConstructorOptions[] = [
    // --- AUI アプリメニュー ---
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        // テーマ
        {
          label: "Theme",
          submenu: [
            {
              label: "Modern",
              type: "radio",
              checked: settings.theme === "modern",
              click: () => onThemeChange("modern", getMainWindow),
            },
            {
              label: "Classic",
              type: "radio",
              checked: settings.theme === "classic",
              click: () => onThemeChange("classic", getMainWindow),
            },
          ],
        },
        // モデル（MODEL_CATALOGから生成）
        {
          label: "Model",
          submenu: MODEL_CATALOG.map((id) => ({
            label: id,
            type: "radio" as const,
            checked: settings.model === id,
            click: () => onModelChange(id),
          })),
        },
        // 言語
        {
          label: "Language",
          submenu: [
            {
              label: "日本語",
              type: "radio",
              checked: settings.locale === "ja",
              click: () => onLocaleChange("ja", getMainWindow),
            },
            {
              label: "English",
              type: "radio",
              checked: settings.locale === "en",
              click: () => onLocaleChange("en", getMainWindow),
            },
          ],
        },
        // 共振（観測→AI転送→応答生成）
        { type: "separator" },
        {
          label: "Resonance",
          type: "checkbox",
          checked: settings.resonance,
          click: (menuItem) => onResonanceChange(menuItem.checked),
        },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    // --- Edit（標準） ---
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    // --- View（開発用） ---
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { role: "togglefullscreen" },
      ],
    },
    // --- Window（標準） ---
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { role: "close" },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function onThemeChange(theme: Theme, getMainWindow: () => BrowserWindow | null): void {
  updateSettings({ theme })
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send("settings.theme", theme)
  }
  log.info(`[MENU] テーマ変更: ${theme}`)
}

function onResonanceChange(enabled: boolean): void {
  updateSettings({ resonance: enabled })
  log.info(`[MENU] 共振モード変更: ${enabled ? "on" : "off"}`)
}

function onModelChange(model: string): void {
  updateSettings({ model })
  // previous_response_idはモデル間で共有不可 → チェーンリセット
  resetChainForModelSwitch()
  log.info(`[MENU] モデル変更: ${model}`)
}

function onLocaleChange(locale: Locale, getMainWindow: () => BrowserWindow | null): void {
  updateSettings({ locale })
  setLocale(locale)
  // メニューのradio状態を更新するために再構築
  buildAppMenu(getMainWindow)
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send("settings.locale", locale)
  }
  log.info(`[MENU] 言語変更: ${locale}`)
}
