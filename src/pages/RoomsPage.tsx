import { useState } from "react";
import { Link } from "react-router";

function roomSocketUrl(roomId: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/${encodeURIComponent(roomId)}`;
}

export function RoomsPage() {
  const [roomId, setRoomId] = useState("mist-demo");
  const [message, setMessage] = useState("hello");
  const [log, setLog] = useState<string[]>([
    "爆炸棋联机已接入 GameRoom。下面的探测仍可验证 /ws/:roomId 升级；游戏请用爆炸棋页面的创建/加入房间。",
  ]);
  const [socket, setSocket] = useState<WebSocket | null>(null);

  const append = (line: string) => {
    setLog((current) => [...current.slice(-40), line]);
  };

  const connect = () => {
    if (socket) {
      socket.close();
    }
    const next = new WebSocket(roomSocketUrl(roomId.trim() || "mist-demo"));
    next.addEventListener("open", () => append(`opened ${next.url}`));
    next.addEventListener("message", (event) => append(`← ${String(event.data)}`));
    next.addEventListener("close", (event) => {
      append(`closed ${event.code} ${event.reason}`.trim());
      setSocket(null);
    });
    next.addEventListener("error", () => append("socket error"));
    setSocket(next);
  };

  const send = () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      append("not connected");
      return;
    }
    socket.send(message);
    append(`→ ${message}`);
  };

  return (
    <>
      <section className="hero">
        <h1>同雾房间</h1>
        <p className="lede">
          Explosive Chess online uses one Durable Object per room with Hibernation
          WebSockets; room state is in-memory and dies with the room. No accounts,
          no D1/KV/R2.{" "}
          <Link to="/play/explosive-chess">去爆炸棋联机 →</Link>
        </p>
      </section>

      <section className="panel">
        <h2>Upgrade path</h2>
        <p>
          The Worker only runs for <code>/ws</code> and <code>/ws/:roomId</code> (
          <code>run_worker_first</code>). Everything else is a free Static Assets SPA
          hit. A room stub accepts the upgrade with <code>ctx.acceptWebSocket</code>{" "}
          and runs the Explosive Chess protocol (join / ready / move). Prefer the in-game lobby over this probe.
        </p>
        <pre className="log">{`GET /ws/:roomId
Upgrade: websocket

→ GameRoom (Durable Object, new_sqlite_classes)
  acceptWebSocket + webSocketMessage / webSocketClose
  in-memory sessions; no user database`}</pre>
      </section>

      <section className="panel">
        <h3>Probe the stub</h3>
        <div className="row">
          <input
            type="text"
            value={roomId}
            onChange={(event) => setRoomId(event.target.value)}
            aria-label="Room id"
            placeholder="room id"
          />
          <input
            type="text"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            aria-label="Message"
            placeholder="message"
          />
          <button type="button" className="primary" onClick={connect}>
            Connect
          </button>
          <button type="button" className="ghost" onClick={send}>
            Send
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => socket?.close()}
            disabled={!socket}
          >
            Close
          </button>
        </div>
        <pre className="log">{log.join("\n")}</pre>
      </section>
    </>
  );
}
