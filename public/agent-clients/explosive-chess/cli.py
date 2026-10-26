#!/usr/bin/env python3
"""Official explosive-chess interactive client. No chess strength.

One process is the whole match. It joins as kind "agent", prints one JSON
line per event, and sends the move you type on stdin. It never picks a move.
It exits when event is game_over, or on a fatal disconnect.

Standard library only. Written for common Python 3.8+ interpreters.
Stdout is one JSON object per line. Diagnostics go to stderr.
--poll is the one-shot fallback for environments that cannot hold this session.

  python3 cli.py --origin https://HOST --seat red create_room
  python3 cli.py --origin https://HOST --seat red create_room -c CODE
  python3 cli.py --origin https://HOST --seat blue join_room -c CODE
  python3 cli.py --url wss://HOST/ws/explosive-chess:CODE --seat red claim_seat -c CODE
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
ABORT = object()
STDIN_EOF = object()
TIMED_OUT = object()
KEEPALIVE_S = 20
RECONNECT_HINT = "Reconnect with the same --player-id and claim the same seat."

HELP = """explosive-chess official interactive client (no chess strength)

One process is the whole match. It joins as kind "agent", prints one JSON
line per event, and reads the move you type on stdin. It does not choose
moves. It exits when event is game_over, or on a fatal disconnect.
Do not wrap it in a solver, search tree, or auto-play loop.
The one-shot client that exited after a single your_turn is retired.

  python3 cli.py --origin https://HOST --seat red create_room
  python3 cli.py --origin https://HOST --seat red create_room -c CODE
  python3 cli.py --origin https://HOST --seat blue join_room -c CODE
  python3 cli.py --url wss://HOST/ws/explosive-chess:CODE --seat red claim_seat -c CODE

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
  --verbose     Include board on each JSON line
  --timeout     Seconds to block for one server push. Omit to wait until game_over
  --poll        One-shot fallback. Prints one JSON line and exits. Accepts --move ROW,COL
  --move        Poll only. ROW,COL you already chose. Interactive play types this on stdin
  --help

Join does not take a seat. Pass --seat red or --seat blue to play.
The same playerId reclaims red, blue, or spectator. A new id is a new person.
Omit --player-id to use ~/.config/micromist/explosive-chess-player-id
(or $XDG_CONFIG_HOME/micromist/explosive-chess-player-id). Passing --player-id
does not replace that file. A second agent on this machine passes its own id.
Interactive stdin is one move per line: ROW,COL or {"row":ROW,"col":COL}, ended by a newline or a carriage return.
A second Enter is not required. Stdout is one JSON object per line. Diagnostics go to stderr.
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
        # Text frame "ping" is answered by the room auto-response ("pong").
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


def parse_cell(text, label):
    parts = text.strip().split(",")
    if len(parts) != 2:
        raise CliError("%s must be ROW,COL using non-negative integers" % label)
    row_text = parts[0].strip()
    col_text = parts[1].strip()
    if not row_text.isdigit() or not col_text.isdigit():
        raise CliError("%s must be ROW,COL using non-negative integers" % label)
    return int(row_text), int(col_text)


def parse_stdin_move(text):
    trimmed = text.strip()
    if not trimmed:
        return None
    if trimmed.startswith("{"):
        try:
            value = json.loads(trimmed)
        except ValueError:
            raise CliError("stdin move must be ROW,COL or compact JSON")
        if not isinstance(value, dict):
            raise CliError("stdin move must be ROW,COL or compact JSON")
        row = value.get("row")
        col = value.get("col")
        if isinstance(row, bool) or isinstance(col, bool):
            raise CliError("stdin JSON move needs non-negative integer row and col")
        if not isinstance(row, int) or not isinstance(col, int) or row < 0 or col < 0:
            raise CliError("stdin JSON move needs non-negative integer row and col")
        return row, col
    return parse_cell(trimmed, "stdin move")


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
        self.poll = False
        self.verbose = False
        self.origin = ""
        self.url = ""
        self.player_id = ""
        self.name = "Agent"
        self.move_text = None
        self.move = None
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
        elif flag == "--poll":
            args.poll = True
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
        elif flag == "--move":
            args.move_text = take()
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
    if args.move_text is not None and not args.poll:
        raise CliError("--move is only valid with --poll. Type ROW,COL on stdin.")
    if args.move_text is not None:
        cell = parse_cell(args.move_text, "--move")
        args.move = {"row": cell[0], "col": cell[1]}
    if args.timeout is None:
        args.budget = 20 if args.poll else None
    elif args.timeout == 0:
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
    # canConfig is the server bit (playerId == hostId). role "host" must not
    # override an explicit false. Missing canConfig keeps the older role fallback.
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
        message = str(body.get("message") or "set_config failed")
        raise CliError(message)


