import { useState } from "react";

function roomSocketUrl(roomId: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/${encodeURIComponent(roomId)}`;
}

export function RoomsPage() {
  const [roomId, setRoomId] = useState("mist-demo");
  const [message, setMessage] = useState("hello");
  const [log, setLog] = useState<string[]>([
    "多人玩法尚未接入。下面的探测只验证 /ws/:roomId 能否升级到 GameRoom Durable Object。",
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
          Future multiplayer: one Durable Object per room, Hibernation WebSockets,
          in-memory room state that disappears with the room. No accounts, no D1/KV/R2.
        </p>
      </section>

      <section className="panel">
        <h2>Upgrade path</h2>
        <p>
          The Worker only runs for <code>/ws</code> and <code>/ws/:roomId</code> (
          <code>run_worker_first</code>). Everything else is a free Static Assets SPA
          hit. A room stub accepts the upgrade with <code>ctx.acceptWebSocket</code>{" "}
          and echoes JSON. Gameplay sync is intentionally not implemented yet.
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
