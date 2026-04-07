"""
CEF (Chromium Embedded Framework) remote debugging communication layer.
CEF（Chromium 嵌入式框架）远程调试通信层。

Provides raw WebSocket client and CDP (Chrome DevTools Protocol) helpers
for injecting JavaScript into Steam's CEF pages.
提供无依赖的 WebSocket 客户端与 CDP 辅助函数，用于向 Steam 的 CEF 页面注入 JavaScript。
"""

import json
import http.client
import struct
import base64
import os
import socket
import time
import logging
from urllib.parse import unquote

log = logging.getLogger("gamemode-news-hook")


def ws_connect(host, port, path):
    """Establish a raw WebSocket connection (no external dependencies).
    建立原始 WebSocket 连接（无第三方依赖）。"""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(10)
    s.connect((host, port))
    key = base64.b64encode(os.urandom(16)).decode()
    s.sendall((
        f"GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\n"
        f"Upgrade: websocket\r\nConnection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
    ).encode())
    s.recv(4096)
    return s


def ws_send(s, data):
    """Send a masked WebSocket text frame (client → server).
    发送一帧带掩码的 WebSocket 文本（客户端 → 服务端）。"""
    payload = data.encode()
    frame = bytearray([0x81])
    length = len(payload)
    if length < 126:
        frame.append(0x80 | length)
    elif length < 65536:
        frame.append(0x80 | 126)
        frame.extend(struct.pack(">H", length))
    else:
        frame.append(0x80 | 127)
        frame.extend(struct.pack(">Q", length))
    mask = os.urandom(4)
    frame.extend(mask)
    for i, b in enumerate(payload):
        frame.append(b ^ mask[i % 4])
    s.sendall(frame)


def ws_recv(s, timeout=15):
    """Receive one WebSocket text frame from the server.
    从服务端接收一帧 WebSocket 文本数据。"""
    s.settimeout(timeout)
    hdr = s.recv(2)
    length = hdr[1] & 0x7F
    if length == 126:
        length = struct.unpack(">H", s.recv(2))[0]
    elif length == 127:
        length = struct.unpack(">Q", s.recv(8))[0]
    buf = b""
    while len(buf) < length:
        buf += s.recv(length - len(buf))
    return buf.decode()


def evaluate(ws, expression, retries=1, await_promise=False):
    """Evaluate JS expression via CDP Runtime.evaluate, with optional retry.
    通过 CDP Runtime.evaluate 执行 JS 表达式，支持失败重试。"""
    for attempt in range(1 + retries):
        try:
            params = {"expression": expression, "returnByValue": True}
            if await_promise:
                params["awaitPromise"] = True
            ws_send(ws, json.dumps({
                "id": 1, "method": "Runtime.evaluate",
                "params": params
            }))
            r = json.loads(ws_recv(ws)).get("result", {}).get("result", {})
            if r.get("subtype") == "error":
                log.error("JS error: %s", r.get("description", "?"))
                return None
            return r.get("value")
        except Exception as e:
            if attempt < retries:
                log.warning("evaluate failed (attempt %d), retrying: %s", attempt + 1, e)
                time.sleep(1)
            else:
                log.error("evaluate failed after %d attempts: %s", attempt + 1, e)
                raise


def _page_ws_path(p, host="localhost", port=8080):
    """WebSocket path for a /json page entry (for CDP connect).
    /json 条目的 WebSocket 路径（供 CDP 连接）。"""
    ws_url = p.get("webSocketDebuggerUrl")
    if not ws_url:
        return None
    prefix = f"ws://{host}:{port}"
    if ws_url.startswith(prefix):
        return ws_url[len(prefix):]
    return ws_url.split("/devtools", 1)[-1]


def _is_gamepad_main_shell_url(url):
    """True for new BPM main CEF page; does not depend on localized window title.
    新手柄大屏主壳（与界面语言无关）。弹层为 browserviewpopup=1，需排除。"""
    if not url or "browserviewpopup=1" in url:
        return False
    # e.g. useragent=Valve%20Steam%20Gamepad (verified on remote /json)
    low = unquote(url.replace("+", " ")).lower()
    return "steam gamepad" in low


