# AG-UI プロトコル用 ADK ミドルウェア
#
# Google ADK エージェントを AG-UI プロトコルで使用するためのミドルウェア

from __future__ import annotations

import logging
import os
from typing import Dict, Iterable

from .adk_agent import ADKAgent
from .event_translator import EventTranslator
from .session_manager import SessionManager
from .endpoint import add_adk_fastapi_endpoint, create_adk_app

__all__ = ['ADKAgent', 'add_adk_fastapi_endpoint', 'create_adk_app', 'EventTranslator', 'SessionManager']

__version__ = "0.1.0"


def _configure_logging_from_env() -> None:
    """環境変数に基づいてコンポーネントごとのロガーを設定"""

    root_level = os.getenv('LOG_ROOT_LEVEL')
    if root_level:
        try:
            level = getattr(logging, root_level.upper())
        except AttributeError:
            logging.getLogger(__name__).warning(
                "Invalid LOG_ROOT_LEVEL value '%s'", root_level
            )
        else:
            logging.basicConfig(level=level, force=True)

    component_levels: Dict[str, Iterable[str]] = {
        'LOG_ADK_AGENT': ('ag_ui_adk.adk_agent',),
        'LOG_EVENT_TRANSLATOR': (
            'ag_ui_adk.event_translator',
            'event_translator',
        ),
        'LOG_ENDPOINT': ('ag_ui_adk.endpoint', 'endpoint'),
        'LOG_SESSION_MANAGER': (
            'ag_ui_adk.session_manager',
            'session_manager',
        ),
    }

    for env_var, logger_names in component_levels.items():
        level_name = os.getenv(env_var)
        if not level_name:
            continue

        try:
            level = getattr(logging, level_name.upper())
        except AttributeError:
            logging.getLogger(__name__).warning(
                "Invalid value '%s' for %s", level_name, env_var
            )
            continue

        for logger_name in logger_names:
            logging.getLogger(logger_name).setLevel(level)


_configure_logging_from_env()
