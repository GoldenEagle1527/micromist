#!/usr/bin/env python3
"""Official explosive-chess client. No chess strength.

One process joins the room WebSocket, then listens on 127.0.0.1 at an
ephemeral port. Drive the match with curl against that port. This process
does not choose moves. It exits on game_over, on POST /shutdown, or on a
fatal disconnect.

Standard library only. Written for common Python 3.8+ interpreters.
Stdout is one JSON object per line. The first line after listen is
{"event":"listening","port":N,"base":"http://127.0.0.1:N"}.
Diagnostics go to stderr.

  python3 server.py --origin https://HOST --seat red create_room
  python3 server.py --origin https://HOST --seat red create_room -c CODE
  python3 server.py --origin https://HOST --seat blue join_room -c CODE
  python3 server.py --url wss://HOST/ws/explosive-chess:CODE --seat red claim_seat -c CODE
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import select
import socket
import ssl
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
OP_CONT = 0x0
OP_TEXT = 0x1
OP_BIN = 0x2
OP_CLOSE = 0x8
OP_PING = 0x9
OP_PONG = 0xA
MAX_FRAME = 16 * 1024 * 1024
KEEPALIVE_S = 20
RECONNECT_HINT = "Reconnect with the same --player-id and claim the same seat."
WAKE = object()
TIMEOUT = object()
CLOSED = object()

HELP = """explosive-chess official client (no chess strength)

One process joins as kind "agent", keeps the WebSocket open, and serves a
local HTTP API on 127.0.0.1. You choose every move with curl. The process
does not choose moves.
It exits when event is game_over, when you POST /shutdown, or on a fatal disconnect.
Do not wrap it in a solver, search tree, or auto-play loop.
The one-shot client that exited after a single your_turn is retired.

  python3 server.py --origin https://HOST --seat red create_room
  python3 server.py --origin https://HOST --seat red create_room -c CODE
  python3 server.py --origin https://HOST --seat blue join_room -c CODE
  python3 server.py --url wss://HOST/ws/explosive-chess:CODE --seat red claim_seat -c CODE

  create_room   Open a room and join as a spectator. -c is optional.
  join_room     Join a room as a spectator. -c CODE is required unless --url has the code.
  claim_seat    Join, then claim --seat red or blue. -c CODE is required unless --url has it.
  -c, --code    Room code [a-z0-9]
  --origin      http(s) origin of the game host
  --url         Exact websocket URL. Used as-is when present.
  --seat        red or blue. Sent as claim_seat after join. Omit to watch.
  --player-id   This process's id. Omit to reuse the id stored on this machine.
  --name        Display name (default Agent)
  --config      JSON object. Sent as set_config only when you.canConfig is true and the room is still a lobby. If it cannot apply, stdout gets an error JSON line and the process exits before play
  --verbose     Accepted for older commands. board and effects are always included
  --timeout     Seconds to block for one server push. Omit to wait until game_over
  --help

After the socket joins, the process binds 127.0.0.1 on an ephemeral port and
prints {"event":"listening","port":N,"base":"http://127.0.0.1:N"}.
Replace BASE with that base:

  curl -sS "$BASE/state"
  curl -sS "$BASE/wait?event=your_turn"
  curl -sS -X POST "$BASE/move" -H "content-type: application/json" --data '{"row":0,"col":0}'
  curl -sS -X POST "$BASE/seat" -H "content-type: application/json" --data '{"seat":"red"}'
  curl -sS -X POST "$BASE/config" -H "content-type: application/json" --data '{"boardSize":9,"winMode":"steps","winParam":4,"hostColor":"red"}'
  curl -sS -X POST "$BASE/shutdown"

GET /state is you, turn, board, effects, legalActions, phase, the last event, roomCode, canConfig, and result when the match is over.
GET /wait blocks until your_turn or game_over. ?timeout=SECONDS returns the state. Omit timeout to wait until the match ends.
POST /move sends {"row":n,"col":n} only when that cell is in legalActions.
POST /config is set_config when canConfig is true and the room is still a lobby. If it cannot apply, the response is an error and the process exits non-zero.
POST /seat claims red or blue.
POST /shutdown closes the socket and exits 0.

