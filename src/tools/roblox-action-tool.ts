import type { Tool } from "openai/resources/responses/responses"
import { z } from "zod/v4"

// roblox_actionツール v3 のResponses API定義
// AIがRoblox空間を操作する時に呼び出す（カテゴリ+操作列方式）
// v3: npc_motion/build/spatial追加、制約ベース建築、ACK閉ループ
export const robloxActionToolDef: Tool = {
  type: "function",
  name: "roblox_action",
  description:
    "Roblox空間を操作する。カテゴリと操作列で構成される。" +
    "\n\n--- part ---\n" +
    "オブジェクト操作（建物・家具・装飾）。ops: create/set/delete。" +
    "  create: {op,shape(Block/Ball/Cylinder/Wedge/CornerWedge),size[x,y,z],pos[x,y,z],rot[x,y,z],material,color,name,transparency,parent,is_group}" +
    "  set: {op,name,props:{color,material,transparency,size[],pos[]}}" +
    "  delete: {op,name} or {op,all:true}" +
    "\n\n--- terrain ---\n" +
    "地形操作。ops: fill/excavate/paint/apply_constraints。" +
    "  fill: {op,shape(ball/block),pos[],radius|size[],material}" +
    "  excavate: {op,shape,pos[],radius|size[]}" +
    "  paint: {op,pos[],radius,material}" +
    "  apply_constraints: {op,target:{fill_op,shape,material,size[]?,radius?},constraints[],refs?}" +
    "\n\n--- npc ---\n" +
    "NPC操作（発話・エモート）。ops: say/emote/move_to。" +
    "  say: {op,text}" +
    "  emote: {op,name(wave/cheer/dance/laugh/point)}" +
    "  move_to: {op,pos[]}（レガシー。プレイヤーに向かうならnpc_motionのgo_to_playerを使うこと）" +
    "\n\n--- npc_motion ---\n" +
    "NPC移動制御。ops: go_to_player/follow_player/stop_following。" +
    "  go_to_player: {op,user_id?(数値UserId),standoff?} — プレイヤーの現在位置へワンショット移動。user_idは数値（Roblox UserId）。省略時はオーナー。standoffはスタッド（デフォルト3）" +
    "  follow_player: {op,user_id?(数値UserId),standoff?,repath_interval_ms?,lost_timeout_s?} — プレイヤーを継続追従（Roblox内ループ）。user_idは数値（Roblox UserId）。省略時はオーナー" +
    "  stop_following: {op} — 追従停止" +
    "\n\n--- build ---\n" +
    "制約ベースの建築。座標を自分で計算せず、意図+参照+制約で指定する。ops: apply_constraints。" +
    "  apply_constraints: {op,target:{mode(create|update),shape?,size[x,y,z],material?,color?,name?,transparency?,parent?,is_group?}," +
    "constraints:[{type:attach,ref,ref_face(top/bottom/front/back/left/right),self_face},{type:offset,vector[x,y,z],frame(world|ref),ref?},{type:non_overlap,allow?[]}]," +
    "refs?:{},validate?:[non_overlap,ground_contact,attach]}" +
    "\n\n--- spatial ---\n" +
    "空間照会（位置・近傍・相対関係）。ops: query。" +
    "  query(entities): {op:query,mode:entities,targets:[{type(npc|player|part),id?}],relative_to?:{type,id?}}" +
    "  query(nearby): {op:query,mode:nearby,center:{type,id?}|{pos[]},radius?,limit?,tag?}" +
    "\n\n--- effect ---\n" +
    "演出操作。ops: create/set/delete。" +
    "  create: {op,type(PointLight/SpotLight/Fire/Smoke/Sparkles/ParticleEmitter/Sound),parent,name,...props}" +
    "\n\nRoblox素材: Concrete,Wood,Brick,Glass,Marble,Metal,Granite,Slate,Sand,Grass,Ice,Snow,Neon等。" +
    "\n建築時は座標を自分で計算せず、buildカテゴリのapply_constraintsを使って制約（attach/offset/non_overlap）で指定すること。" +
    "\nプレイヤーへの単発移動はgo_to_player、継続追従（ついてきて等）はfollow_playerを使うこと。座標不要。" +
    "\n行動理由も含めること。",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["category", "ops", "reason"],
    properties: {
      category: {
        type: "string",
        description:
          "操作カテゴリ: part, terrain, npc, npc_motion, build, spatial, effect",
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
