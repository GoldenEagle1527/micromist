#!/usr/bin/env python3
"""Official explosive-chess WebSocket transport. No chess strength.

Connects, joins as kind "agent", optionally sends one move you already chose,
then either blocks until the server pushes your_turn / game_over (wait) or
returns one observation (poll). It never picks a move.

Standard library only. Written for common Python 3.8+ interpreters.
Stdout is one JSON object. Diagnostics go to stderr.

  python3 ws_wait.py --url wss://HOST/ws/explosive-chess:CODE --player-id ID --name Agent
  python3 ws_wait.py --url wss://HOST/ws/explosive-chess:CODE --player-id ID --move ROW,COL
  python3 ws_poll.py --url wss://HOST/ws/explosive-chess:CODE --player-id ID --move ROW,COL
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import socket
import ssl
import sys
import time
from urllib.parse import urlparse

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
OP_CONT = 0x0
OP_TEXT = 0x1
OP_BIN = 0x2
OP_CLOSE = 0x8
OP_PING = 0x9
OP_PONG = 0xA
MAX_FRAME = 16 * 1024 * 1024

HELP = """explosive-chess official WebSocket transport (no chess strength)

The process connects, joins as kind "agent", optionally sends one move you
already chose, then either blocks until the server pushes your_turn /
game_over (wait) or returns one observation (poll).

It does not choose moves. Do not wrap it in a solver, search tree, or auto-play loop.

  python3 ws_wait.py --url wss://HOST/ws/explosive-chess:CODE --player-id ID --name Agent
  python3 ws_wait.py --url wss://HOST/ws/explosive-chess:CODE --player-id ID --move ROW,COL
  python3 ws_poll.py --url wss://HOST/ws/explosive-chess:CODE --player-id ID

  --url         WebSocket URL (required)
  --player-id   Seat id to join and reclaim (required)
  --name        Display name (default Agent)
  --move        ROW,COL you already chose from legalActions
  --config      JSON object. Sent as set_config only if you are host and the room is still a lobby
  --timeout     Seconds to block (default 180)
  --poll        Return current state instead of waiting for the opponent
  --help