Join does not take a seat. Pass --seat red or --seat blue to play.
The same playerId reclaims red, blue, or spectator. A new id is a new person.
Omit --player-id to use ~/.config/micromist/explosive-chess-player-id
(or $XDG_CONFIG_HOME/micromist/explosive-chess-player-id). Passing --player-id
does not replace that file. A second agent on this machine passes its own id.
Stdout is one JSON object per line. Diagnostics go to stderr.
Python 3.8+ standard library only. No third-party packages.
"""


class TransportError(Exception):
    pass


class CliError(Exception):
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
        raw = socket.create_connection((host, port), timeout=min(self.timeout or 20, 20))
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
        raw.settimeout(min(self.timeout or 20, 20))
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
        expected = base64.b64encode(hashlib.sha1((key + GUID).encode("ascii")).digest()).decode("ascii")
        if accept != expected:
            raise TransportError("websocket accept mismatch")
        self.sock = raw
        self.buf = rest
        self._drain_buf()

    def keepalive(self):
        if self.sock is None or self.closed:
            return
        try:
            self._send_frame(OP_TEXT, b"ping")
        except TransportError:
            raise
        except OSError as exc:
            raise TransportError("websocket closed: %s" % exc)

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
        masked = bytes(payload[i] ^ mask[i % 4] for i in range(length))
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
        while True:
            if deadline is None:
                slice_s = KEEPALIVE_S
            else:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError("timeout")
                slice_s = min(remaining, KEEPALIVE_S)
            self.sock.settimeout(slice_s)
            try:
                chunk = self.sock.recv(65536)
            except (socket.timeout, TimeoutError):
                if deadline is not None and deadline - time.monotonic() <= 0:
                    raise TimeoutError("timeout")
                self.keepalive()
                continue
            if not chunk:
                raise TransportError("websocket closed")
            self.buf += chunk
            return

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


def player_id_file():
    base = os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config")
    return os.path.join(base, "micromist", "explosive-chess-player-id")


def valid_player_id(value):
    if not value or len(value) > 80:
        return False
    for ch in value:
        ok = ("a" <= ch <= "z") or ("A" <= ch <= "Z") or ("0" <= ch <= "9") or ch in "._:-"
        if not ok:
            return False
    return True


def load_or_create_player_id():
    path = player_id_file()
    try:
        with open(path, "r", encoding="utf-8") as handle:
            existing = handle.read().strip()
        if valid_player_id(existing):
            sys.stderr.write("playerId %s loaded from %s\n" % (existing, path))
            return existing
    except OSError:
        pass
    created = "agent-" + token(8)
    try:
        directory = os.path.dirname(path)
        if directory and not os.path.isdir(directory):
            os.makedirs(directory, 0o700)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(created + "\n")
        sys.stderr.write("playerId %s stored at %s\n" % (created, path))
    except OSError as exc:
        sys.stderr.write("could not store playerId at %s: %s\n" % (path, exc))
    return created


def token(size):
    alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
    raw = os.urandom(size)
    return "".join(alphabet[b % 36] for b in raw)


def write_line(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def fail(message):
    event = "timeout" if "timeout" in message.lower() else "error"
    write_line(
        {
            "event": event,
            "ok": False,
            "error": message,
            "you": None,
            "lastOpponentMove": None,
            "legalActions": [],
            "turn": None,
            "roomCode": None,
        }
    )
    raise SystemExit(1)


def parse_config(text):
    try:
        value = json.loads(text)
    except ValueError:
        raise CliError("--config must be a JSON object")
    if not isinstance(value, dict):
        raise CliError("--config must be a JSON object")
    return value


def code_from_ws_url(value):
    path = urlparse(value).path or value
    marker = "/ws/explosive-chess:"
    index = path.lower().find(marker)
    if index < 0:
        return ""
    raw = path[index + len(marker) :]
    code = []
    for ch in raw:
        if ch.isalnum() and ord(ch) < 128:
            code.append(ch.lower())
        else:
            break
    return "".join(code)


def ws_url_from_origin(origin, code):
    parsed = urlparse(origin)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise CliError("--origin must be an http(s) URL")
    proto = "wss" if parsed.scheme == "https" else "ws"
    return "%s://%s/ws/explosive-chess:%s" % (proto, parsed.netloc, code)


def http_origin_from(args):
    if args.origin:
        parsed = urlparse(args.origin)
        return "%s://%s" % (parsed.scheme, parsed.netloc)
    parsed = urlparse(args.url)
    proto = "https" if parsed.scheme == "wss" else "http"
    return "%s://%s" % (proto, parsed.netloc)


class Args(object):
    def __init__(self):
        self.help = False
        self.verbose = False
        self.origin = ""
        self.url = ""
        self.player_id = ""
        self.name = "Agent"
        self.config = None
        self.timeout = None
        self.command = ""
        self.code = ""
        self.seat = ""
        self.player_id_from_flag = False
        self.budget = None


def parse_args(argv):
    args = Args()
    i = 1
    while i < len(argv):
        flag = argv[i]

        def take():
            nonlocal i
            if i + 1 >= len(argv) or argv[i + 1].startswith("-"):
                raise CliError("missing value for %s" % flag)
            i += 1
            return argv[i]

        if flag in ("--help", "-h"):
            args.help = True
        elif flag == "--verbose":
            args.verbose = True
        elif flag == "--origin":
            args.origin = take()
        elif flag == "--url":
            args.url = take()
        elif flag == "--player-id":
            args.player_id = take()
            args.player_id_from_flag = True
        elif flag == "--seat":
            args.seat = take().strip().lower()
        elif flag == "--name":
            args.name = take()
        elif flag == "--config":
            args.config = parse_config(take())
        elif flag == "--timeout":
            try:
                args.timeout = float(take())
            except ValueError:
                raise CliError("--timeout must be a non-negative number of seconds")
        elif flag in ("-c", "--code"):
            args.code = take().strip().lower()
        elif flag in ("create_room", "join_room", "claim_seat"):
            if args.command:
                raise CliError("only one of create_room, join_room, or claim_seat")
            args.command = flag
        else:
            raise CliError("unknown argument %s" % flag)
        i += 1
    return args


def normalize(args):
    if not args.command:
        raise CliError("missing command create_room, join_room, or claim_seat")
    if args.timeout is not None and (args.timeout < 0 or args.timeout != args.timeout):
        raise CliError("--timeout must be a non-negative number of seconds")
    if args.seat and args.seat not in ("red", "blue"):
        raise CliError("--seat must be red or blue")
    if args.command == "claim_seat" and not args.seat:
        raise CliError("claim_seat requires --seat red or --seat blue")
    if args.code and not _room_code(args.code):
        raise CliError("room code must be [a-z0-9]")
    if args.command == "create_room" and not args.code and not args.url:
        args.code = token(6)
    from_url = code_from_ws_url(args.url) if args.url else ""
    if args.code and from_url and args.code != from_url:
        raise CliError("-c does not match the room code in --url")
    if not args.code:
        args.code = from_url
    if not args.code:
        if args.command == "create_room":
            raise CliError("missing room code")
        raise CliError("%s requires -c CODE" % args.command)
    if not _room_code(args.code):
        raise CliError("room code must be [a-z0-9]")
    if not args.url:
        if not args.origin:
            raise CliError("missing --origin or --url")
        args.url = ws_url_from_origin(args.origin, args.code)
    if args.timeout is None or args.timeout == 0:
        args.budget = None
    else:
        args.budget = min(args.timeout, 3600)
    if not args.player_id.strip():
        if args.player_id_from_flag:
            raise CliError("--player-id must not be empty")
        args.player_id = load_or_create_player_id()
    args.player_id = args.player_id.strip()
    if not valid_player_id(args.player_id):
        raise CliError("--player-id must be 1-80 characters of letters, digits, dot, underscore, colon, or dash")


def _room_code(code):
    if not code:
        return False
    for ch in code:
        if not (("a" <= ch <= "z") or ("0" <= ch <= "9")):
            return False
    return True


def retriable(exc):
    text = str(exc).lower()
    for token_ in ("timeout", "websocket", "connect", "closed", "refused"):
        if token_ in text:
            return True
    return False


def connect_and_join(args):
    timeout = args.budget if args.budget else 20
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
                raise CliError(str(payload.get("message") or "join failed"))
            client.drain_available()
            return client, joined
        except Exception as exc:
            last = exc
            client.close()
            if attempt == 4 or isinstance(exc, CliError) or not retriable(exc):
                break
            sys.stderr.write("join attempt %s failed: %s; retrying\n" % (attempt, exc))
            time.sleep(0.25 * attempt)
    if isinstance(last, Exception):
        raise last
    raise TransportError("join failed")


def can_configure(you, phase):
    if not isinstance(you, dict):
        return False
    if phase and phase != "lobby":
        return False
    if you.get("canConfig") is False:
        return False
    if you.get("canConfig") is True:
        return True
    return you.get("role") == "host"


def config_blocked_reason(you, phase):
    if phase and phase != "lobby":
        return "config locked; room is not a lobby"
    return "not the config host; ignoring --config"


def maybe_config(client, joined, config):
    if not config:
        return
    payload = joined.get("payload") if isinstance(joined.get("payload"), dict) else {}
    you = payload.get("you") if isinstance(payload.get("you"), dict) else {}
    phase = payload.get("phase")
    if not can_configure(you, phase):
        raise CliError(config_blocked_reason(you, phase))
    client.queue = [msg for msg in client.queue if msg.get("type") != "room"]
    client.send_msg("set_config", config)
    deadline = time.monotonic() + 15
    msg = client.wait_for(lambda item: item.get("type") in ("room", "error"), deadline)
    if msg.get("type") == "error":
        body = msg.get("payload") if isinstance(msg.get("payload"), dict) else {}
        raise CliError(str(body.get("message") or "set_config failed"))


def blank_state(args):
    return {
        "roomCode": args.code or None,
        "you": None,
        "turn": None,
        "legalActions": [],
        "lastOpponentMove": None,
        "board": None,
        "effects": [],
        "phase": None,
        "reclaimed": None,
        "reusedRoom": False,
        "playUrl": "%s/play/explosive-chess?room=%s" % (http_origin_from(args), args.code),
        "result": None,
        "moveMark": 0,
        "awaitingAck": False,
        "lastEvent": None,
        "errorText": None,
        "recoverable": False,
        "hint": None,
        "fatal": False,
    }


def you_from_seat(prev, payload):
    you = payload.get("you") if isinstance(payload.get("you"), dict) else None
    if you is not None:
        nxt = dict(you)
        if not isinstance(nxt.get("canConfig"), bool) and isinstance(payload.get("canConfig"), bool):
            nxt["canConfig"] = payload.get("canConfig")
        if nxt.get("seat") is None and payload.get("seat") is not None:
            nxt["seat"] = payload.get("seat")
        if nxt.get("role") is None and payload.get("role") is not None:
            nxt["role"] = payload.get("role")
        return nxt
    if not isinstance(prev, dict):
        return prev
    nxt = dict(prev)
    if payload.get("seat") is not None:
        nxt["seat"] = payload.get("seat")
        nxt["color"] = payload.get("seat")
    if payload.get("role") is not None:
        nxt["role"] = payload.get("role")
    if isinstance(payload.get("canConfig"), bool):
        nxt["canConfig"] = payload.get("canConfig")
    return nxt


def is_spectator(state):
    you = state.get("you")
    if not isinstance(you, dict):
        return True
    return you.get("seat") in (None, "spectator")


def state_from_joined(args, joined):
    state = blank_state(args)
    payload = joined.get("payload") if isinstance(joined.get("payload"), dict) else {}
    state["roomCode"] = payload.get("roomCode") or args.code
    you = payload.get("you") if isinstance(payload.get("you"), dict) else None
    state["you"] = you
    state["phase"] = payload.get("phase")
    state["reclaimed"] = payload.get("reclaimed") is True
    reused = payload.get("reusedRoom") is True
    if not reused and args.command == "create_room" and isinstance(you, dict) and you.get("canConfig") is False:
        reused = True
    state["reusedRoom"] = reused
    if state["roomCode"]:
        state["playUrl"] = "%s/play/explosive-chess?room=%s" % (http_origin_from(args), state["roomCode"])
    return state


def maybe_claim(client, args, state, emit):
    if not args.seat:
        return
    timeout = args.budget if args.budget else 15
    client.send_msg("claim_seat", {"seat": args.seat})
    deadline = time.monotonic() + timeout
    msg = client.wait_for(lambda item: item.get("type") in ("seated", "error"), deadline)
    if msg.get("type") == "error":
        body = msg.get("payload") if isinstance(msg.get("payload"), dict) else {}
        raise CliError(str(body.get("message") or "claim_seat failed"))
    payload = msg.get("payload") if isinstance(msg.get("payload"), dict) else {}
    state["you"] = you_from_seat(state.get("you"), payload)
    emit(args, state, "seated", {"ok": True})


def apply_public(state, public):
    if not isinstance(public, dict):
        return
    if "turn" in public:
        state["turn"] = public.get("turn")
    if "board" in public:
        state["board"] = public.get("board")


def _board_size(state, payload):
    board = state.get("board")
    if isinstance(board, list) and len(board) > 0:
        return len(board)
    full = payload.get("fullState") if isinstance(payload, dict) else None
    counts = full.get("counts") if isinstance(full, dict) else None
    if isinstance(counts, list) and len(counts) > 0:
        size = int(round(len(counts) ** 0.5))
        if size * size == len(counts):
            return size
    public = payload.get("publicState") if isinstance(payload, dict) else None
    pub_board = public.get("board") if isinstance(public, dict) else None
    if isinstance(pub_board, list) and len(pub_board) > 0:
        return len(pub_board)
    return 0


def _coord_from_index(index, board_size):
    if not _is_int(index) or board_size <= 0:
        return None
    if index < 0 or index >= board_size * board_size:
        return None
    return {"row": index // board_size, "col": index % board_size}


def effects_from_frames(frames, board_size):
    if not isinstance(frames, list) or board_size <= 0:
        return []
    effects = []
    for frame in frames:
        if not isinstance(frame, dict):
            continue
        exploded = _coord_from_index(frame.get("explodedCell"), board_size)
        if exploded is None:
            continue
        spread = []
        affected = frame.get("affectedCells")
        if isinstance(affected, list):
            for idx in affected:
                cell = _coord_from_index(idx, board_size)
                if cell is not None:
                    spread.append(cell)
        effects.append({"exploded": exploded, "spread": spread})
    return effects


def apply_effects(state, effects):
    if isinstance(effects, list):
        state["effects"] = effects


def observation_fields(state):
    effects = state.get("effects")
    return {
        "board": state.get("board"),
        "effects": effects if isinstance(effects, list) else [],
    }


def apply_observation(state, obs):
    if not isinstance(obs, dict):
        return
    you = obs.get("you")
    if isinstance(you, dict):
        state["you"] = you
    if isinstance(obs.get("phase"), str):
        state["phase"] = obs.get("phase")
    legal = obs.get("legalActions")
    state["legalActions"] = legal if isinstance(legal, list) else []
    apply_public(state, obs.get("publicState"))
    apply_effects(state, obs.get("effects"))


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


def disconnect_extra(message):
    text = str(message)
    if "websocket closed" in text.lower():
        return {"ok": False, "error": "websocket closed", "recoverable": True, "hint": RECONNECT_HINT}
    return {"ok": False, "error": text}


def _is_int(value):
    return isinstance(value, int) and not isinstance(value, bool)


def _copy_action(action):
    if isinstance(action, dict):
        return dict(action)
    return action


class Session(object):
    def __init__(self, client, args, state):
        self.client = client
        self.args = args
        self.state = state
        self.lock = threading.RLock()
        self.cond = threading.Condition(self.lock)
        self.inbox = []
        self.pending = None
        self.stopping = False
        self.exit_scheduled = False
        self.exit_code = 0
        self.httpd = None
        self.port = None
        self.base = None
        self.wake_r, self.wake_w = os.pipe()
        os.set_blocking(self.wake_r, False)
        os.set_blocking(self.wake_w, False)

    def emit(self, args, state, event, extra=None):
        extra = extra or {}
        with self.lock:
            self._emit_held(args, state, event, extra)

    def _emit_held(self, args, state, event, extra):
        if event != "listening":
            state["lastEvent"] = event
            state["errorText"] = extra.get("error")
            state["recoverable"] = extra.get("recoverable") is True
            state["hint"] = extra.get("hint")
        you = state.get("you") if isinstance(state.get("you"), dict) else {}
        line = {
            "event": event,
            "ok": extra.get("ok", True) is not False,
            "you": state.get("you"),
            "lastOpponentMove": state.get("lastOpponentMove"),
            "legalActions": state.get("legalActions") or [],
            "turn": state.get("turn"),
            "roomCode": state.get("roomCode"),
        }
        if event == "joined":
            line["playerId"] = args.player_id
            line["reclaimed"] = state.get("reclaimed")
            line["reusedRoom"] = state.get("reusedRoom") is True
            line["canConfig"] = you.get("canConfig") is True
            line["playUrl"] = state.get("playUrl")
            line["phase"] = state.get("phase")
        if event == "seated":
            line["canConfig"] = you.get("canConfig") is True
        if event == "game_over":
            line["result"] = state.get("result")
        if event == "listening":
            line["port"] = extra.get("port")
            line["base"] = extra.get("base")
        if extra.get("error"):
            line["error"] = extra["error"]
        if extra.get("recoverable") is True:
            line["recoverable"] = True
        if extra.get("hint"):
            line["hint"] = extra["hint"]
        if extra.get("ok") is False:
            line["ok"] = False
        line.update(observation_fields(state))
        write_line(line)
        self.cond.notify_all()

    def _body(self, ok, error=None, event=None):
        you = self.state.get("you") if isinstance(self.state.get("you"), dict) else None
        legal = self.state.get("legalActions") or []
        body = {
            "ok": False if error else bool(ok),
            "event": event or self.state.get("lastEvent"),
            "you": dict(you) if isinstance(you, dict) else you,
            "turn": self.state.get("turn"),
            "legalActions": [_copy_action(action) for action in legal],
            "phase": self.state.get("phase"),
            "roomCode": self.state.get("roomCode"),
            "canConfig": bool(you and you.get("canConfig") is True),
            "lastOpponentMove": self.state.get("lastOpponentMove"),
            "result": self.state.get("result"),
        }
        if self.base:
            body["port"] = self.port
            body["base"] = self.base
        err = error or (None if body["ok"] else self.state.get("errorText"))
        if err:
            body["error"] = err
            body["ok"] = False
        if self.state.get("recoverable"):
            body["recoverable"] = True
        if self.state.get("hint"):
            body["hint"] = self.state.get("hint")
        body.update(observation_fields(self.state))
        return body

    def _matched(self, target):
        if self.state.get("fatal") or self.state.get("lastEvent") in ("game_over", "room_closed") or self.state.get("result") is not None:
            return True
        if target == "game_over":
            return False
        legal = self.state.get("legalActions") or []
        if target == "your_turn":
            return (
                self.state.get("lastEvent") == "your_turn"
                and not self.state.get("awaitingAck")
                and len(legal) > 0
            )
        return self.state.get("lastEvent") == target and not self.state.get("awaitingAck")

    def http_state(self):
        with self.lock:
            ok = self.state.get("lastEvent") not in ("error", "room_closed", "timeout") and not self.state.get("fatal")
            return 200, self._body(ok)

    def http_wait(self, target, timeout_s):
        deadline = None if timeout_s is None else time.monotonic() + timeout_s
        with self.cond:
            while not self._matched(target):
                if timeout_s == 0:
                    return 408, self._body(False, error="timeout", event="timeout")
                remain = None
                if deadline is not None:
                    remain = deadline - time.monotonic()
                    if remain <= 0:
                        return 408, self._body(False, error="timeout", event="timeout")
                self.cond.wait(remain)
            ok = self.state.get("lastEvent") not in ("error", "room_closed", "timeout") and not self.state.get("fatal")
            return 200, self._body(ok)

    def _wake(self):
        try:
            os.write(self.wake_w, b"\x00")
        except OSError:
            pass

    def submit(self, kind, payload):
        box = {"kind": kind, "payload": payload, "event": threading.Event(), "status": 500, "body": None, "exit_code": None}
        with self.lock:
            self.inbox.append(box)
        self._wake()
        box["event"].wait()
        return box["status"], box["body"], box["exit_code"]

    def _move_error(self, row, col):
        if self.state.get("result") is not None or self.state.get("lastEvent") == "game_over":
            return "game is over"
        if self.state.get("awaitingAck"):
            return "not your turn"
        for action in self.state.get("legalActions") or []:
            if isinstance(action, dict) and action.get("row") == row and action.get("col") == col:
                return ""
        return "move is not in legalActions"

    def _finish_box(self, box, status, body, exit_code=None):
        box["status"] = status
        box["body"] = body
        box["exit_code"] = exit_code
        box["event"].set()
        if exit_code is not None:
            self._schedule_exit(exit_code)

    def _schedule_exit(self, code):
        with self.lock:
            if self.exit_scheduled:
                return
            self.exit_scheduled = True
            self.exit_code = code
            self.stopping = True

        def go():
            time.sleep(0.05)
            try:
                self.client.close()
            except Exception:
                pass
            httpd = self.httpd
            if httpd is not None:
                httpd.shutdown()

        threading.Thread(target=go, daemon=True).start()

    def _start_box(self, box):
        kind = box["kind"]
        if kind == "move":
            row = box["payload"]["row"]
            col = box["payload"]["col"]
            with self.lock:
                reason = self._move_error(row, col)
                if reason:
                    self._finish_box(box, 400, self._body(False, error=reason))
                    return
                self.state["awaitingAck"] = True
            mark = self.client.high_water()
            with self.lock:
                self.state["moveMark"] = mark
            self.client.send_msg("move", {"row": row, "col": col})
            with self.lock:
                self.pending = {"kind": "move", "mark": mark, "box": box}
            return
        if kind == "seat":
            mark = self.client.high_water()
            self.client.send_msg("claim_seat", {"seat": box["payload"]})
            with self.lock:
                self.pending = {"kind": "seat", "mark": mark, "box": box}
            return
        if kind == "config":
            with self.lock:
                you = self.state.get("you") if isinstance(self.state.get("you"), dict) else {}
                phase = self.state.get("phase")
                if not can_configure(you, phase):
                    message = config_blocked_reason(you, phase)
                    self._emit_held(self.args, self.state, "error", {"ok": False, "error": message})
                    self._finish_box(box, 409, self._body(False, error=message), 1)
                    return
            mark = self.client.high_water()
            self.client.queue = [msg for msg in self.client.queue if msg.get("type") != "room" or msg.get("_seq", 0) > mark]
            self.client.send_msg("set_config", box["payload"])
            with self.lock:
                self.pending = {"kind": "config", "mark": mark, "box": box}
            return
        with self.lock:
            self._finish_box(box, 500, self._body(False, error="unknown command"))

    def _take_pending(self, kind, seq):
        pending = self.pending
        if not pending or pending["kind"] != kind or seq <= pending["mark"]:
            return None
        self.pending = None
        return pending["box"]

    def _fail_open(self, status, body, exit_code):
        pending = self.pending
        self.pending = None
        if pending:
            self._finish_box(pending["box"], status, body, exit_code)
        while self.inbox:
            self._finish_box(self.inbox.pop(0), status, body, exit_code)

    def _fill_result(self, move_msg):
        over = None
        for index, msg in enumerate(self.client.queue):
            if msg.get("type") == "game_over":
                over = self.client.queue.pop(index)
                break
        if over is None:
            try:
                over = self.client.wait_for(lambda msg: msg.get("type") == "game_over", time.monotonic() + 0.8)
            except (TimeoutError, socket.timeout, TransportError):
                over = None
        payload = over.get("payload") if isinstance(over, dict) and isinstance(over.get("payload"), dict) else {}
        from_move = move_msg.get("payload") if isinstance(move_msg.get("payload"), dict) else {}
        public = from_move.get("publicState") if isinstance(from_move.get("publicState"), dict) else {}
        full = public.get("fullState") if isinstance(public.get("fullState"), dict) else {}
        with self.lock:
            self.state["result"] = {
                "winner": payload.get("winner", full.get("winner")),
                "winnerColor": payload.get("winnerColor"),
                "winReason": payload.get("winReason", full.get("winReason")),
            }
            self.state["legalActions"] = []

    def _apply(self, msg):
        kind = msg.get("type")
        payload = msg.get("payload") if isinstance(msg.get("payload"), dict) else {}
        seq = msg.get("_seq", 0)
        if kind == "state":
            with self.lock:
                frames = payload.get("animationFrames")
                if isinstance(frames, list):
                    self.state["effects"] = effects_from_frames(frames, _board_size(self.state, payload))
            return
        if kind == "room":
            with self.lock:
                if isinstance(payload.get("phase"), str):
                    self.state["phase"] = payload.get("phase")
                box = self._take_pending("config", seq)
                if box:
                    self._finish_box(box, 200, self._body(True))
            return
        if kind == "seated":
            with self.lock:
                self.state["you"] = you_from_seat(self.state.get("you"), payload)
                self._emit_held(self.args, self.state, "seated", {"ok": True})
                box = self._take_pending("seat", seq)
                if box:
                    self._finish_box(box, 200, self._body(True))
            return
        if kind == "error":
            message = str(payload.get("message") or "error")
            with self.lock:
                box = self._take_pending("config", seq)
                if box:
                    self._emit_held(self.args, self.state, "error", {"ok": False, "error": message})
                    self._finish_box(box, 409, self._body(False, error=message), 1)
                    return
                box = self._take_pending("seat", seq)
                if box:
                    self._emit_held(self.args, self.state, "error", {"ok": False, "error": message})
                    self._finish_box(box, 409, self._body(False, error=message))
                    return
                box = self._take_pending("move", seq)
                if box:
                    self.state["awaitingAck"] = False
                    self._emit_held(self.args, self.state, "error", {"ok": False, "error": message})
                    self._finish_box(box, 400, self._body(False, error=message))
                    return
                self._emit_held(self.args, self.state, "error", {"ok": False, "error": message})
            return
        if kind == "move_applied":
            by = payload.get("by") if isinstance(payload.get("by"), dict) else {}
            player = by.get("playerId")
            ours = isinstance(player, str) and player == self.args.player_id
            if payload.get("gameOver") is True:
                self._fill_result(msg)
                with self.lock:
                    self.state["awaitingAck"] = False
                    if isinstance(player, str) and player != self.args.player_id:
                        self.state["lastOpponentMove"] = payload.get("action")
                    apply_public(self.state, payload.get("publicState"))
                    apply_effects(self.state, payload.get("effects"))
                    found = opponent_move(self.client.seen, self.args.player_id)
                    if found is not None:
                        self.state["lastOpponentMove"] = found
                    self._emit_held(self.args, self.state, "game_over", {"ok": True})
                    box = self.pending["box"] if self.pending and self.pending["kind"] == "move" else None
                    self.pending = None
                    if box:
                        self._finish_box(box, 200, self._body(True), 0)
                    else:
                        self._schedule_exit(0)
                return
            with self.lock:
                if isinstance(player, str) and player != self.args.player_id:
                    self.state["lastOpponentMove"] = payload.get("action")
                apply_public(self.state, payload.get("publicState"))
                apply_effects(self.state, payload.get("effects"))
                box = self._take_pending("move", seq) if ours else None
                if box:
                    self.state["awaitingAck"] = False
                    self.state["legalActions"] = []
                    self.state["lastEvent"] = "move_applied"
                    self.state["errorText"] = None
                    self._finish_box(box, 200, self._body(True))
                    self.cond.notify_all()
                    return
                if is_spectator(self.state):
                    action = payload.get("action")
                    if action is not None:
                        self.state["lastOpponentMove"] = action
                    self._emit_held(self.args, self.state, "watch", {"ok": True})
                    return
                if isinstance(player, str) and player != self.args.player_id:
                    self._emit_held(self.args, self.state, "opponent", {"ok": True})
            return
        if kind == "your_turn":
            with self.lock:
                if self.state.get("awaitingAck"):
                    applied = our_apply_seq(self.client.seen, self.args.player_id, self.state.get("moveMark") or 0)
                    if not (applied > 0 and seq > applied):
                        return
                self.state["awaitingAck"] = False
                apply_observation(self.state, payload.get("observation"))
                found = opponent_move(self.client.seen, self.args.player_id)
                if found is not None:
                    self.state["lastOpponentMove"] = found
                self._emit_held(self.args, self.state, "your_turn", {"ok": True})
            return
        if kind == "game_over":
            with self.lock:
                self.state["result"] = {
                    "winner": payload.get("winner"),
                    "winnerColor": payload.get("winnerColor"),
                    "winReason": payload.get("winReason"),
                }
                self.state["legalActions"] = []
                self.state["awaitingAck"] = False
                found = opponent_move(self.client.seen, self.args.player_id)
                if found is not None:
                    self.state["lastOpponentMove"] = found
                self._emit_held(self.args, self.state, "game_over", {"ok": True})
                box = self._take_pending("move", seq)
                if box:
                    self._finish_box(box, 200, self._body(True), 0)
                else:
                    self._schedule_exit(0)
            return
        if kind == "room_closed":
            with self.lock:
                self._emit_held(self.args, self.state, "room_closed", {"ok": False, "error": "Room closed"})
                body = self._body(False, error="Room closed")
                self._fail_open(409, body, 1)
            return
        if kind == "observation":
            with self.lock:
                obs = payload.get("observation") if isinstance(payload.get("observation"), dict) else payload
                apply_observation(self.state, obs)

    def _fatal(self, exc):
        if self.exit_scheduled:
            return
        message = str(exc)
        event = "timeout" if "timeout" in message.lower() and "websocket closed" not in message.lower() else "error"
        extra = disconnect_extra(message)
        extra["ok"] = False
        with self.lock:
            self.state["fatal"] = True
            self._emit_held(self.args, self.state, event, extra)
            body = self._body(False, error=extra.get("error") or message)
            self._fail_open(500, body, 1)

    def _read_one(self):
        deadline = None if self.args.budget is None else time.monotonic() + self.args.budget
        while not self.stopping:
            self.client.drain_available()
            if self.client.queue:
                return self.client.queue.pop(0)
            if self.client.closed or self.client.sock is None:
                return CLOSED
            slice_s = KEEPALIVE_S
            if deadline is not None:
                remain = deadline - time.monotonic()
                if remain <= 0:
                    return TIMEOUT
                slice_s = min(slice_s, remain)
            try:
                readable, _, _ = select.select([self.client.sock, self.wake_r], [], [], slice_s)
            except (ValueError, OSError):
                return CLOSED
            if self.wake_r in readable:
                try:
                    os.read(self.wake_r, 65536)
                except OSError:
                    pass
                if self.client.sock not in readable:
                    return WAKE
            if self.client.sock in readable:
                continue
            if not readable:
                if deadline is not None and deadline - time.monotonic() <= 0:
                    return TIMEOUT
                try:
                    self.client.keepalive()
                except TransportError:
                    return CLOSED
        return CLOSED

    def pump(self):
        try:
            while not self.stopping:
                box = None
                with self.lock:
                    if self.pending is None and self.inbox:
                        box = self.inbox.pop(0)
                if box is not None:
                    try:
                        self._start_box(box)
                    except Exception as exc:
                        with self.lock:
                            self._finish_box(box, 400, self._body(False, error=str(exc)))
                    continue
                item = self._read_one()
                if item is WAKE:
                    continue
                if item is TIMEOUT:
                    self._fatal(TimeoutError("timeout"))
                    return
                if item is CLOSED:
                    self._fatal(TransportError("websocket closed"))
                    return
                try:
                    self._apply(item)
                except Exception as exc:
                    self._fatal(exc)
                    return
        except Exception as exc:
            self._fatal(exc)

    def serve(self):
        handler = make_handler(self)
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        httpd.daemon_threads = True
        self.httpd = httpd
        self.port = httpd.server_address[1]
        self.base = "http://127.0.0.1:%s" % self.port
        self.emit(self.args, self.state, "listening", {"ok": True, "port": self.port, "base": self.base})
        thread = threading.Thread(target=self.pump, name="explosive-chess-ws")
        thread.daemon = True
        thread.start()
        try:
            httpd.serve_forever()
        finally:
            self.stopping = True
            self.client.close()
        raise SystemExit(self.exit_code)


def _json_object(text, label):
    if not text or not str(text).strip():
        raise CliError("%s must be a JSON object" % label)
    try:
        value = json.loads(text)
    except ValueError:
        raise CliError("%s must be a JSON object" % label)
    if not isinstance(value, dict):
        raise CliError("%s must be a JSON object" % label)
    return value


def _parse_timeout(raw):
    if raw is None or raw == "":
        return None
    try:
        value = float(raw)
    except ValueError:
        raise CliError("timeout must be a non-negative number of seconds")
    if value < 0 or value != value:
        raise CliError("timeout must be a non-negative number of seconds")
    return min(value, 86400)


def make_handler(session):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def setup(self):
            BaseHTTPRequestHandler.setup(self)
            try:
                self.connection.settimeout(None)
            except OSError:
                pass

        def log_message(self, fmt, *args):
            return

        def _write(self, status, obj):
            raw = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            self.send_response(status)
            self.send_header("content-type", "application/json; charset=utf-8")
            self.send_header("content-length", str(len(raw)))
            self.send_header("cache-control", "no-store")
            self.end_headers()
            self.wfile.write(raw)

        def _read_body(self):
            try:
                length = int(self.headers.get("Content-Length", "0") or "0")
            except ValueError:
                length = 0
            if length < 0 or length > 65536:
                raise CliError("body too large")
            if length == 0:
                return ""
            return self.rfile.read(length).decode("utf-8", "replace")

        def do_GET(self):
            self._route("GET")

        def do_POST(self):
            self._route("POST")

        def do_PUT(self):
            self._route("PUT")

        def do_DELETE(self):
            self._route("DELETE")

        def _route(self, method):
            try:
                parsed = urlparse(self.path)
                route = parsed.path
                known = route in ("/state", "/wait", "/move", "/seat", "/config", "/shutdown")
                if not known:
                    self._write(404, {"ok": False, "error": "not found"})
                    return
                if method == "GET" and route == "/state":
                    status, body = session.http_state()
                    self._write(status, body)
                    return
                if method == "GET" and route == "/wait":
                    query = parse_qs(parsed.query)
                    target = (query.get("event") or ["your_turn"])[0] or "your_turn"
                    timeout_raw = (query.get("timeout") or [None])[0]
                    status, body = session.http_wait(target, _parse_timeout(timeout_raw))
                    self._write(status, body)
                    return
                if method == "POST" and route == "/shutdown":
                    with session.lock:
                        body = session._body(True, event="shutdown")
                    body["event"] = "shutdown"
                    body["ok"] = True
                    self._write(200, body)
                    session._schedule_exit(0)
                    return
                if method == "POST" and route in ("/move", "/seat", "/config"):
                    text = self._read_body()
                    if route == "/move":
                        value = _json_object(text, "move")
                        row = value.get("row")
                        col = value.get("col")
                        if not _is_int(row) or not _is_int(col) or row < 0 or col < 0:
                            raise CliError("move requires non-negative integer row and col")
                        status, body, exit_code = session.submit("move", {"row": row, "col": col})
                    elif route == "/seat":
                        value = _json_object(text, "seat")
                        seat = value.get("seat")
                        seat = seat.strip().lower() if isinstance(seat, str) else ""
                        if seat not in ("red", "blue"):
                            raise CliError("seat must be red or blue")
                        status, body, exit_code = session.submit("seat", seat)
                    else:
                        status, body, exit_code = session.submit("config", _json_object(text, "config"))
                    self._write(status, body)
                    if exit_code is not None:
                        session._schedule_exit(exit_code)
                    return
                self._write(405, {"ok": False, "error": "method not allowed"})
            except CliError as exc:
                with session.lock:
                    body = session._body(False, error=str(exc))
                self._write(400, body)
            except Exception as exc:
                try:
                    self._write(500, {"ok": False, "error": str(exc)})
                except Exception:
                    pass

    return Handler


def startup_emit(args, state, event, extra=None):
    extra = extra or {}
    if event != "listening":
        state["lastEvent"] = event
        state["errorText"] = extra.get("error")
        state["recoverable"] = extra.get("recoverable") is True
        state["hint"] = extra.get("hint")
    you = state.get("you") if isinstance(state.get("you"), dict) else {}
    line = {
        "event": event,
        "ok": extra.get("ok", True) is not False,
        "you": state.get("you"),
        "lastOpponentMove": state.get("lastOpponentMove"),
        "legalActions": state.get("legalActions") or [],
        "turn": state.get("turn"),
        "roomCode": state.get("roomCode"),
    }
    if event == "joined":
        line["playerId"] = args.player_id
        line["reclaimed"] = state.get("reclaimed")
        line["reusedRoom"] = state.get("reusedRoom") is True
        line["canConfig"] = you.get("canConfig") is True
        line["playUrl"] = state.get("playUrl")
        line["phase"] = state.get("phase")
    if event == "seated":
        line["canConfig"] = you.get("canConfig") is True
    if event == "game_over":
        line["result"] = state.get("result")
    if extra.get("error"):
        line["error"] = extra["error"]
    if extra.get("recoverable") is True:
        line["recoverable"] = True
    if extra.get("hint"):
        line["hint"] = extra["hint"]
    if extra.get("ok") is False:
        line["ok"] = False
    line.update(observation_fields(state))
    write_line(line)


def main():
    args = parse_args(sys.argv)
    if args.help:
        sys.stdout.write(HELP)
        raise SystemExit(0)
    normalize(args)
    state = blank_state(args)
    client = None
    try:
        client, joined = connect_and_join(args)
        state = state_from_joined(args, joined)
        startup_emit(args, state, "joined", {"ok": True})
        maybe_config(client, joined, args.config)
        maybe_claim(client, args, state, startup_emit)
        client.drain_available()
        if is_spectator(state):
            startup_emit(args, state, "spectator", {"ok": True})
        session = Session(client, args, state)
        session.serve()
    except SystemExit:
        raise
    except (CliError, TransportError, TimeoutError, socket.timeout, OSError) as exc:
        message = str(exc)
        event = "timeout" if "timeout" in message.lower() and "websocket closed" not in message.lower() else "error"
        extra = disconnect_extra(message)
        extra["ok"] = False
        startup_emit(args, state, event, extra)
        if client is not None:
            client.close()
        raise SystemExit(1)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:
        fail(str(exc))