def blank_state(args):
    return {
        "roomCode": args.code or None,
        "you": None,
        "turn": None,
        "legalActions": [],
        "lastOpponentMove": None,
        "board": None,
        "phase": None,
        "reclaimed": None,
        "reusedRoom": False,
        "playUrl": "%s/play/explosive-chess?room=%s" % (http_origin_from(args), args.code),
        "result": None,
        "moveMark": 0,
        "awaitingAck": False,
    }


def maybe_claim(client, args, state, quiet=False):
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
    if not quiet:
        emit(args, state, "seated", {"ok": True})


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


def emit(args, state, event, extra=None):
    extra = extra or {}
    line = {
        "event": event,
        "ok": extra.get("ok", True) is not False,
        "you": state.get("you"),
        "lastOpponentMove": state.get("lastOpponentMove"),
        "legalActions": state.get("legalActions") or [],
        "turn": state.get("turn"),
        "roomCode": state.get("roomCode"),
    }
    you = state.get("you") if isinstance(state.get("you"), dict) else {}
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
    if extra.get("mode"):
        line["mode"] = extra["mode"]
    if "yourTurn" in extra:
        line["yourTurn"] = extra["yourTurn"]
    if args.verbose:
        line["board"] = state.get("board")
    # ok False must stick when the caller passed it. The default above treats missing ok as True.
    if extra.get("ok") is False:
        line["ok"] = False
    write_line(line)


def apply_public(state, public):
    if not isinstance(public, dict):
        return
    if "turn" in public:
        state["turn"] = public.get("turn")
    if "board" in public:
        state["board"] = public.get("board")


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


def is_terminal(msg):
    if not isinstance(msg, dict):
        return False
    if msg.get("type") in ("game_over", "room_closed"):
        return True
    if msg.get("type") != "move_applied":
        return False
    payload = msg.get("payload") if isinstance(msg.get("payload"), dict) else {}
    return payload.get("gameOver") is True


def fatal_queued(client):
    if client.closed:
        return True
    for msg in client.queue:
        if is_terminal(msg):
            return True
    return False


def relevant(client, args, state, msg):
    kind = msg.get("type")
    if kind in ("game_over", "room_closed"):
        return True
    if kind == "move_applied":
        if state["awaitingAck"] and msg.get("_seq", 0) <= state["moveMark"]:
            return False
        return True
    if kind == "error":
        return state["awaitingAck"] and msg.get("_seq", 0) > state["moveMark"]
    if kind == "your_turn":
        if not state["awaitingAck"]:
            return True
        if msg.get("_seq", 0) <= state["moveMark"]:
            return False
        applied = our_apply_seq(client.seen, args.player_id, state["moveMark"])
        return applied > 0 and msg.get("_seq", 0) > applied
    return False


def deadline_for(budget):
    if budget is None:
        return None
    return time.monotonic() + budget


def complete_stdin_move(text):
    if not text or not str(text).strip():
        return False
    try:
        return parse_stdin_move(text) is not None
    except CliError:
        return False


def disconnect_extra(message):
    text = str(message)
    if "websocket closed" in text.lower():
        return {"ok": False, "error": "websocket closed", "recoverable": True, "hint": RECONNECT_HINT}
    return {"ok": False, "error": text}


