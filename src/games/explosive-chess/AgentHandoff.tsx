import { useState } from "react";
import { generateRoomCode } from "../../../shared/multiplayer";
import {
  explosiveChessGuideUrl,
  explosiveChessRoomEndpoints,
} from "../../../shared/explosive-chess/agent-guide";
import {
  freshAgentId,
  promptDualGuest,
  promptDualHost,
  promptHumanOpponent,
  type AgentMatchRules,
} from "../../../shared/explosive-chess/agent-handoff";
import type { Phase, RoomPlayer, Seat } from "./online";

type PhaseLike = Phase | "idle" | "connecting" | "reconnecting";

export type AgentHandoffProps = {
  ex: Record<string, string>;
  roomCode: string;
  onlinePhase: PhaseLike;
  onlineSeat: Seat;
  onlinePlayers: RoomPlayer[];
  roomFromQuery: string;
  rules: AgentMatchRules;
};

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the selection copy below.
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.left = "0";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.focus();
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

function PromptPreview({ label, text }: { label: string; text: string }) {
  return (
    <details>
      <summary>{label}</summary>
      <pre className="agent-prompt-preview">{text}</pre>
    </details>
  );
}

export function AgentHandoff({
  ex,
  roomCode,
  onlinePhase,
  onlineSeat,
  onlinePlayers,
  roomFromQuery,
  rules,
}: AgentHandoffProps) {
  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost";
  const guideUrl = explosiveChessGuideUrl(origin);
  const inviteCode = roomCode.trim().toLowerCase();
  const seatedCount = onlinePlayers.filter((p) => p.seat === "red" || p.seat === "blue").length;
  const knownFull = seatedCount >= 2;
  const canInvite = inviteCode.length > 0 && !knownFull;
  const humanSeated =
    onlineSeat === "red" ||
    onlineSeat === "blue" ||
    onlinePhase === "connecting" ||
    roomFromQuery.length > 0;
  const invite = inviteCode ? explosiveChessRoomEndpoints(origin, inviteCode) : null;

  const [guestId] = useState(() => freshAgentId("agent"));
  const [dualCode, setDualCode] = useState(() => generateRoomCode());
  const [hostId, setHostId] = useState(() => freshAgentId("agent-a"));
  const [joinId, setJoinId] = useState(() => freshAgentId("agent-b"));
  const [notice, setNotice] = useState<{ where: "invite" | "dual"; text: string } | null>(null);

  const guestPrompt = canInvite
    ? promptHumanOpponent({
        origin,
        roomCode: inviteCode,
        playerId: guestId,
        humanSeated,
        rules,
      })
    : "";
  const hostPrompt = promptDualHost({
    origin,
    roomCode: dualCode,
    playerId: hostId,
    rules,
  });
  const joinPrompt = promptDualGuest({
    origin,
    roomCode: dualCode,
    playerId: joinId,
    rules,
  });
  const dual = explosiveChessRoomEndpoints(origin, dualCode);

  const inviteHint = !inviteCode
    ? ex.agentNeedRoom
    : knownFull
      ? ex.agentRoomFull
      : humanSeated
        ? ex.agentYouSeated
        : ex.agentShareJoin;

  const onCopy = (where: "invite" | "dual", text: string, okMessage: string) => {
    void copyText(text).then((ok) => {
      setNotice({ where, text: ok ? okMessage : ex.copyFailed });
    });
  };

  return (
    <div className="explosive-agent-handoff" id="invite-agent">
      <h3>{ex.agentHandoffTitle}</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        {ex.agentHandoffHint}
      </p>
      <div className="agent-handoff-facts">
        <div className="agent-handoff-fact">
          <span className="label">{ex.agentGuideLabel}</span>
          <a href={guideUrl} target="_blank" rel="noopener noreferrer">
            {guideUrl}
          </a>
        </div>
        {invite ? (
          <>
            <div className="agent-handoff-fact">
              <span className="label">{ex.roomCode}</span>
              <code>{invite.roomCode}</code>
            </div>
            <div className="agent-handoff-fact">
              <span className="label">{ex.agentWsLabel}</span>
              <code>{invite.wsUrl}</code>
            </div>
            <div className="agent-handoff-fact">
              <span className="label">playerId</span>
              <code>{guestId}</code>
            </div>
          </>
        ) : null}
      </div>
      <p className="hint" style={{ margin: 0 }}>
        {inviteHint}
      </p>
      <div className="agent-handoff-actions">
        <button
          type="button"
          className="primary"
          disabled={!canInvite}
          onClick={() => onCopy("invite", guestPrompt, ex.copiedForAgent)}
        >
          {ex.copyForAgent}
        </button>
        {invite ? (
          <div className="agent-handoff-pair">
            <button type="button" className="ghost" onClick={() => onCopy("invite", invite.wsUrl, ex.copiedWs)}>
              {ex.copyWsOnly}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => onCopy("invite", invite.roomCode, ex.copiedCode)}
            >
              {ex.copyCodeOnly}
            </button>
          </div>
        ) : null}
        <p className="agent-handoff-status" role="status">
          {notice?.where === "invite" ? notice.text : ""}
        </p>
      </div>
      {guestPrompt ? <PromptPreview label={ex.agentPreview} text={guestPrompt} /> : null}

      <h3>{ex.dualTitle}</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        {ex.dualHint}
      </p>
      <p className="hint" style={{ margin: 0 }}>
        {ex.dualCodeNote} {ex.dualOrder}
      </p>
      <div className="agent-handoff-facts">
        <div className="agent-handoff-fact">
          <span className="label">{ex.roomCode}</span>
          <code>{dual.roomCode}</code>
        </div>
        <div className="agent-handoff-fact">
          <span className="label">{ex.agentWsLabel}</span>
          <code>{dual.wsUrl}</code>
        </div>
        <div className="agent-handoff-fact">
          <span className="label">Agent A playerId</span>
          <code>{hostId}</code>
        </div>
        <div className="agent-handoff-fact">
          <span className="label">Agent B playerId</span>
          <code>{joinId}</code>
        </div>
      </div>
      <div className="agent-handoff-actions">
        <button type="button" className="primary" onClick={() => onCopy("dual", hostPrompt, ex.copiedAgentA)}>
          {ex.copyAgentA}
        </button>
        <button type="button" className="primary" onClick={() => onCopy("dual", joinPrompt, ex.copiedAgentB)}>
          {ex.copyAgentB}
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => {
            setDualCode(generateRoomCode());
            setHostId(freshAgentId("agent-a"));
            setJoinId(freshAgentId("agent-b"));
            setNotice(null);
          }}
        >
          {ex.newDualCode}
        </button>
        <p className="agent-handoff-status" role="status">
          {notice?.where === "dual" ? notice.text : ""}
        </p>
      </div>
      <PromptPreview label={`${ex.agentPreview} · A`} text={hostPrompt} />
      <PromptPreview label={`${ex.agentPreview} · B`} text={joinPrompt} />
    </div>
  );
}
