# ADK のネイティブセッションサービスに本番機能を追加するセッションマネージャー

from typing import Dict, Optional, Set, Any, Union, Iterable
import asyncio
import logging
import time

logger = logging.getLogger(__name__)


class SessionManager:
    """ADK のセッションサービスをラップするセッションマネージャー
    
    本番環境に必要な機能を追加:
    - ADK の lastUpdateTime に基づくタイムアウト監視
    - ユーザー/アプリ横断のセッション列挙
    - ユーザーごとのセッション制限
    - 期限切れセッションの自動クリーンアップ
    - 削除時のオプション自動セッションメモリ
    - 状態管理と更新
    """
    
    _instance = None
    _initialized = False
    
    def __new__(cls, session_service=None, **kwargs):
        """シングルトンインスタンスを保証"""
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    def __init__(
        self,
        session_service=None,
        memory_service=None,
        session_timeout_seconds: int = 1200,  # 20分デフォルト
        cleanup_interval_seconds: int = 300,  # 5分
        max_sessions_per_user: Optional[int] = None,
        auto_cleanup: bool = True
    ):
        """セッションマネージャーを初期化
        
        Args:
            session_service: ADK セッションサービス（初回初期化時は必須）
            memory_service: 自動セッションメモリ用のオプション ADK メモリサービス
            session_timeout_seconds: セッションが期限切れとみなされるまでの時間
            cleanup_interval_seconds: クリーンアップサイクルの間隔
            max_sessions_per_user: ユーザーごとの最大同時セッション数（None = 無制限）
            auto_cleanup: 自動セッションクリーンアップタスクを有効化
        """
        if self._initialized:
            return
            
        if session_service is None:
            from google.adk.sessions import InMemorySessionService
            session_service = InMemorySessionService()
            
        self._session_service = session_service
        self._memory_service = memory_service
        self._timeout = session_timeout_seconds
        self._cleanup_interval = cleanup_interval_seconds
        self._max_per_user = max_sessions_per_user
        self._auto_cleanup = auto_cleanup
        
        # 最小限の追跡: キーとユーザーカウントのみ
        self._session_keys: Set[str] = set()  # "app_name:session_id" キー
        self._user_sessions: Dict[str, Set[str]] = {}  # user_id -> session_keys のセット
        self._processed_message_ids: Dict[str, Set[str]] = {}
        
        self._cleanup_task: Optional[asyncio.Task] = None
        self._initialized = True
        
        logger.info(
            f"Initialized SessionManager - "
            f"timeout: {session_timeout_seconds}s, "
            f"cleanup: {cleanup_interval_seconds}s, "
            f"max/user: {max_sessions_per_user or 'unlimited'}, "
            f"memory: {'enabled' if memory_service else 'disabled'}"
        )
    
    @classmethod
    def get_instance(cls, **kwargs):
        """シングルトンインスタンスを取得"""
        return cls(**kwargs)
    
    @classmethod
    def reset_instance(cls):
        """テスト用にシングルトンをリセット"""
        if cls._instance and hasattr(cls._instance, '_cleanup_task'):
            task = cls._instance._cleanup_task
            if task:
                try:
                    task.cancel()
                except RuntimeError:
                    pass
        cls._instance = None
        cls._initialized = False
    
    async def get_or_create_session(
        self,
        session_id: str,
        app_name: str,
        user_id: str,
        initial_state: Optional[Dict[str, Any]] = None
    ) -> Any:
        """既存のセッションを取得するか、新規作成
        
        ADK セッションオブジェクトを直接返す。
        """
        session_key = self._make_session_key(app_name, session_id)
        
        # 作成前にユーザー制限をチェック
        if session_key not in self._session_keys and self._max_per_user:
            user_count = len(self._user_sessions.get(user_id, set()))
            if user_count >= self._max_per_user:
                # このユーザーの最も古いセッションを削除
                await self._remove_oldest_user_session(user_id)
        
        # ADK 経由で取得または作成
        session = await self._session_service.get_session(
            session_id=session_id,
            app_name=app_name,
            user_id=user_id
        )
        
        if not session:
            session = await self._session_service.create_session(
                session_id=session_id,
                user_id=user_id,
                app_name=app_name,
                state=initial_state or {}
            )
            logger.info(f"Created new session: {session_key}")
        else:
            logger.debug(f"Retrieved existing session: {session_key}")
        
        # セッションキーを追跡
        self._track_session(session_key, user_id)
        
        # 必要に応じてクリーンアップを開始
        if self._auto_cleanup and not self._cleanup_task:
            self._start_cleanup_task()
        
        return session
    
    # ===== 状態管理メソッド =====
    
    async def update_session_state(
        self,
        session_id: str,
        app_name: str,
        user_id: str,
        state_updates: Dict[str, Any],
        merge: bool = True
    ) -> bool:
        """セッション状態を新しい値で更新
        
        Args:
            session_id: セッション識別子
            app_name: アプリケーション名
            user_id: ユーザー識別子
            state_updates: 更新する状態キー・値ペアの辞書
            merge: True の場合は既存状態とマージ、False の場合は完全に置換
            
        Returns:
            成功時 True、失敗時 False
        """
        try:
            session = await self._session_service.get_session(
                session_id=session_id,
                app_name=app_name,
                user_id=user_id
            )
            
            if not session:
                logger.debug(f"Session not found for update: {app_name}:{session_id} - this may be normal if session is still being created")
                return False
            
            if not state_updates:
                logger.debug(f"No state updates provided for session: {app_name}:{session_id}")
                return False
            
            # EventActions を使用して状態更新を適用
            from google.adk.events import Event, EventActions
            
            # 状態デルタを準備
            if merge:
                # 既存状態とマージ
                state_delta = state_updates
            else:
                # 状態全体を置換
                state_delta = state_updates
                # 注: 完全な置換には既存キーのクリアが必要な場合あり
                # ADK の動作に依存 - 明示的にクリアが必要な場合あり
            
            # 状態変更を含むイベントを作成
            actions = EventActions(state_delta=state_delta)
            event = Event(
                invocation_id=f"state_update_{int(time.time())}",
                author="system",
                actions=actions,
                timestamp=time.time()
            )
            
            # ADK のイベントシステムを通じて変更を適用
            await self._session_service.append_event(session, event)
            
            logger.info(f"Updated state for session {app_name}:{session_id}")
            logger.debug(f"State updates: {state_updates}")
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to update session state: {e}", exc_info=True)
            return False
    
    async def get_session_state(
        self,
        session_id: str,
        app_name: str,
        user_id: str
    ) -> Optional[Dict[str, Any]]:
        """現在のセッション状態を取得
        
        Args:
            session_id: セッション識別子
            app_name: アプリケーション名
            user_id: ユーザー識別子
            
        Returns:
            セッション状態辞書、セッションが見つからない場合は None
        """
        try:
            session = await self._session_service.get_session(
                session_id=session_id,
                app_name=app_name,
                user_id=user_id
            )
            
            if not session:
                logger.debug(f"Session not found when getting state: {app_name}:{session_id}")
                return None
            
            # 状態を辞書として返す
            if hasattr(session.state, 'to_dict'):
                return session.state.to_dict()
            else:
                # 辞書風状態オブジェクトのフォールバック
                return dict(session.state)
                
        except Exception as e:
            logger.error(f"Failed to get session state: {e}", exc_info=True)
            return None
    
    async def get_state_value(
        self,
        session_id: str,
        app_name: str,
        user_id: str,
        key: str,
        default: Any = None
    ) -> Any:
        """セッション状態から特定の値を取得
        
        Args:
            session_id: セッション識別子
            app_name: アプリケーション名
            user_id: ユーザー識別子
            key: 取得する状態キー
            default: キーが見つからない場合のデフォルト値
            
        Returns:
            キーの値またはデフォルト
        """
        try:
            session = await self._session_service.get_session(
                session_id=session_id,
                app_name=app_name,
                user_id=user_id
            )
            
            if not session:
                logger.debug(f"Session not found when getting state value: {app_name}:{session_id}")
                return default
            
            if hasattr(session.state, 'get'):
                return session.state.get(key, default)
            else:
                return session.state.get(key, default) if key in session.state else default
                
        except Exception as e:
            logger.error(f"Failed to get state value: {e}", exc_info=True)
            return default
    
    async def set_state_value(
        self,
        session_id: str,
        app_name: str,
        user_id: str,
        key: str,
        value: Any
    ) -> bool:
        """セッション状態に特定の値を設定
        
        Args:
            session_id: セッション識別子
            app_name: アプリケーション名
            user_id: ユーザー識別子
            key: 設定する状態キー
            value: 設定する値
            
        Returns:
            成功時 True、失敗時 False
        """
        return await self.update_session_state(
            session_id=session_id,
            app_name=app_name,
            user_id=user_id,
            state_updates={key: value}
        )
    
    async def remove_state_keys(
        self,
        session_id: str,
        app_name: str,
        user_id: str,
        keys: Union[str, list]
    ) -> bool:
        """セッション状態から特定のキーを削除
        
        Args:
            session_id: セッション識別子
            app_name: アプリケーション名
            user_id: ユーザー識別子
            keys: 削除する単一キーまたはキーのリスト
            
        Returns:
            成功時 True、失敗時 False
        """
        try:
            if isinstance(keys, str):
                keys = [keys]
            
            # 現在の状態を取得
            current_state = await self.get_session_state(session_id, app_name, user_id)
            if not current_state:
                return False
            
            # キー削除用の状態デルタを作成（削除のため None を設定）
            state_delta = {key: None for key in keys if key in current_state}
            
            if not state_delta:
                logger.info(f"No keys to remove from session {app_name}:{session_id}")
                return True
            
            return await self.update_session_state(
                session_id=session_id,
                app_name=app_name,
                user_id=user_id,
                state_updates=state_delta
            )
            
        except Exception as e:
            logger.error(f"Failed to remove state keys: {e}", exc_info=True)
            return False
    
    async def clear_session_state(
        self,
        session_id: str,
        app_name: str,
        user_id: str,
        preserve_prefixes: Optional[list] = None
    ) -> bool:
        """セッション状態をクリア、オプションで特定のプレフィックスを保持
        
        Args:
            session_id: セッション識別子
            app_name: アプリケーション名
            user_id: ユーザー識別子
            preserve_prefixes: 保持するプレフィックスのリスト（例: ['user:', 'app:']）
            
        Returns:
            成功時 True、失敗時 False
        """
        try:
            current_state = await self.get_session_state(session_id, app_name, user_id)
            if not current_state:
                return False
            
            preserve_prefixes = preserve_prefixes or []
            
            # 削除するキーを決定
            keys_to_remove = []
            for key in current_state.keys():
                should_preserve = any(key.startswith(prefix) for prefix in preserve_prefixes)
                if not should_preserve:
                    keys_to_remove.append(key)
            
            if keys_to_remove:
                return await self.remove_state_keys(
                    session_id=session_id,
                    app_name=app_name,
                    user_id=user_id,
                    keys=keys_to_remove
                )
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to clear session state: {e}", exc_info=True)
            return False
    
    async def initialize_session_state(
        self,
        session_id: str,
        app_name: str,
        user_id: str,
        initial_state: Dict[str, Any],
        overwrite_existing: bool = False
    ) -> bool:
        """セッション状態をデフォルト値で初期化
        
        Args:
            session_id: セッション識別子
            app_name: アプリケーション名
            user_id: ユーザー識別子
            initial_state: 初期状態値
            overwrite_existing: 既存の値を上書きするかどうか
            
        Returns:
            成功時 True、失敗時 False
        """
        try:
            if not overwrite_existing:
                # 既に存在しない値のみ設定
                current_state = await self.get_session_state(session_id, app_name, user_id)
                if current_state:
                    # 既に存在するキーをフィルタリング
                    filtered_state = {
                        key: value for key, value in initial_state.items()
                        if key not in current_state
                    }
                    if not filtered_state:
                        logger.info(f"No new state values to initialize for session {app_name}:{session_id}")
                        return True
                    initial_state = filtered_state
            
            return await self.update_session_state(
                session_id=session_id,
                app_name=app_name,
                user_id=user_id,
                state_updates=initial_state
            )
            
        except Exception as e:
            logger.error(f"Failed to initialize session state: {e}", exc_info=True)
            return False
    
    # ===== 一括状態操作 =====
    
    async def bulk_update_user_state(
        self,
        user_id: str,
        state_updates: Dict[str, Any],
        app_name_filter: Optional[str] = None
    ) -> Dict[str, bool]:
        """ユーザーのすべてのセッション全体の状態を更新
        
        Args:
            user_id: ユーザー識別子
            state_updates: 適用する状態更新
            app_name_filter: 特定アプリ用のオプションフィルタ
            
        Returns:
            session_key から成功ステータスへのマッピング辞書
        """
        results = {}
        
        if user_id not in self._user_sessions:
            logger.info(f"No sessions found for user {user_id}")
            return results
        
        for session_key in self._user_sessions[user_id]:
            app_name, session_id = session_key.split(':', 1)
            
            # 指定されていればフィルタを適用
            if app_name_filter and app_name != app_name_filter:
                continue
            
            success = await self.update_session_state(
                session_id=session_id,
                app_name=app_name,
                user_id=user_id,
                state_updates=state_updates
            )
            
            results[session_key] = success
        
        return results
    
    # ===== 既存メソッド =====
    
    def _track_session(self, session_key: str, user_id: str):
        """列挙用にセッションキーを追跡"""
        self._session_keys.add(session_key)

        if user_id not in self._user_sessions:
            self._user_sessions[user_id] = set()
        self._user_sessions[user_id].add(session_key)

    def _untrack_session(self, session_key: str, user_id: str):
        """セッション追跡を削除"""
        self._session_keys.discard(session_key)
        self._processed_message_ids.pop(session_key, None)

        if user_id in self._user_sessions:
            self._user_sessions[user_id].discard(session_key)
            if not self._user_sessions[user_id]:
                del self._user_sessions[user_id]

    def _make_session_key(self, app_name: str, session_id: str) -> str:
        return f"{app_name}:{session_id}"

    def get_processed_message_ids(self, app_name: str, session_id: str) -> Set[str]:
        session_key = self._make_session_key(app_name, session_id)
        return set(self._processed_message_ids.get(session_key, set()))

    def mark_messages_processed(
        self,
        app_name: str,
        session_id: str,
        message_ids: Iterable[str],
    ) -> None:
        session_key = self._make_session_key(app_name, session_id)
        processed_ids = self._processed_message_ids.setdefault(session_key, set())

        for message_id in message_ids:
            if message_id:
                processed_ids.add(message_id)
    
    async def _remove_oldest_user_session(self, user_id: str):
        """lastUpdateTime に基づいてユーザーの最も古いセッションを削除"""
        if user_id not in self._user_sessions:
            return
        
        oldest_session = None
        oldest_time = float('inf')
        
        # ADK の lastUpdateTime をチェックして最も古いセッションを検索
        for session_key in self._user_sessions[user_id]:
            app_name, session_id = session_key.split(':', 1)
            try:
                session = await self._session_service.get_session(
                    session_id=session_id,
                    app_name=app_name,
                    user_id=user_id
                )
                if session and hasattr(session, 'last_update_time'):
                    update_time = session.last_update_time
                    if update_time < oldest_time:
                        oldest_time = update_time
                        oldest_session = session
            except Exception as e:
                logger.error(f"Error checking session {session_key}: {e}")
        
        if oldest_session:
            session_key = self._make_session_key(oldest_session.app_name, oldest_session.id)
            await self._delete_session(oldest_session)
            logger.info(f"Removed oldest session for user {user_id}: {session_key}")
    
    async def _delete_session(self, session):
        """セッションオブジェクトを直接使用してセッションを削除
        
        Args:
            session: 削除する ADK セッションオブジェクト
        """
        if not session:
            logger.warning("Cannot delete None session")
            return
            
        session_key = f"{session.app_name}:{session.id}"
        
        # メモリサービスが利用可能な場合、削除前にセッションをメモリに追加
        logger.debug(f"Deleting session {session_key}, memory_service: {self._memory_service is not None}")
        if self._memory_service:
            try:
                await self._memory_service.add_session_to_memory(session)
                logger.debug(f"Added session {session_key} to memory before deletion")
            except Exception as e:
                logger.error(f"Failed to add session {session_key} to memory: {e}")
        
        try:
            await self._session_service.delete_session(
                session_id=session.id,
                app_name=session.app_name,
                user_id=session.user_id
            )
            logger.debug(f"Deleted session: {session_key}")
        except Exception as e:
            logger.error(f"Failed to delete session {session_key}: {e}")
        
        self._untrack_session(session_key, session.user_id)
    
    def _start_cleanup_task(self):
        """まだ実行されていなければクリーンアップタスクを開始"""
        try:
            loop = asyncio.get_running_loop()
            self._cleanup_task = loop.create_task(self._cleanup_loop())
            logger.debug(f"Started session cleanup task {id(self._cleanup_task)} for SessionManager {id(self)}")
        except RuntimeError:
            logger.debug("No event loop, cleanup will start later")
    
    async def _cleanup_loop(self):
        """期限切れセッションを定期的にクリーンアップ"""
        logger.debug(f"Cleanup loop started for SessionManager {id(self)}")
        while True:
            try:
                await asyncio.sleep(self._cleanup_interval)
                logger.debug(f"Running cleanup on SessionManager {id(self)}")
                await self._cleanup_expired_sessions()
            except asyncio.CancelledError:
                logger.info("Cleanup task cancelled")
                break
            except Exception as e:
                logger.error(f"Cleanup error: {e}", exc_info=True)
    
    async def _cleanup_expired_sessions(self):
        """lastUpdateTime に基づいて期限切れセッションを検索して削除"""
        current_time = time.time()
        expired_count = 0
        
        # すべての追跡セッションをチェック
        for session_key in list(self._session_keys):  # 反復中の変更を避けるためコピー
            app_name, session_id = session_key.split(':', 1)
            
            # このセッションの user_id を検索
            user_id = None
            for uid, keys in self._user_sessions.items():
                if session_key in keys:
                    user_id = uid
                    break
            
            if not user_id:
                continue
            
            try:
                session = await self._session_service.get_session(
                    session_id=session_id,
                    app_name=app_name,
                    user_id=user_id
                )
                
                if session and hasattr(session, 'last_update_time'):
                    age = current_time - session.last_update_time
                    if age > self._timeout:
                        # 削除前に保留ツールコールをチェック（HITL シナリオ）
                        pending_calls = session.state.get("pending_tool_calls", []) if session.state else []
                        has_pending = len(pending_calls) > 0
                        if has_pending:
                            logger.info(f"Preserving expired session {session_key} - has {len(pending_calls)} pending tool calls (HITL)")
                        else:
                            await self._delete_session(session)
                            expired_count += 1
                elif not session:
                    # セッションが存在しない、追跡のみ解除
                    self._untrack_session(session_key, user_id)
                    
            except Exception as e:
                logger.error(f"Error checking session {session_key}: {e}")
        
        if expired_count > 0:
            logger.info(f"Cleaned up {expired_count} expired sessions")
    
    def get_session_count(self) -> int:
        """追跡セッションの総数を取得"""
        return len(self._session_keys)
    
    def get_user_session_count(self, user_id: str) -> int:
        """ユーザーのセッション数を取得"""
        return len(self._user_sessions.get(user_id, set()))
    
    async def stop_cleanup_task(self):
        """クリーンアップタスクを停止"""
        if self._cleanup_task:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass
            self._cleanup_task = None