class StdinBuf(object):
    def __init__(self):
        self.text = ""
        self.eof = False
        self.skip_lf = False
        self.fd = sys.stdin.fileno()
        self.non_tty = not os.isatty(self.fd)
        # A buffered TextIOWrapper plus select() holds the first line until more
        # bytes arrive. Read the fd directly, and treat CR as its own newline.
        try:
            os.set_blocking(self.fd, False)
        except (AttributeError, OSError):
            pass

    def push(self, text):
        if self.skip_lf:
            if text.startswith("\n"):
                text = text[1:]
            self.skip_lf = False
        if text:
            self.text += text

    def pop_line(self):
        text = self.text
        n = text.find("\n")
        r = text.find("\r")
        if n < 0 and r < 0:
            return None
        if r >= 0 and (n < 0 or r < n):
            line = text[:r]
            rest = text[r + 1 :]
            if rest.startswith("\n"):
                rest = rest[1:]
                self.skip_lf = False
            elif rest == "":
                self.skip_lf = True
            else:
                self.skip_lf = False
            self.text = rest
            return line
        self.skip_lf = False
        self.text = text[n + 1 :]
        return text[:n]


def read_stdin_or_push(client, stdin_buf, budget):
    deadline = deadline_for(budget)
    while True:
        if fatal_queued(client):
            return ABORT
        got = stdin_buf.pop_line()
        if got is not None:
            if fatal_queued(client):
                return ABORT
            return got
        if stdin_buf.eof:
            if stdin_buf.text:
                line = stdin_buf.text
                stdin_buf.text = ""
                return line
            return STDIN_EOF
        if stdin_buf.non_tty and complete_stdin_move(stdin_buf.text):
            try:
                ready, _, _ = select.select([stdin_buf.fd], [], [], 0)
            except (ValueError, OSError):
                ready = []
            if stdin_buf.fd not in ready:
                line = stdin_buf.text
                stdin_buf.text = ""
                return line
        slice_s = KEEPALIVE_S
        if deadline is not None:
            remain = deadline - time.monotonic()
            if remain <= 0:
                return TIMED_OUT
            slice_s = min(KEEPALIVE_S, remain)
        try:
            readable, _, _ = select.select([client.sock, stdin_buf.fd], [], [], slice_s)
        except (ValueError, OSError) as exc:
            raise TransportError("websocket closed: %s" % exc)
        if not readable:
            if deadline is not None and deadline - time.monotonic() <= 0:
                return TIMED_OUT
            client.keepalive()
            continue
        if client.sock in readable:
            client.drain_available()
        if stdin_buf.fd in readable:
            try:
                data = os.read(stdin_buf.fd, 4096)
            except OSError as exc:
                if _would_block(exc):
                    continue
                raise TransportError("stdin read failed: %s" % exc)
            if not data:
                stdin_buf.eof = True
            else:
                stdin_buf.push(data.decode("utf-8", "replace"))


def prompt_and_send(client, stdin_buf, args, state):
    while True:
        if fatal_queued(client):
            return "abort"
        line = read_stdin_or_push(client, stdin_buf, args.budget)
        if line is ABORT or fatal_queued(client):
            return "abort"
        if line is TIMED_OUT:
            return "timeout"
        if line is STDIN_EOF or line is None:
            return "stdin-closed"
        try:
            move = parse_stdin_move(line)
        except CliError as exc:
            emit(args, state, "error", {"ok": False, "error": str(exc)})
            continue
        if move is None:
            continue
        state["moveMark"] = client.high_water()
        state["awaitingAck"] = True
        client.send_msg("move", {"row": move[0], "col": move[1]})
        return "sent"


def fill_result(client, state, move_msg):
    over = None
    for index, msg in enumerate(client.queue):
        if msg.get("type") == "game_over":
            over = client.queue.pop(index)
            break
    if over is None:
        try:
            over = client.wait_for(lambda msg: msg.get("type") == "game_over", time.monotonic() + 0.8)
        except (TimeoutError, socket.timeout, TransportError):
            over = None
    payload = over.get("payload") if isinstance(over, dict) and isinstance(over.get("payload"), dict) else {}
    from_move = move_msg.get("payload") if isinstance(move_msg.get("payload"), dict) else {}
    public = from_move.get("publicState") if isinstance(from_move.get("publicState"), dict) else {}
    full = public.get("fullState") if isinstance(public.get("fullState"), dict) else {}
    state["result"] = {
        "winner": payload.get("winner", full.get("winner")),
        "winnerColor": payload.get("winnerColor"),
        "winReason": payload.get("winReason", full.get("winReason")),
    }
    state["legalActions"] = []


