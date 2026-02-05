export type AutoScrollController = {
  /** 下端付近にいるときだけスクロールする */
  maybeScroll: () => void;
  /** 明示的に末尾へ。これでオートスクロールも再有効化される */
  forceScroll: () => void;
  /** 下端にピン留め状態かどうか */
  isPinned: () => boolean;
};

/**
 * ChatGPT 風の「最下部にいるときだけ追従」オートスクロール制御を生成する。
 * - ユーザーが少しでも上にスクロールしたら追従を停止
 * - 下端近くに戻ったら自動で追従を再開
 */
export function createAutoScrollController(
  container: HTMLElement,
  threshold = 32,
): AutoScrollController {
  let pinned = true;

  const isNearBottom = () =>
    container.scrollHeight - (container.scrollTop + container.clientHeight) <= threshold;

  const syncPinned = () => {
    pinned = isNearBottom();
  };

  container.addEventListener("scroll", () => {
    // スクロールイベントのたびに現在地を判定
    syncPinned();
  });

  const maybeScroll = () => {
    if (pinned) {
      container.scrollTop = container.scrollHeight;
    }
  };

  const forceScroll = () => {
    container.scrollTop = container.scrollHeight;
    pinned = true;
  };

  return {
    maybeScroll,
    forceScroll,
    isPinned: () => pinned,
  };
}
