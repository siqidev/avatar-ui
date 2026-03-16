// ChannelProjection: Rendererへの投影（送信+メッセージ整形）
// ipc-handlers から ToRendererMessage リテラル生成を除去し、ここに集約する
// 新チャネル追加時はこのモジュールに実装を追加し、ipc-handlers は無変更

import type { BrowserWindow } from "electron"
import type { FieldState, Source, ToRendererMessage, AlertCode } from "../shared/ipc-schema.js"
import type { ChannelId } from "../shared/channel.js"
import type { ToolCallInfo } from "../services/chat-session-service.js"
import type { PersistedMessage } from "../state/state-repository.js"

// --- 型定義 ---

export type ChannelProjection = {
  sendStreamReply(opts: StreamReplyOpts): void
  sendFieldState(opts: FieldStateOpts): void
  sendIntegrityAlert(code: AlertCode, message: string): void
  sendObservationEvent(opts: ObservationEventOpts): void
  sendXEvent(opts: XEventOpts): void
}

export type StreamReplyOpts = {
  actor: "human" | "ai"
  correlationId: string
  text: string
  source: Source
  channel: ChannelId
  toolCalls: ToolCallInfo[]
}

export type FieldStateOpts = {
  state: FieldState
  avatarName: string
  userName: string
  history: PersistedMessage[]
}

export type ObservationEventOpts = {
  eventType: string
  payload: Record<string, unknown>
  formatted: string
}

export type XEventOpts = {
  eventType: string
  payload: Record<string, unknown>
  formatted: string
}

// --- Console チャネル実装（Electron BrowserWindow） ---

export function createConsoleProjection(
  getMainWindow: () => BrowserWindow | null,
): ChannelProjection {
  function send(msg: ToRendererMessage): void {
    const win = getMainWindow()
    if (!win || win.isDestroyed()) return
    win.webContents.send(msg.type, msg)
  }

  return {
    sendStreamReply({ actor, correlationId, text, source, channel, toolCalls }) {
      send({
        type: "stream.reply",
        actor,
        correlationId,
        text,
        source,
        channel,
        toolCalls,
      })
    },

    sendFieldState({ state, avatarName, userName, history }) {
      send({
        type: "field.state",
        state,
        avatarName,
        userName,
        ...(history.length > 0 ? {
          lastMessages: history.map((m) => ({
            actor: m.actor,
            text: m.text,
            correlationId: "restored",
            source: m.source,
            channel: m.channel,
            toolCalls: m.toolCalls?.map((tc) => ({
              name: tc.name,
              args: tc.args ?? {} as Record<string, unknown>,
              result: tc.result,
            })),
          })),
        } : {}),
      })
    },

    sendIntegrityAlert(code, message) {
      send({
        type: "integrity.alert",
        code,
        message: `${message}。再起動してください`,
      })
    },

    sendObservationEvent({ eventType, payload, formatted }) {
      send({
        type: "observation.event",
        eventType,
        payload,
        formatted,
        timestamp: new Date().toISOString(),
      })
    },

    sendXEvent({ eventType, payload, formatted }) {
      send({
        type: "x.event",
        eventType,
        payload,
        formatted,
        timestamp: new Date().toISOString(),
      })
    },
  }
}
