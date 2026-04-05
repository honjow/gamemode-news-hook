"""
CEF (Chromium Embedded Framework) remote debugging communication layer.

Provides raw WebSocket client and CDP (Chrome DevTools Protocol) helpers
for injecting JavaScript into Steam's CEF pages.
"""

import json
import http.client
import struct
import base64
import os
import socket
import time
import logging

log = logging.getLogger("gamemode-news-hook")


def ws_connect(host, port, path):
    """Establish a raw WebSocket connection (no external dependencies)."""
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


def evaluate(ws, expression, retries=1):
    """Evaluate JS expression via CDP Runtime.evaluate, with optional retry."""
    for attempt in range(1 + retries):
        try:
            ws_send(ws, json.dumps({
                "id": 1, "method": "Runtime.evaluate",
                "params": {"expression": expression, "returnByValue": True}
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


def _find_page(pages, keyword, host="localhost", port=8080):
    for p in pages:
        if keyword in p.get("title", ""):
            ws_url = p["webSocketDebuggerUrl"]
            prefix = f"ws://{host}:{port}"
            if ws_url.startswith(prefix):
                return ws_url[len(prefix):]
            return ws_url.split("/devtools", 1)[-1]
    return None


def get_pages(host="localhost", port=8080):
    """Fetch the CEF debug page list. Returns (sjc_path, bp_path) or raises."""
    conn = http.client.HTTPConnection(host, port, timeout=5)
    conn.request("GET", "/json")
    pages = json.loads(conn.getresponse().read())
    sjc = _find_page(pages, "SharedJSContext", host, port)
    bp = _find_page(pages, "大屏幕", host, port) or _find_page(pages, "Big Picture", host, port)
    return sjc, bp


def wait_for_pages(timeout=120, host="localhost", port=8080):
    """Poll CEF debug port until SharedJSContext and BigPicture are ready."""
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
    """Connect to a CEF page via WebSocket with error handling."""
    try:
        return ws_connect(host, port, path)
    except Exception as e:
        log.error("WebSocket connection to %s failed: %s", path, e)
        raise