def run_interactive(args):
    client, joined = connect_and_join(args)
    state = state_from_joined(args, joined)
    stdin_buf = StdinBuf()
    try:
        return interactive_session(client, stdin_buf, args, state, joined)
    except (CliError, TransportError, TimeoutError, socket.timeout, OSError) as exc:
        message = str(exc)
        event = "timeout" if "timeout" in message.lower() and "websocket closed" not in message.lower() else "error"
        extra = disconnect_extra(message)
        extra["ok"] = False
        emit(args, state, event, extra)
        return client, 1


def interactive_session(client, stdin_buf, args, state, joined):
    emit(args, state, "joined", {"ok": True})
    maybe_config(client, joined, args.config)
    maybe_claim(client, args, state)
    client.drain_available()
    if is_spectator(state):
        emit(args, state, "spectator", {"ok": True})
    while True:
        try:
            msg = client.wait_for(lambda item: relevant(client, args, state, item), deadline_for(args.budget))
        except TimeoutError:
            emit(args, state, "timeout", {"ok": False, "error": "timeout"})
            return client, 1
        except TransportError as exc:
            emit(args, state, "error", disconnect_extra(exc))
            return client, 1
        kind = msg.get("type")
        payload = msg.get("payload") if isinstance(msg.get("payload"), dict) else {}
        if kind == "game_over":
            state["result"] = {
                "winner": payload.get("winner"),
                "winnerColor": payload.get("winnerColor"),
                "winReason": payload.get("winReason"),
            }
            state["legalActions"] = []
            state["lastOpponentMove"] = opponent_move(client.seen, args.player_id)
            emit(args, state, "game_over", {"ok": True})
            return client, 0
        if kind == "room_closed":
            emit(args, state, "room_closed", {"ok": False, "error": "Room closed"})
            return client, 1
        if kind == "move_applied":
            by = payload.get("by") if isinstance(payload.get("by"), dict) else {}
            player = by.get("playerId")
            if isinstance(player, str) and player != args.player_id:
                state["lastOpponentMove"] = payload.get("action")
            apply_public(state, payload.get("publicState"))
            if payload.get("gameOver") is True:
                fill_result(client, state, msg)
                found = opponent_move(client.seen, args.player_id)
                if found is not None:
                    state["lastOpponentMove"] = found
                emit(args, state, "game_over", {"ok": True})
                return client, 0
            if is_spectator(state):
                action = payload.get("action")
                if action is not None:
                    state["lastOpponentMove"] = action
                emit(args, state, "watch", {"ok": True})
                continue
            if isinstance(player, str) and player != args.player_id:
                emit(args, state, "opponent", {"ok": True})
            continue
        if kind == "error":
            state["awaitingAck"] = False
            emit(args, state, "error", {"ok": False, "error": str(payload.get("message") or "error")})
            status = prompt_and_send(client, stdin_buf, args, state)
            if status == "timeout":
                emit(args, state, "timeout", {"ok": False, "error": "timeout waiting for stdin"})
                return client, 1
            if status == "stdin-closed":
                emit(args, state, "error", {"ok": False, "error": "stdin closed"})
                return client, 1
            continue
        if kind == "your_turn":
            state["awaitingAck"] = False
            apply_observation(state, payload.get("observation"))
            found = opponent_move(client.seen, args.player_id)
            if found is not None:
                state["lastOpponentMove"] = found
            emit(args, state, "your_turn", {"ok": True})
            status = prompt_and_send(client, stdin_buf, args, state)
            if status == "timeout":
                emit(args, state, "timeout", {"ok": False, "error": "timeout waiting for stdin"})
                return client, 1
            if status == "stdin-closed":
                emit(args, state, "error", {"ok": False, "error": "stdin closed"})
                return client, 1
    return client, 1


