import type { Tool } from "openai/resources/responses/responses"
import { z } from "zod/v4"

// roblox_actionツール v2 のResponses API定義
// AIがRoblox空間を操作する時に呼び出す（カテゴリ+操作列方式）
export const robloxActionToolDef: Tool = {
  type: "function",
  name: "roblox_action",
  description:
    "Roblox空間を操作する。カテゴリと操作列で構成される。" +
    "part: オブジェクト操作（建物・家具・装飾）。ops: create/set/delete。" +
    "  create: {op,shape(Block/Ball/Cylinder/Wedge/CornerWedge),size[x,y,z],pos[x,y,z],rot[x,y,z],material,color,name,transparency,parent,is_group}" +
    "  set: {op,name,props:{color,material,transparency,size[],pos[]}}" +
    "  delete: {op,name} or {op,all:true}" +
    "terrain: 地形操作。ops: fill/excavate/paint。" +
    "  fill: {op,shape(ball/block),pos[],radius|size[],material}" +
    "  excavate: {op,shape,pos[],radius|size[]}" +
    "  paint: {op,pos[],radius,material}" +
    "npc: NPC操作。ops: move_to/say/emote。" +
    "  move_to: {op,pos[]}" +
    "  say: {op,text}" +
    "  emote: {op,name(wave/cheer/dance/laugh/point)}" +
    "effect: 演出操作。ops: create/set/delete。" +
    "  create: {op,type(PointLight/SpotLight/Fire/Smoke/Sparkles/ParticleEmitter/Sound),parent,name,...props}" +
    "partのcreate時は情報が物質化する演出が自動付与される。" +
    "Roblox素材: Concrete,Wood,Brick,Glass,Marble,Metal,Granite,Slate,Sand,Grass,Ice,Snow,Neon等。" +
    "行動理由も含めること。",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["category", "ops", "reason"],
    properties: {
      category: {
        type: "string",
        description: "操作カテゴリ: part, terrain, npc, effect",
      },
      ops: {
        type: "array",
        description: "操作列。各要素はop(操作種別)を持つオブジェクト",
        items: {
          type: "object",
          additionalProperties: true,
        },
      },
      reason: {
        type: "string",
        description: "この操作を行う理由（短文）",
      },
    },
  },
  strict: false,
}

// ツール引数のバリデーションスキーマ
export const robloxActionArgsSchema = z.object({
  category: z.string().min(1),
  ops: z.array(z.record(z.string(), z.unknown())).min(1),
  reason: z.string().min(1),
})

export type RobloxActionArgs = z.infer<typeof robloxActionArgsSchema>
