import type { Tool } from "openai/resources/responses/responses"

// fs_listツール — Avatar Space内のディレクトリ一覧
export const fsListToolDef: Tool = {
  type: "function",
  name: "fs_list",
  description:
    "Avatar Space内のディレクトリの内容を一覧表示する。" +
    "ファイル名、種類（file/directory）、サイズ、更新日時を返す。",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["path"],
    properties: {
      path: {
        type: "string",
        description: "一覧表示するディレクトリのパス（Avatar Spaceルートからの相対パス。ルートは '.'）",
      },
    },
  },
  strict: true,
}

// fs_readツール — Avatar Space内のファイル読み取り
export const fsReadToolDef: Tool = {
  type: "function",
  name: "fs_read",
  description:
    "Avatar Space内のファイルの内容を読み取る。" +
    "offset/limitで行範囲を指定可能（大きなファイル用）。",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["path"],
    properties: {
      path: {
        type: "string",
        description: "読み取るファイルのパス（Avatar Spaceルートからの相対パス）",
      },
      offset: {
        type: "number",
        description: "開始行番号（0始まり、省略時は先頭から）",
      },
      limit: {
        type: "number",
        description: "読み取る行数（省略時は全行）",
      },
    },
  },
  strict: true,
}

// fs_writeツール — Avatar Space内のファイル書き込み
export const fsWriteToolDef: Tool = {
  type: "function",
  name: "fs_write",
  description:
    "Avatar Space内にファイルを作成または上書きする。" +
    "親ディレクトリは自動作成される。",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["path", "content"],
    properties: {
      path: {
        type: "string",
        description: "書き込むファイルのパス（Avatar Spaceルートからの相対パス）",
      },
      content: {
        type: "string",
        description: "ファイルの内容",
      },
    },
  },
  strict: true,
}

// fs_mutateツール — Avatar Space内のファイル構造変更（削除・リネーム・mkdir）
export const fsMutateToolDef: Tool = {
  type: "function",
  name: "fs_mutate",
  description:
    "Avatar Space内のファイルやディレクトリの構造を変更する。" +
    "操作: delete（削除）、rename（リネーム）、mkdir（ディレクトリ作成）。",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["op", "path"],
    properties: {
      op: {
        type: "string",
        enum: ["delete", "rename", "mkdir"],
        description: "操作の種類",
      },
      path: {
        type: "string",
        description: "対象のパス（Avatar Spaceルートからの相対パス）",
      },
      newPath: {
        type: "string",
        description: "リネーム先のパス（op='rename'の場合に必須）",
      },
    },
  },
  strict: true,
}