def finish_poll(args, state, client, msg):
    state["lastOpponentMove"] = opponent_move(client.seen, args.player_id)
    kind = msg.get("type")
    payload = msg.get("payload") if isinstance(msg.get("payload"), dict) else {}
    if kind in ("your_turn", "observation"):
        obs = payload.get("observation")
        apply_observation(state, obs)
        event = "your_turn" if kind == "your_turn" else "observation"
        emit(
            args,
            state,
            event,
            {"ok": True, "mode": "poll", "yourTurn": len(state["legalActions"]) > 0},
        )
        return 0
    if kind == "game_over" or (kind == "move_applied" and payload.get("gameOver") is True):
        state["result"] = {
            "winner": payload.get("winner"),
            "winnerColor": payload.get("winnerColor"),
            "winReason": payload.get("winReason"),
        }
        state["legalActions"] = []
        emit(args, state, "game_over", {"ok": True, "mode": "poll", "yourTurn": False})
        return 0
    if kind == "room_closed":
        emit(args, state, "room_closed", {"ok": False, "mode": "poll", "yourTurn": False, "error": "Room closed"})
        return 1
    emit(
        args,
        state,
        "error",
        {"ok": False, "mode": "poll", "yourTurn": False, "error": str(payload.get("message") or ("unexpected %s" % kind))},
    )
    return 1


def run_poll(args):
    client, joined = connect_and_join(args)
    state = state_from_joined(args, joined)
    try:
        maybe_config(client, joined, args.config)
        maybe_claim(client, args, state, quiet=True)
        client.drain_available()
        if is_spectator(state):
            emit(
                args,
                state,
                "spectator",
                {"ok": True, "mode": "poll", "yourTurn": False},
            )
            return client, 0
        ack = 20 if not args.budget else min(args.budget, 20)
        if args.move is None:
            mark = client.high_water()
            client.send_msg("observe", {})
            msg = client.wait_for(
                lambda item: item.get("_seq", 0) > mark
                and item.get("type") in ("observation", "error", "game_over", "room_closed"),
                time.monotonic() + ack,
            )
            return client, finish_poll(args, state, client, msg)
        for item in list(client.queue):
            if item.get("type") == "game_over":
                client.queue = [msg for msg in client.queue if msg is not item]
                return client, finish_poll(args, state, client, item)
        mark = client.high_water()
        client.send_msg("move", {"row": args.move["row"], "col": args.move["col"]})
        got = client.wait_for(
            lambda item: item.get("_seq", 0) > mark
            and item.get("type") in ("error", "move_applied", "game_over", "room_closed"),
            time.monotonic() + ack,
        )
        if got.get("type") != "move_applied":
            return client, finish_poll(args, state, client, got)
        client.drain_available()
        for item in client.queue:
            if item.get("type") == "game_over":
                return client, finish_poll(args, state, client, item)
        observe_mark = client.high_water()
        client.send_msg("observe", {})
        msg = client.wait_for(
            lambda item: item.get("_seq", 0) > observe_mark
            and item.get("type") in ("observation", "error", "game_over", "room_closed"),
            time.monotonic() + ack,
        )
        return client, finish_poll(args, state, client, msg)
    except (CliError, TransportError, TimeoutError, socket.timeout, OSError) as exc:
        message = str(exc)
        event = "timeout" if "timeout" in message.lower() and "websocket closed" not in message.lower() else "error"
        extra = disconnect_extra(message)
        extra["ok"] = False
        extra["mode"] = "poll"
        extra["yourTurn"] = False
        emit(args, state, event, extra)
        return client, 1


def main():
    args = parse_args(sys.argv)
    if args.help:
        sys.stdout.write(HELP)
        raise SystemExit(0)
    normalize(args)
    client = None
    try:
        if args.poll:
            client, code = run_poll(args)
        else:
            client, code = run_interactive(args)
    finally:
        if client is not None:
            client.close()
    raise SystemExit(code)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:
        fail(str(exc))
