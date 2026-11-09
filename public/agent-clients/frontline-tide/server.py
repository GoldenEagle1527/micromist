#!/usr/bin/env python3
"""Official Frontline Tide client. No solver.

One process joins the room WebSocket and serves HTTP on 127.0.0.1.
You choose every action with curl. This process does not play.

  python3 server.py --origin https://HOST --seat player create_room
  python3 server.py --origin https://HOST --seat player join_room -c CODE
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import random
import socket
import ssl
import string
import struct
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


class MiniWS:
    """Tiny client for one text-frame socket. No third-party package."""

    def __init__(self, url: str) -> None:
        parsed = urlparse(url)
        host = parsed.hostname or "localhost"
        port = parsed.port or (443 if parsed.scheme == "wss" else 80)
        raw = socket.create_connection((host, port), timeout=20)
        if parsed.scheme == "wss":
            raw = ssl.create_default_context().wrap_socket(raw, server_hostname=host)
        key = base64.b64encode(os.urandom(16)).decode()
        path = parsed.path or "/"
        if parsed.query:
            path += "?" + parsed.query
        raw.sendall(
            (
                f"GET {path} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\n"
                f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
            ).encode()
        )
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = raw.recv(4096)
            if not chunk:
                raise SystemExit("websocket handshake failed")
            buf += chunk
        accept = base64.b64encode(
            hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()
        )
        if accept not in buf.split(b"\r\n\r\n", 1)[0]:
            raise SystemExit("websocket accept mismatch")
        self.sock = raw
        self.buf = buf.split(b"\r\n\r\n", 1)[1]

    def send(self, text: str) -> None:
        data = text.encode()
        mask = os.urandom(4)
        frame = bytearray([0x81])
        n = len(data)
        if n < 126:
            frame.append(0x80 | n)
        elif n < 65536:
            frame.append(0x80 | 126)
            frame += struct.pack("!H", n)
        else:
            frame.append(0x80 | 127)
            frame += struct.pack("!Q", n)
        frame += mask
        frame += bytes(b ^ mask[i % 4] for i, b in enumerate(data))
        self.sock.sendall(frame)

    def messages(self):
        buf = self.buf
        while True:
            while len(buf) < 2:
                chunk = self.sock.recv(4096)
                if not chunk:
                    return
                buf += chunk
            b1 = buf[1]
            opcode = buf[0] & 0x0F
            buf = buf[2:]
            ln = b1 & 0x7F
            if ln == 126:
                while len(buf) < 2:
                    buf += self.sock.recv(4096)
                ln = struct.unpack("!H", buf[:2])[0]
                buf = buf[2:]
            elif ln == 127:
                while len(buf) < 8:
                    buf += self.sock.recv(4096)
                ln = struct.unpack("!Q", buf[:8])[0]
                buf = buf[8:]
            while len(buf) < ln:
                chunk = self.sock.recv(4096)
                if not chunk:
                    return
                buf += chunk
            payload, buf = buf[:ln], buf[ln:]
            if opcode == 1:
                yield payload.decode()
            elif opcode == 8:
                return
            elif opcode == 9:
                mask = os.urandom(4)
                pong = bytearray([0x8A, 0x80 | len(payload)])
                pong += mask
                pong += bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
                self.sock.sendall(pong)


def emit(event: dict) -> None:
    sys.stdout.write(json.dumps(event, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def player_id(explicit: str) -> str:
    if explicit:
        return explicit
    base = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config")
    path = base / "micromist" / "frontline-tide-player-id"
    if path.exists():
        found = path.read_text().strip()
        if found:
            return found
    path.parent.mkdir(parents=True, exist_ok=True)
    fresh = "agent-" + "".join(random.choice(string.ascii_lowercase) for _ in range(8))
    path.write_text(fresh + "\n")
    return fresh


class Session:
    def __init__(self, code: str) -> None:
        self.room_code = code
        self.you = None
        self.phase = "lobby"
        self.public_state = {}
        self.legal = []
        self.effects = []
        self.last_event = "connecting"
        self.result = None
        self.over = False
        self.cv = threading.Condition()

    def snapshot(self) -> dict:
        pub = self.public_state or {}
        return {
            "event": self.last_event,
            "you": self.you,
            "phase": self.phase,
            "tidePhase": pub.get("tidePhase"),
            "day": pub.get("day"),
            "hearts": pub.get("hearts"),
            "points": pub.get("points"),
            "swapsLeft": pub.get("swapsLeft"),
            "frontDir": pub.get("frontDir"),
            "washColumn": pub.get("washColumn"),
            "washColumns": pub.get("washColumns") or [],
            "washWidth": pub.get("washWidth"),
            "pathRow": pub.get("pathRow"),
            "openRoadCols": pub.get("openRoadCols") or [],
            "scrubbedRoad": pub.get("scrubbedRoad") or [],
            "shear": bool(pub.get("shear")),
            "bands": pub.get("bands") or [],
            "board": pub.get("board") or [],
            "legalActions": self.legal,
            "effects": self.effects,
            "roomCode": self.room_code,
            "canConfig": bool(self.you and self.you.get("canConfig")),
            "result": self.result,
        }

    def apply_obs(self, obs: dict) -> None:
        if not isinstance(obs, dict):
            return
        if isinstance(obs.get("you"), dict):
            self.you = obs["you"]
        if isinstance(obs.get("phase"), str):
            self.phase = obs["phase"]
        self.legal = obs.get("legalActions") if isinstance(obs.get("legalActions"), list) else []
        self.effects = obs.get("effects") if isinstance(obs.get("effects"), list) else []
        if isinstance(obs.get("publicState"), dict):
            self.public_state = obs["publicState"]

    def note(self, msg: dict) -> None:
        payload = msg.get("payload") if isinstance(msg.get("payload"), dict) else {}
        kind = msg.get("type")
        with self.cv:
            if kind in ("welcome", "joined", "seated"):
                if isinstance(payload.get("you"), dict):
                    self.you = payload["you"]
                if isinstance(payload.get("phase"), str):
                    self.phase = payload["phase"]
            if kind == "room" and isinstance(payload.get("phase"), str):
                self.phase = payload["phase"]
            if isinstance(payload.get("observation"), dict):
                self.apply_obs(payload["observation"])
            if isinstance(payload.get("publicState"), dict):
                self.public_state = payload["publicState"]
            if kind == "your_turn":
                self.last_event = "your_turn"
                emit({"event": "your_turn", **self.snapshot()})
            elif kind == "game_over":
                self.last_event = "game_over"
                self.over = True
                self.result = payload
                self.legal = []
                emit({"event": "game_over", **self.snapshot()})
            elif kind == "error":
                emit({"event": "error", "message": payload.get("message") or "error"})
            self.cv.notify_all()


def make_handler(session: Session, ws_send):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt: str, *args) -> None:
            return

        def _json(self, status: int, body: dict) -> None:
            raw = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("content-type", "application/json; charset=utf-8")
            self.send_header("cache-control", "no-store")
            self.send_header("content-length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self) -> None:  # noqa: N802
            path = urlparse(self.path).path
            query = urlparse(self.path).query
            if path == "/state":
                self._json(200, session.snapshot())
                return
            if path == "/wait":
                want = "your_turn"
                for part in query.split("&"):
                    if part.startswith("event="):
                        want = part.split("=", 1)[1] or want
                with session.cv:
                    while not (
                        session.over
                        or session.last_event == want
                        or (want == "your_turn" and session.last_event == "game_over")
                    ):
                        session.cv.wait()
                    body = session.snapshot()
                self._json(200, body)
                return
            self._json(404, {"error": "not found"})

        def do_POST(self) -> None:  # noqa: N802
            path = urlparse(self.path).path
            length = int(self.headers.get("content-length") or "0")
            raw = self.rfile.read(length) if length else b"{}"
            if path == "/shutdown":
                self._json(200, {"ok": True})
                os._exit(0)
            if path != "/move":
                self._json(404, {"error": "not found"})
                return
            try:
                body = json.loads(raw.decode() or "{}")
            except json.JSONDecodeError:
                self._json(400, {"error": "invalid json"})
                return
            def same(action: dict) -> bool:
                if not isinstance(action, dict) or action.get("type") != body.get("type"):
                    return False
                if body.get("type") == "end_phase":
                    return True
                if body.get("type") == "place":
                    return action.get("row") == body.get("row") and action.get("col") == body.get("col")
                if body.get("type") == "swap":
                    return (
                        action.get("row") == body.get("row")
                        and action.get("col") == body.get("col")
                        and action.get("row2") == body.get("row2")
                        and action.get("col2") == body.get("col2")
                    )
                return False

            ok = any(same(action) for action in session.legal)
            if not ok:
                self._json(409, {"error": "move is not in legalActions", "legalActions": session.legal})
                return
            ws_send({"type": "move", "payload": body})
            with session.cv:
                session.last_event = "sent"
            self._json(202, {"ok": True, "action": body})

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument("command", choices=["create_room", "join_room", "claim_seat"])
    parser.add_argument("--origin", default="")
    parser.add_argument("--url", default="")
    parser.add_argument("--seat", default="")
    parser.add_argument("--player-id", default="")
    parser.add_argument("--name", default="Agent")
    parser.add_argument("--config", default="")
    parser.add_argument("-c", "--code", default="")
    args = parser.parse_args()
    if args.seat and args.seat != "player":
        sys.stderr.write("--seat must be player\n")
        sys.exit(1)
    code = (args.code or "").strip().lower()
    if not code and args.command == "create_room":
        code = "".join(random.choice(string.ascii_lowercase) for _ in range(6))
    if not code:
        sys.stderr.write("join_room needs -c CODE\n")
        sys.exit(1)
    if args.url:
        url = args.url
    else:
        origin = args.origin.rstrip("/")
        scheme = "wss" if origin.startswith("https") else "ws"
        host = origin.split("://", 1)[-1]
        url = f"{scheme}://{host}/ws/frontline-tide:{code}"
    session = Session(code)
    pid = player_id(args.player_id)
    sock = MiniWS(url)
    send_lock = threading.Lock()

    def ws_send(obj: dict) -> None:
        with send_lock:
            sock.send(json.dumps(obj))

    def reader() -> None:
        for raw in sock.messages():
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            session.note(msg)

    threading.Thread(target=reader, daemon=True).start()
    ws_send({
        "type": "join",
        "payload": {"playerId": pid, "name": args.name, "kind": "agent", "game": "frontline-tide"},
    })
    with session.cv:
        while session.you is None:
            session.cv.wait(timeout=8)
    if args.config and session.you and session.you.get("canConfig") and session.phase == "lobby":
        ws_send({"type": "set_config", "payload": json.loads(args.config)})
    if args.seat == "player" or args.command == "claim_seat":
        ws_send({"type": "claim_seat", "payload": {"seat": "player"}})
    server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(session, ws_send))
    port = server.server_address[1]
    emit({"event": "listening", "port": port, "base": f"http://127.0.0.1:{port}", "roomCode": code})
    server.serve_forever()


if __name__ == "__main__":
    main()