Stdout is one JSON object. Exit 0 when ok is true.
Python 3.8+ standard library only. No third-party packages.
"""


class TransportError(Exception):
    pass


class WsClient(object):
    def __init__(self, url, timeout):
        self.url = url
        self.timeout = timeout
        self.sock = None
        self.buf = b""
        self.queue = []
        self.seen = []
        self.seq = 0
        self.closed = False
        self.frag = []
        self.frag_op = None

    def connect(self):
        parsed = urlparse(self.url)
        scheme = parsed.scheme
        host = parsed.hostname
        if scheme == "wss":
            port = parsed.port or 443
        elif scheme == "ws":
            port = parsed.port or 80
        else:
            raise TransportError("url must start with ws:// or wss://")
        if not host:
            raise TransportError("url is missing a host")
        path = parsed.path or "/"
        if parsed.query:
            path = path + "?" + parsed.query
        raw = socket.create_connection((host, port), timeout=min(self.timeout, 20))
        raw.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        if scheme == "wss":
            context = ssl.create_default_context()
            raw = context.wrap_socket(raw, server_hostname=host)
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        host_header = parsed.netloc or host
        request = (
            "GET %s HTTP/1.1\r\n"
            "Host: %s\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            "Sec-WebSocket-Key: %s\r\n"
            "Sec-WebSocket-Version: 13\r\n"
            "\r\n"
        ) % (path, host_header, key)
        raw.sendall(request.encode("ascii"))
        raw.settimeout(min(self.timeout, 20))
        data = b""
        while b"\r\n\r\n" not in data:
            chunk = raw.recv(4096)
            if not chunk:
                raise TransportError("websocket handshake closed")
            data += chunk
            if len(data) > 65536:
                raise TransportError("websocket handshake too large")
        head, rest = data.split(b"\r\n\r\n", 1)
        status = head.split(b"\r\n", 1)[0]
        if b" 101 " not in status:
            raise TransportError("websocket upgrade failed: " + status.decode("latin1", "replace"))
        accept = None
        for line in head.split(b"\r\n")[1:]:
            if line.lower().startswith(b"sec-websocket-accept:"):
                accept = line.split(b":", 1)[1].strip().decode("ascii", "replace")
        expected = base64.b64encode(
            hashlib.sha1((key + GUID).encode("ascii")).digest()
        ).decode("ascii")
        if accept != expected:
            raise TransportError("websocket accept mismatch")
        self.sock = raw
        self.buf = rest

    def close(self):
        self.closed = True
        sock = self.sock
        self.sock = None
        if sock is not None:
            try:
                sock.close()
            except OSError:
                pass

    def send_msg(self, type_, payload):
        body = json.dumps({"type": type_, "payload": payload}, separators=(",", ":")).encode("utf-8")
        self._send_frame(OP_TEXT, body)

    def _send_frame(self, opcode, payload):
        if self.sock is None:
            raise TransportError("websocket closed")
        mask = os.urandom(4)
        length = len(payload)
        header = bytearray()
        header.append(0x80 | opcode)
        if length < 126:
            header.append(0x80 | length)
        elif length < 65536:
            header.append(0x80 | 126)
            header.extend(length.to_bytes(2, "big"))
        else:
            header.append(0x80 | 127)
            header.extend(length.to_bytes(8, "big"))
        masked = b"".join(bytes([payload[i] ^ mask[i % 4]]) for i in range(length))
        self.sock.sendall(bytes(header) + mask + masked)

    def _push(self, msg):
        self.seq += 1
        msg["_seq"] = self.seq
        self.queue.append(msg)
        self.seen.append(msg)

    def high_water(self):
        self.drain_available()
        return self.seq

    def drain_available(self):
        if self.sock is None:
            return
        self.sock.setblocking(False)
        try:
            while True:
                try:
                    chunk = self.sock.recv(65536)
                except OSError as exc:
                    if _would_block(exc):
                        break
                    raise TransportError("websocket closed: " + str(exc))
                if not chunk:
                    self.closed = True
                    break
                self.buf += chunk
        finally:
            if self.sock is not None:
                self.sock.setblocking(True)
        self._drain_buf()

    def _drain_buf(self):
        while True:
            frame = self._try_pop_frame()
            if frame is None:
                return
            msg = self._consume_frame(frame[0], frame[1], frame[2])
            if msg is not None:
                self._push(msg)

    def wait_for(self, pred, deadline):
        while True:
            for index, msg in enumerate(self.queue):
                if pred(msg):
                    return self.queue.pop(index)
            if self.closed:
                raise TransportError("websocket closed")
            self._read_into_queue(deadline)

    def _read_into_queue(self, deadline):
        while True:
            frame = self._try_pop_frame()
            if frame is None:
                self._fill_some(deadline)
                continue
            msg = self._consume_frame(frame[0], frame[1], frame[2])
            if msg is not None:
                self._push(msg)
                return

    def _fill_some(self, deadline):
        if self.sock is None:
            raise TransportError("websocket closed")
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("timeout")
        self.sock.settimeout(remaining)
        try:
            chunk = self.sock.recv(65536)
        except (socket.timeout, TimeoutError):
            raise TimeoutError("timeout")
        if not chunk:
            raise TransportError("websocket closed")
        self.buf += chunk

    def _try_pop_frame(self):
        buf = self.buf
        if len(buf) < 2:
            return None
        first = buf[0]
        second = buf[1]
        masked = (second & 0x80) != 0
        length = second & 0x7F
        pos = 2
        if length == 126:
            if len(buf) < pos + 2:
                return None
            length = int.from_bytes(buf[pos : pos + 2], "big")
            pos += 2
        elif length == 127:
            if len(buf) < pos + 8:
                return None
            length = int.from_bytes(buf[pos : pos + 8], "big")
            pos += 8
        if length > MAX_FRAME:
            raise TransportError("frame too large")
        mask_len = 4 if masked else 0
        end = pos + mask_len + length
        if len(buf) < end:
            return None
        payload = buf[pos + mask_len : end]
        if masked:
            mask = buf[pos : pos + 4]
            payload = bytes(payload[i] ^ mask[i % 4] for i in range(length))
        self.buf = buf[end:]
        fin = (first & 0x80) != 0
        opcode = first & 0x0F
        return fin, opcode, payload

    def _consume_frame(self, fin, opcode, payload):
        if opcode == OP_CLOSE:
            self.closed = True
            raise TransportError("websocket closed")
        if opcode == OP_PING:
            self._send_frame(OP_PONG, payload)
            return None
        if opcode == OP_PONG:
            return None
        if opcode == OP_CONT:
            if self.frag_op is None:
                raise TransportError("unexpected continuation")
            self.frag.append(payload)
        elif opcode in (OP_TEXT, OP_BIN):
            self.frag = [payload]
            self.frag_op = opcode
        else:
            return None
        if not fin:
            return None
        op = self.frag_op
        data = b"".join(self.frag)
        self.frag = []
        self.frag_op = None
        if op != OP_TEXT:
            return None
        text = data.decode("utf-8", "replace")
        if text in ("ping", "pong"):
            return None
        try:
            msg = json.loads(text)
        except ValueError:
            return None
        if not isinstance(msg, dict) or not isinstance(msg.get("type"), str):
            return None
        return msg


def _would_block(exc):
    if isinstance(exc, (BlockingIOError, InterruptedError, socket.timeout, TimeoutError)):
        return True
    if isinstance(exc, ssl.SSLWantReadError):
        return True
    err = getattr(exc, "errno", None)
    return err in (getattr(socket, "EAGAIN", 11), getattr(socket, "EWOULDBLOCK", 11))


def blank(mode):
    return {
        "ok": False,
        "mode": mode,
        "event": "error",
        "roomCode": None,
        "you": None,
        "phase": None,
        "turn": None,
        "yourTurn": False,
        "legalActions": [],
        "publicState": None,
        "gameOver": False,
        "winner": None,
        "winnerColor": None,
        "winReason": None,
        "lastOpponentMove": None,
        "reclaimed": None,
        "error": None,
    }


def apply_observation(base, obs):
    if not isinstance(obs, dict):
        return
    legal = obs.get("legalActions")
    if not isinstance(legal, list):
        legal = []
    public = obs.get("publicState")
    if not isinstance(public, dict):
        public = None
    full = public.get("fullState") if isinstance(public, dict) else None
    you = obs.get("you")
    if isinstance(you, dict):
        base["you"] = you
    phase = obs.get("phase")
    if isinstance(phase, str):
        base["phase"] = phase
    if isinstance(public, dict) and "turn" in public:
        base["turn"] = public.get("turn")
    base["legalActions"] = legal
    base["publicState"] = public
    base["yourTurn"] = len(legal) > 0
    if isinstance(full, dict) and full.get("gameOver") is True:
        base["gameOver"] = True


def latest_observation(seen):
    obs = None
    for msg in seen:
        payload = msg.get("payload") if isinstance(msg.get("payload"), dict) else {}
        if msg.get("type") in ("your_turn", "observation") and isinstance(payload.get("observation"), dict):
            obs = payload.get("observation")
    return obs


def our_apply_seq(seen, player_id, mark):
    seq = 0
    for item in seen:
        if item.get("_seq", 0) <= mark or item.get("type") != "move_applied":
            continue
        payload = item.get("payload") if isinstance(item.get("payload"), dict) else {}
        by = payload.get("by") if isinstance(payload.get("by"), dict) else {}
        if by.get("playerId") == player_id:
            seq = item.get("_seq", 0)
    return seq


def opponent_move(seen, player_id):
    found = None
    for msg in seen:
        if msg.get("type") != "move_applied":
            continue
        payload = msg.get("payload") if isinstance(msg.get("payload"), dict) else {}
        by = payload.get("by") if isinstance(payload.get("by"), dict) else {}
        if isinstance(by.get("playerId"), str) and by.get("playerId") != player_id:
            found = payload.get("action")
    return found


def public_state_from_seen(seen):
    found = None
    for msg in seen:
        payload = msg.get("payload") if isinstance(msg.get("payload"), dict) else {}
        if msg.get("type") == "move_applied" and isinstance(payload.get("publicState"), dict):
            found = payload.get("publicState")
        if msg.get("type") == "your_turn":
            obs = payload.get("observation") if isinstance(payload.get("observation"), dict) else None
            if isinstance(obs, dict) and isinstance(obs.get("publicState"), dict):
                found = obs.get("publicState")
    return found


def finish_message(base, msg, seen, player_id):
    prior = latest_observation(seen)
    if prior:
        apply_observation(base, prior)
    kind = msg.get("type")
    payload = msg.get("payload") if isinstance(msg.get("payload"), dict) else {}
    if kind == "your_turn":
        apply_observation(base, payload.get("observation"))
        base["ok"] = True
        base["event"] = "your_turn"
        base["error"] = None
    elif kind == "observation":
        apply_observation(base, payload.get("observation"))
        base["ok"] = True
        base["event"] = "observation"
        base["error"] = None
    elif kind == "game_over":
        if base.get("publicState") is None:
            base["publicState"] = public_state_from_seen(seen)
        base["ok"] = True
        base["event"] = "game_over"
        base["gameOver"] = True
        base["yourTurn"] = False
        base["legalActions"] = []
        base["winner"] = payload.get("winner")
        base["winnerColor"] = payload.get("winnerColor")
        base["winReason"] = payload.get("winReason")
        base["error"] = None
    elif kind == "room_closed":
        base["ok"] = False
        base["event"] = "room_closed"
        base["error"] = "Room closed"
    elif kind == "error":
        base["ok"] = False
        base["event"] = "error"
        base["error"] = str(payload.get("message") or "error")
    else:
        base["ok"] = False
        base["event"] = str(kind)
        base["error"] = "unexpected %s" % kind
    base["lastOpponentMove"] = opponent_move(seen, player_id)
    return base


def retriable(exc):
    text = str(exc)
    lowered = text.lower()
    for token in ("timeout", "websocket", "connect", "closed", "refused"):
        if token in lowered:
            return True
    return False


def connect_and_join(args, timeout):
    last = None
    for attempt in (1, 2, 3, 4):
        client = WsClient(args.url, timeout)
        try:
            client.connect()
            client.send_msg(
                "join",
                {
                    "playerId": args.player_id,
                    "name": args.name,
                    "kind": "agent",
                    "game": "explosive-chess",
                },
            )
            deadline = time.monotonic() + timeout
            joined = client.wait_for(lambda msg: msg.get("type") in ("joined", "error"), deadline)
            if joined.get("type") == "error":
                payload = joined.get("payload") if isinstance(joined.get("payload"), dict) else {}
                raise TransportError(str(payload.get("message") or "join failed"))
            client.drain_available()
            return client, joined
        except Exception as exc:
            last = exc
            client.close()
            if attempt == 4 or not retriable(exc):
                break
            sys.stderr.write("join attempt %s failed: %s; retrying\n" % (attempt, exc))
            time.sleep(0.25 * attempt)
    if isinstance(last, Exception):
        raise last
    raise TransportError("join failed")


def maybe_config(client, joined, config, timeout):
    if not config:
        return
    payload = joined.get("payload") if isinstance(joined.get("payload"), dict) else {}
    you = payload.get("you") if isinstance(payload.get("you"), dict) else {}
    if you.get("role") != "host":
        sys.stderr.write("not host; ignoring --config\n")
        return
    if payload.get("phase") and payload.get("phase") != "lobby":
        return
    client.queue = [msg for msg in client.queue if msg.get("type") != "room"]
    client.send_msg("set_config", config)
    deadline = time.monotonic() + min(timeout, 15)
    msg = client.wait_for(lambda item: item.get("type") in ("room", "error"), deadline)
    if msg.get("type") == "error":
        body = msg.get("payload") if isinstance(msg.get("payload"), dict) else {}
        message = str(body.get("message") or "")
        if "locked" not in message.lower():
            raise TransportError(message or "set_config failed")


def run(args):
    mode = "poll" if args.poll else "wait"
    client, joined = connect_and_join(args, args.timeout)
    payload = joined.get("payload") if isinstance(joined.get("payload"), dict) else {}
    base = blank(mode)
    base["roomCode"] = payload.get("roomCode")
    you = payload.get("you") if isinstance(payload.get("you"), dict) else None
    base["you"] = you
    base["reclaimed"] = payload.get("reclaimed") is True
    if isinstance(you, dict) and you.get("seat") == "spectator":
        base["event"] = "spectator"
        base["error"] = "Room is full. This connection is a spectator and will not receive your_turn."
        return client, base
    maybe_config(client, joined, args.config, args.timeout)
    client.drain_available()

    if args.move is None:
        if args.poll:
            mark = client.high_water()
            client.send_msg("observe", {})
            deadline = time.monotonic() + min(args.timeout, 20)
            msg = client.wait_for(
                lambda item: item.get("_seq", 0) > mark
                and item.get("type") in ("observation", "error", "game_over", "room_closed"),
                deadline,
            )
            return client, finish_message(base, msg, client.seen, args.player_id)
        deadline = time.monotonic() + args.timeout
        msg = client.wait_for(
            lambda item: item.get("type") in ("your_turn", "game_over", "room_closed"),
            deadline,
        )
        return client, finish_message(base, msg, client.seen, args.player_id)

    early = None
    for item in client.queue:
        if item.get("type") == "game_over":
            early = item
            break
    if early is not None:
        client.queue = [item for item in client.queue if item is not early]
        return client, finish_message(base, early, client.seen, args.player_id)

    mark = client.high_water()
    client.send_msg("move", {"row": args.move[0], "col": args.move[1]})
    if args.poll:
        deadline = time.monotonic() + min(args.timeout, 20)
        ack = client.wait_for(
            lambda item: item.get("_seq", 0) > mark
            and item.get("type") in ("error", "move_applied", "game_over", "room_closed"),
            deadline,
        )
        if ack.get("type") != "move_applied":
            return client, finish_message(base, ack, client.seen, args.player_id)
        client.drain_available()
        pending_over = None
        for item in client.queue:
            if item.get("type") == "game_over":
                pending_over = item
                break
        if pending_over is not None:
            return client, finish_message(base, pending_over, client.seen, args.player_id)
        observe_mark = client.high_water()
        client.send_msg("observe", {})
        msg = client.wait_for(
            lambda item: item.get("_seq", 0) > observe_mark
            and item.get("type") in ("observation", "error", "game_over", "room_closed"),
            time.monotonic() + min(args.timeout, 20),
        )
        return client, finish_message(base, msg, client.seen, args.player_id)

    deadline = time.monotonic() + args.timeout

    def after_move(item):
        if item.get("_seq", 0) <= mark:
            return False
        if item.get("type") in ("error", "game_over", "room_closed"):
            return True
        if item.get("type") != "your_turn":
            return False
        applied = our_apply_seq(client.seen, args.player_id, mark)
        return applied > 0 and item.get("_seq", 0) > applied

    msg = client.wait_for(after_move, deadline)
    return client, finish_message(base, msg, client.seen, args.player_id)


def emit(result, client):
    if client is not None:
        client.close()
    sys.stdout.write(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    sys.stdout.flush()
    raise SystemExit(0 if result.get("ok") else 1)


def invoked_as_poll():
    base = os.path.basename(sys.argv[0])
    return base == "ws_poll.py" or base == "ws-poll.py"


def parse_move(text):
    parts = text.strip().split(",")
    if len(parts) != 2:
        raise TransportError("--move must be ROW,COL using non-negative integers")
    row_text = parts[0].strip()
    col_text = parts[1].strip()
    if not row_text.isdigit() or not col_text.isdigit():
        raise TransportError("--move must be ROW,COL using non-negative integers")
    return int(row_text), int(col_text)


def build_parser():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--url", default="")
    parser.add_argument("--player-id", default="")
    parser.add_argument("--name", default="Agent")
    parser.add_argument("--move", default=None)
    parser.add_argument("--config", default=None)
    parser.add_argument("--timeout", default="180")
    parser.add_argument("--poll", action="store_true")
    parser.add_argument("--help", "-h", action="store_true")
    return parser


def main():
    parser = build_parser()
    try:
        args = parser.parse_args()
    except SystemExit:
        raise
    if args.help:
        sys.stdout.write(HELP)
        raise SystemExit(0)
    args.poll = bool(args.poll or invoked_as_poll())
    if not args.url:
        raise TransportError("missing --url")
    if not str(args.player_id).strip():
        raise TransportError("missing --player-id")
    try:
        args.timeout = float(args.timeout)
    except ValueError:
        raise TransportError("--timeout must be a positive number of seconds")
    if not (args.timeout > 0) or args.timeout != args.timeout:
        raise TransportError("--timeout must be a positive number of seconds")
    if args.timeout > 3600:
        args.timeout = 3600
    if args.move is not None:
        args.move = parse_move(args.move)
    if args.config:
        try:
            args.config = json.loads(args.config)
        except ValueError:
            raise TransportError("--config must be a JSON object")
        if not isinstance(args.config, dict):
            raise TransportError("--config must be a JSON object")
    else:
        args.config = None
    client, result = run(args)
    emit(result, client)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:
        mode = "poll" if invoked_as_poll() or "--poll" in sys.argv else "wait"
        result = blank(mode)
        message = str(exc)
        result["error"] = message
        result["event"] = "timeout" if "timeout" in message.lower() else "error"
        try:
            sys.stdout.write(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
            sys.stdout.flush()
        finally:
            raise SystemExit(1)
