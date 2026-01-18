#!/usr/bin/env python3
"""
SPECTRA Console - Cyberpunk GUI
"""
import os
import sys
import requests
from dotenv import load_dotenv
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QTextEdit, QLineEdit, QPushButton, QLabel, QFrame, QSplitter
)
from PyQt6.QtCore import Qt, QThread, pyqtSignal, QTimer
from PyQt6.QtGui import QFont, QFontDatabase, QPainter, QColor, QPen, QLinearGradient

load_dotenv()

CORE_URL = "http://localhost:8000/v1/think"
SESSION_ID = "master-session"
API_KEY = os.getenv("SPECTRA_API_KEY", "")


# ===== スタイルシート =====
STYLESHEET = """
QMainWindow {
    background-color: #0a0a0a;
}

QWidget {
    background-color: transparent;
    color: #00ff88;
    font-family: "Cascadia Code", "JetBrains Mono", "Consolas", "Meiryo", "Yu Gothic UI", sans-serif;
}

QFrame#mainFrame {
    background-color: #0d1117;
    border: 2px solid #00ff88;
    border-radius: 8px;
}

QFrame#chatFrame {
    background-color: #0a0e14;
    border: 1px solid #1a3a2a;
    border-radius: 6px;
}

QFrame#avatarFrame {
    background-color: #0a0e14;
    border: 1px solid #1a3a2a;
    border-radius: 6px;
    min-width: 180px;
    max-width: 180px;
}

QTextEdit {
    background-color: #0a0e14;
    color: #00ff88;
    border: none;
    padding: 12px;
    font-size: 13px;
    line-height: 1.6;
    selection-background-color: #00ff8840;
}

QLineEdit {
    background-color: #0d1117;
    color: #00ff88;
    border: 2px solid #1a3a2a;
    border-radius: 6px;
    padding: 12px 16px;
    font-size: 14px;
    selection-background-color: #00ff8840;
}

QLineEdit:focus {
    border-color: #00ff88;
    background-color: #0a0e14;
}

QPushButton {
    background-color: #00ff88;
    color: #0a0a0a;
    border: none;
    border-radius: 6px;
    padding: 12px 24px;
    font-size: 14px;
    font-weight: bold;
}

QPushButton:hover {
    background-color: #00cc6a;
}

QPushButton:pressed {
    background-color: #009950;
}

QPushButton:disabled {
    background-color: #1a3a2a;
    color: #0a0a0a;
}

QLabel#titleLabel {
    color: #00ff88;
    font-size: 18px;
    font-weight: bold;
    padding: 8px;
}

QLabel#statusLabel {
    color: #00aa55;
    font-size: 11px;
    padding: 4px 8px;
}

QLabel#avatarLabel {
    color: #00ff88;
    font-size: 12px;
    padding: 8px;
}

QScrollBar:vertical {
    background: #0a0e14;
    width: 8px;
    border-radius: 4px;
}

QScrollBar::handle:vertical {
    background: #1a3a2a;
    border-radius: 4px;
    min-height: 30px;
}

QScrollBar::handle:vertical:hover {
    background: #00ff88;
}

QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {
    height: 0;
}
"""


class ApiWorker(QThread):
    """バックグラウンドAPI呼び出し"""
    finished = pyqtSignal(str)
    error = pyqtSignal(str)

    def __init__(self, prompt: str):
        super().__init__()
        self.prompt = prompt

    def run(self):
        try:
            headers = {}
            if API_KEY:
                headers["x-api-key"] = API_KEY
            response = requests.post(
                CORE_URL,
                json={"prompt": self.prompt, "session_id": SESSION_ID},
                headers=headers,
                timeout=60
            )
            if response.ok:
                data = response.json()
                self.finished.emit(data.get("response", "（応答なし）"))
            else:
                self.error.emit(f"HTTP {response.status_code}")
        except Exception as e:
            self.error.emit(str(e))


