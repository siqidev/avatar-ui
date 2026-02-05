# ADK ミドルウェア用 FastAPI エンドポイント

from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from ag_ui.core import RunAgentInput
from ag_ui.encoder import EventEncoder
from .adk_agent import ADKAgent

import logging
logger = logging.getLogger(__name__)


def add_adk_fastapi_endpoint(app: FastAPI, agent: ADKAgent, path: str = "/"):
    """FastAPI アプリに ADK ミドルウェアエンドポイントを追加
    
    Args:
        app: FastAPI アプリケーションインスタンス
        agent: 設定済み ADKAgent インスタンス
        path: API エンドポイントパス
    """
    
    @app.post(path)
    async def adk_endpoint(input_data: RunAgentInput, request: Request):
        """ADK ミドルウェアエンドポイント"""
        
        # リクエストから accept ヘッダーを取得
        accept_header = request.headers.get("accept")
        agent_id = path.lstrip('/')
        
        
        # SSE イベントを正しくフォーマットするエンコーダーを作成
        encoder = EventEncoder(accept=accept_header)
        
        async def event_generator():
            """ADK エージェントからイベントを生成"""
            try:
                async for event in agent.run(input_data):
                    try:
                        encoded = encoder.encode(event)
                        logger.debug(f"HTTP Response: {encoded}")
                        yield encoded
                    except Exception as encoding_error:
                        # エンコーディングエラーの処理
                        logger.error(f"❌ Event encoding error: {encoding_error}", exc_info=True)
                        # エンコード失敗用の RunErrorEvent を作成
                        from ag_ui.core import RunErrorEvent, EventType
                        error_event = RunErrorEvent(
                            type=EventType.RUN_ERROR,
                            message=f"Event encoding failed: {str(encoding_error)}",
                            code="ENCODING_ERROR"
                        )
                        try:
                            error_encoded = encoder.encode(error_event)
                            yield error_encoded
                        except Exception:
                            # エラーイベントすらエンコードできない場合は基本的な SSE エラーを返す
                            logger.error("Failed to encode error event, yielding basic SSE error")
                            yield "event: error\ndata: {\"error\": \"Event encoding failed\"}\n\n"
                        break  # エンコーディングエラー後はストリームを停止
            except Exception as agent_error:
                # ADKAgent.run() 自体からのエラーを処理
                logger.error(f"❌ ADKAgent error: {agent_error}", exc_info=True)
                # ADKAgent は RunErrorEvent を出すべきだが、非同期ジェネレータ自体で
                # 問題が発生した場合はここで処理する必要がある
                try:
                    from ag_ui.core import RunErrorEvent, EventType
                    error_event = RunErrorEvent(
                        type=EventType.RUN_ERROR,
                        message=f"Agent execution failed: {str(agent_error)}",
                        code="AGENT_ERROR"
                    )
                    error_encoded = encoder.encode(error_event)
                    yield error_encoded
                except Exception:
                    # エラーイベントをエンコードできない場合は基本的な SSE エラーを返す
                    logger.error("Failed to encode agent error event, yielding basic SSE error")
                    yield "event: error\ndata: {\"error\": \"Agent execution failed\"}\n\n"
        
        return StreamingResponse(event_generator(), media_type=encoder.get_content_type())


def create_adk_app(agent: ADKAgent, path: str = "/") -> FastAPI:
    """ADK ミドルウェアエンドポイント付きの FastAPI アプリを作成
    
    Args:
        agent: 設定済み ADKAgent インスタンス
        path: API エンドポイントパス
        
    Returns:
        FastAPI アプリケーションインスタンス
    """
    app = FastAPI(title="ADK Middleware for AG-UI Protocol")
    add_adk_fastapi_endpoint(app, agent, path)
    return app