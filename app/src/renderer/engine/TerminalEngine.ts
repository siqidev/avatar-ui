// タイピング表示・リップシンク・ビープ音をまとめて制御するレンダリングエンジン
import { config } from "../config";
import type { AutoScrollController } from "../autoScroll";

export type MarkdownRenderer = (md: string) => string;

export class TerminalEngine {
  private outputEl: HTMLElement;
  private avatarImg: HTMLImageElement;
  private renderMarkdown: MarkdownRenderer;
  private autoScroll: AutoScrollController;
  
  // 状態
  private queue: string[] = [];
  private isTyping: boolean = false;
  private lastCharTime: number = 0;
  private lastMouthTime: number = 0;
  private isMouthOpen: boolean = false;
  
  // 現在書き込み中の要素
  private currentTarget: HTMLElement | null = null;
  
  // 表示済みテキストのバッファ（Markdown 変換用）
  private displayedText: string = "";

  // ループ制御
  private rafId: number | null = null;

  // アセットパス
  private idleSrc: string;
  private talkSrc: string;

  // 音声コンテキスト (ユーザー操作後に初期化)
  private audioCtx: AudioContext | null = null;
  private gainNode: GainNode | null = null;

  constructor(
    outputEl: HTMLElement,
    avatarImg: HTMLImageElement,
    renderMarkdown: MarkdownRenderer,
    autoScroll: AutoScrollController
  ) {
    this.outputEl = outputEl;
    this.avatarImg = avatarImg;
    this.renderMarkdown = renderMarkdown;
    this.autoScroll = autoScroll;
    
    // アバター画像のパスを保存
    this.idleSrc = avatarImg.dataset.idle ?? avatarImg.src;
    this.talkSrc = avatarImg.dataset.talk ?? this.idleSrc;

    this.start();
  }

  /**
   * 新しいメッセージ行を開始
   */
  public startNewMessage(className: string = "text-line", initialText: string = "") {
    const line = document.createElement("div");
    line.className = className;
    // バッファを初期化し、初期テキストを Markdown 変換して表示
    this.displayedText = initialText;
    line.innerHTML = this.renderMarkdown(initialText);
    this.outputEl.appendChild(line);
    this.currentTarget = line;
    this.autoScroll.maybeScroll();
  }

  /**
   * テキストを表示キューに追加
   */
  public pushText(text: string) {
    if (!text) return;
    // ターゲットがなければデフォルト行を作成
    if (!this.currentTarget) {
      this.startNewMessage();
    }
    this.queue.push(...text.split(""));
    this.initAudio(); // 音声コンテキストの初期化を試みる
  }

  /**
   * 強制停止・リセット
   */
  public reset() {
    this.queue = [];
    this.displayedText = "";
    this.isTyping = false;
    this.updateAvatar(false);
  }

  // メインループ開始（requestAnimationFrame を使用）
  private start() {
    const loop = (timestamp: number) => {
      this.tick(timestamp);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  // 毎フレーム実行: タイピング・リップシンク処理
  private tick(timestamp: number) {
    const { typeSpeed, mouthInterval } = config.ui;

    // 1. タイピング処理
    if (this.queue.length > 0) {
      // 前回の文字表示から時間が経過していたら
      if (timestamp - this.lastCharTime >= typeSpeed) {
        const char = this.queue.shift();
        if (char && this.currentTarget) {
          // バッファに追加して Markdown 変換
          this.displayedText += char;
          this.currentTarget.innerHTML = this.renderMarkdown(this.displayedText);
          this.autoScroll.maybeScroll();
          
          this.playBeep(); // 音を鳴らす
          this.isTyping = true;
          this.lastCharTime = timestamp;
        }
      }
    } else {
      this.isTyping = false;
    }

    // 2. アバターのアニメーション (リップシンク)
    if (this.isTyping) {
      if (timestamp - this.lastMouthTime >= mouthInterval) {
        this.isMouthOpen = !this.isMouthOpen; // 反転
        this.updateAvatar(this.isMouthOpen);
        this.lastMouthTime = timestamp;
      }
    } else {
      // 喋っていない時は閉じる
      if (this.isMouthOpen) {
        this.updateAvatar(false);
        this.isMouthOpen = false;
      }
    }
  }

  // アバター画像の切り替え（口パクアニメーション）
  private updateAvatar(isOpen: boolean) {
    const nextSrc = isOpen ? this.talkSrc : this.idleSrc;
    if (this.avatarImg.src !== nextSrc) { // チラつき防止
      this.avatarImg.src = nextSrc;
    }
  }

  // --- 音声処理 ---
  
  // AudioContext の初期化（ユーザー操作後に呼び出す）
  private initAudio() {
    if (this.audioCtx) return;
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new Ctx();
      this.gainNode = this.audioCtx!.createGain();
      this.gainNode.connect(this.audioCtx!.destination);
    } catch (e) {
      console.warn("AudioContext init failed", e);
    }
  }

  // タイプ音を再生（1文字ごとに呼ばれる）
  private playBeep() {
    if (!this.audioCtx || !this.gainNode) return;
    if (this.audioCtx.state === "suspended") {
      this.audioCtx.resume().catch(() => {});
    }

    const { beepFrequency, beepDuration, soundVolume, beepVolumeEnd } = config.ui;

    // 音量を設定
    this.gainNode.gain.setValueAtTime(soundVolume, this.audioCtx.currentTime);
    
    const osc = this.audioCtx.createOscillator();
    osc.type = "square"; // 矩形波でタイプ音を表現
    osc.frequency.value = beepFrequency; 
    
    osc.connect(this.gainNode);
    osc.start();

    // 音を止める（beepVolumeEnd を使って終端だけ音量を絞る）
    if (beepVolumeEnd > 0) {
        this.gainNode.gain.exponentialRampToValueAtTime(beepVolumeEnd, this.audioCtx.currentTime + beepDuration);
    }

    osc.stop(this.audioCtx.currentTime + beepDuration);
  }
}
