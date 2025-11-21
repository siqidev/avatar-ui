import { config } from "../config";

export class TerminalEngine {
  private outputEl: HTMLElement;
  private avatarImg: HTMLImageElement;
  
  // 状態
  private queue: string[] = [];
  private isTyping: boolean = false;
  private lastCharTime: number = 0;
  private lastMouthTime: number = 0;
  private isMouthOpen: boolean = false;
  
  // 現在書き込み中の要素
  private currentTarget: HTMLElement | null = null;

  // ループ制御
  private rafId: number | null = null;

  // アセットパス
  private idleSrc: string;
  private talkSrc: string;

  // 音声コンテキスト (ユーザー操作後に初期化)
  private audioCtx: AudioContext | null = null;
  private gainNode: GainNode | null = null;

  // 現在書き込み中の要素
  constructor(outputEl: HTMLElement, avatarImg: HTMLImageElement) {
    this.outputEl = outputEl;
    this.avatarImg = avatarImg;
    
    // アバター画像のパスを保存
    this.idleSrc = avatarImg.dataset.idle ?? avatarImg.src;
    this.talkSrc = avatarImg.dataset.talk ?? this.idleSrc;

    this.start();
  }

  /**
   * 新しいメッセージ行を開始
   */
  public startNewMessage(className: string = "text-line") {
    const line = document.createElement("p");
    line.className = className;
    this.outputEl.appendChild(line);
    this.currentTarget = line;
    this.outputEl.scrollTop = this.outputEl.scrollHeight;
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
    this.isTyping = false;
    this.updateAvatar(false);
  }

  private start() {
    const loop = (timestamp: number) => {
      this.tick(timestamp);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private tick(timestamp: number) {
    const { typeSpeed, mouthInterval } = config.ui;

    // 1. タイピング処理
    if (this.queue.length > 0) {
      // 前回の文字表示から時間が経過していたら
      if (timestamp - this.lastCharTime >= typeSpeed) {
        const char = this.queue.shift();
        if (char && this.currentTarget) {
          this.currentTarget.textContent += char;
          this.outputEl.scrollTop = this.outputEl.scrollHeight;
          
          this.playBeep(); // 音を鳴らす
          this.isTyping = true;
          this.lastCharTime = timestamp;
        }
      }
    } else {
      this.isTyping = false;
    }

    // 2. アバターのアニメーション (口パク)
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

  private updateAvatar(isOpen: boolean) {
    const nextSrc = isOpen ? this.talkSrc : this.idleSrc;
    if (this.avatarImg.src !== nextSrc) { // チラつき防止
      this.avatarImg.src = nextSrc;
    }
  }

  // --- Sound Logic (簡易実装) ---
  
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

  private playBeep() {
    if (!this.audioCtx || !this.gainNode) return;
    if (this.audioCtx.state === "suspended") {
      this.audioCtx.resume().catch(() => {});
    }

    const { beepFrequency, beepDuration, soundVolume, beepVolumeEnd } = config.ui;

    // 音量を設定
    this.gainNode.gain.setValueAtTime(soundVolume, this.audioCtx.currentTime);
    
    const osc = this.audioCtx.createOscillator();
    osc.type = "square";
    osc.frequency.value = beepFrequency; 
    
    osc.connect(this.gainNode);
    osc.start();

    // 音を止める（プチッという音を防ぐため、少しフェードアウトさせても良いが、
    // レトロ感重視ならスパッと切っても良い。
    // ここではユーザー指定の beepVolumeEnd があるので、duration の最後に向けて音量を下げる実装例）
    if (beepVolumeEnd > 0) {
        this.gainNode.gain.exponentialRampToValueAtTime(beepVolumeEnd, this.audioCtx.currentTime + beepDuration);
    }

    osc.stop(this.audioCtx.currentTime + beepDuration);
  }
}