class AvatarWidget(QFrame):
    """アバター表示エリア"""
    def __init__(self):
        super().__init__()
        self.setObjectName("avatarFrame")
        self.speaking = False
        
        layout = QVBoxLayout(self)
        layout.setContentsMargins(8, 8, 8, 8)
        layout.setSpacing(8)
        
        # アバターエリア（将来的に画像を追加）
        self.avatar_area = QLabel()
        self.avatar_area.setFixedSize(160, 160)
        self.avatar_area.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.avatar_area.setStyleSheet("""
            background-color: #0d1a14;
            border: 1px solid #00ff88;
            border-radius: 4px;
            color: #00ff88;
            font-size: 48px;
        """)
        self.avatar_area.setText("◉")
        layout.addWidget(self.avatar_area, alignment=Qt.AlignmentFlag.AlignCenter)
        
        # 名前
        name_label = QLabel("SPECTRA")
        name_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        name_label.setStyleSheet("color: #00ff88; font-size: 14px; font-weight: bold;")
        layout.addWidget(name_label)
        
        # ステータス
        self.status_label = QLabel("● ONLINE")
        self.status_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.status_label.setStyleSheet("color: #00aa55; font-size: 11px;")
        layout.addWidget(self.status_label)
        
        layout.addStretch()

    def set_speaking(self, speaking: bool):
        self.speaking = speaking
        if speaking:
            self.status_label.setText("◉ SPEAKING...")
            self.status_label.setStyleSheet("color: #00ff88; font-size: 11px;")
            self.avatar_area.setStyleSheet("""
                background-color: #0d1a14;
                border: 2px solid #00ff88;
                border-radius: 4px;
                color: #00ff88;
                font-size: 48px;
            """)
        else:
            self.status_label.setText("● ONLINE")
            self.status_label.setStyleSheet("color: #00aa55; font-size: 11px;")
            self.avatar_area.setStyleSheet("""
                background-color: #0d1a14;
                border: 1px solid #00ff88;
                border-radius: 4px;
                color: #00ff88;
                font-size: 48px;
            """)


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("SPECTRA Console")
        self.setMinimumSize(900, 600)
        self.resize(1000, 700)
        self.worker = None

        self.setStyleSheet(STYLESHEET)
        self._setup_ui()
        
        # 起動メッセージ
        self._append_system("Spectra Communicator Online")
        self._append_system("AI Chat Ready")

    def _setup_ui(self):
        central = QWidget()
        self.setCentralWidget(central)
        
        main_layout = QVBoxLayout(central)
        main_layout.setContentsMargins(16, 16, 16, 16)
        main_layout.setSpacing(12)
        
        # ヘッダー
        header = QHBoxLayout()
        
        title = QLabel("SPECTRA CONSOLE")
        title.setObjectName("titleLabel")
        header.addWidget(title)
        
        header.addStretch()
        
        status = QLabel("◉ CONNECTED")
        status.setObjectName("statusLabel")
        header.addWidget(status)
        
        main_layout.addLayout(header)
        
        # メインフレーム
        main_frame = QFrame()
        main_frame.setObjectName("mainFrame")
        frame_layout = QHBoxLayout(main_frame)
        frame_layout.setContentsMargins(12, 12, 12, 12)
        frame_layout.setSpacing(12)
        
        # 左側: チャットエリア
        chat_container = QVBoxLayout()
        chat_container.setSpacing(8)
        
        # ターミナル出力ラベル
        terminal_label = QLabel("TERMINAL OUTPUT")
        terminal_label.setStyleSheet("color: #00aa55; font-size: 10px; letter-spacing: 2px;")
        chat_container.addWidget(terminal_label)
        
        # チャット表示
        chat_frame = QFrame()
        chat_frame.setObjectName("chatFrame")
        chat_inner = QVBoxLayout(chat_frame)
        chat_inner.setContentsMargins(0, 0, 0, 0)
        
        self.chat_display = QTextEdit()
        self.chat_display.setReadOnly(True)
        chat_inner.addWidget(self.chat_display)
        
        chat_container.addWidget(chat_frame, stretch=1)
        frame_layout.addLayout(chat_container, stretch=1)
        
        # 右側: アバター
        self.avatar = AvatarWidget()
        frame_layout.addWidget(self.avatar)
        
        main_layout.addWidget(main_frame, stretch=1)
        
        # 入力エリア
        input_layout = QHBoxLayout()
        input_layout.setSpacing(12)
        
        prompt_label = QLabel(">")
        prompt_label.setStyleSheet("color: #00ff88; font-size: 18px; font-weight: bold;")
        input_layout.addWidget(prompt_label)
        
        self.input_field = QLineEdit()
        self.input_field.setPlaceholderText("メッセージを入力...")
        self.input_field.returnPressed.connect(self._send_message)
        input_layout.addWidget(self.input_field, stretch=1)
        
        self.send_button = QPushButton("SEND")
        self.send_button.clicked.connect(self._send_message)
        input_layout.addWidget(self.send_button)
        
        main_layout.addLayout(input_layout)

    def _append_system(self, text: str):
        self.chat_display.append(
            f'<p style="color: #00aa55; margin: 4px 0;">'
            f'<span style="color: #006633;">&gt;</span> {text}</p>'
        )

    def _append_user(self, text: str):
        self.chat_display.append(
            f'<p style="color: #00ffcc; margin: 8px 0 4px 0;">'
            f'<span style="color: #00ff88; font-weight: bold;">USER&gt;</span> {text}</p>'
        )

    def _append_spectra(self, text: str):
        self.chat_display.append(
            f'<p style="color: #ffffff; margin: 4px 0 8px 0;">'
            f'<span style="color: #00ff88; font-weight: bold;">Spectra&gt;</span> {text}</p>'
        )

    def _append_error(self, text: str):
        self.chat_display.append(
            f'<p style="color: #ff4444; margin: 4px 0;">'
            f'<span style="font-weight: bold;">[ERROR]</span> {text}</p>'
        )

    def _send_message(self):
        text = self.input_field.text().strip()
        if not text:
            return

        self._append_user(text)
        self.input_field.clear()
        self.input_field.setEnabled(False)
        self.send_button.setEnabled(False)
        self.avatar.set_speaking(True)

        self.worker = ApiWorker(text)
        self.worker.finished.connect(self._on_response)
        self.worker.error.connect(self._on_error)
        self.worker.start()

    def _on_response(self, response: str):
        self._append_spectra(response)
        self._enable_input()
        self.avatar.set_speaking(False)

    def _on_error(self, error: str):
        self._append_error(error)
        self._enable_input()
        self.avatar.set_speaking(False)

    def _enable_input(self):
        self.input_field.setEnabled(True)
        self.send_button.setEnabled(True)
        self.input_field.setFocus()


def main():
    app = QApplication(sys.argv)
    
    # 日本語フォントを明示的に設定
    font = QFont()
    font.setFamilies(["Cascadia Code", "JetBrains Mono", "Consolas", "Meiryo", "Yu Gothic UI", "Noto Sans CJK JP"])
    font.setPointSize(11)
    app.setFont(font)
    
    window = MainWindow()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