def _steamloopback_pages(pages, host, port):
    """Entries whose URL is on steamloopback.host (SharedJSContext lives here; BPM uses about:blank).
    steamloopback.host 上的页（SharedJSContext）；大屏主壳为 about:blank，与此不重叠。"""
    out = []
    for p in pages:
        if p.get("type") in ("service_worker", "background_page"):
            continue
        url = (p.get("url") or "").lower()
        if "steamloopback.host" in url:
            path = _page_ws_path(p, host, port)
            if path:
                out.append((p, path))
    return out


def _find_shared_js_context_page(pages, host="localhost", port=8080):
    """SharedJSContext for XHR hook: prefer steamloopback.host URL, then title.
    优先 steamloopback.host（与界面语言无关），多开时用标题消歧，最后标题回退。"""
    loop = _steamloopback_pages(pages, host, port)
    if len(loop) == 1:
        log.debug("SharedJSContext matched by unique steamloopback.host page")
        return loop[0][1]
    if len(loop) > 1:
        for p, path in loop:
            if "SharedJSContext" in (p.get("title") or ""):
                log.debug("SharedJSContext matched among steamloopback pages (title)")
                return path
        log.warning("Multiple steamloopback CEF pages; using first")
        return loop[0][1]
    path = _find_page(pages, "SharedJSContext", host, port)
    if path:
        log.debug("SharedJSContext matched by title fallback")
    return path


def _find_page(pages, keyword, host="localhost", port=8080):
    """Find debugger WebSocket path by matching page title keyword.
    根据页面标题关键字查找调试器 WebSocket 路径。"""
    for p in pages:
        if keyword in p.get("title", ""):
            path = _page_ws_path(p, host, port)
            if path:
                return path
    return None


def _find_big_picture_page(pages, host="localhost", port=8080):
    """Big Picture / gamepad UI: URL heuristic first, then title (legacy / old clients).
    大屏页：优先 URL（与语言无关），再回退标题。"""
    for p in pages:
        if p.get("type") in ("service_worker", "background_page"):
            continue
        url = p.get("url") or ""
        if _is_gamepad_main_shell_url(url):
            path = _page_ws_path(p, host, port)
            if path:
                log.debug("Big Picture matched by URL (Steam Gamepad shell)")
                return path
    bp = _find_page(pages, "大屏幕", host, port) or _find_page(pages, "Big Picture", host, port)
    if bp:
        log.debug("Big Picture matched by title fallback")
    return bp


def get_pages(host="localhost", port=8080):
    """Fetch the CEF debug page list. Returns (sjc_path, bp_path) or raises.
    获取 CEF 调试页列表；返回 (SharedJSContext 路径, Big Picture 路径)，失败则抛错。"""
    conn = http.client.HTTPConnection(host, port, timeout=5)
    conn.request("GET", "/json")
    pages = json.loads(conn.getresponse().read())
    sjc = _find_shared_js_context_page(pages, host, port)
    bp = _find_big_picture_page(pages, host, port)
    return sjc, bp


def wait_for_pages(timeout=120, host="localhost", port=8080):
    """Poll CEF debug port until SharedJSContext and BigPicture are ready.
    轮询 CEF 调试端口，直到 SharedJSContext 与 Big Picture 页面就绪。"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            sjc, bp = get_pages(host, port)
            if sjc and bp:
                log.info("CEF ready")
                return sjc, bp
        except Exception:
            pass
        time.sleep(2)
    return None, None


def connect(host, port, path):
    """Connect to a CEF page via WebSocket with error handling.
    通过 WebSocket 连接指定 CEF 页面，含错误处理。"""
    try:
        return ws_connect(host, port, path)
    except Exception as e:
        log.error("WebSocket connection to %s failed: %s", path, e)
        raise
