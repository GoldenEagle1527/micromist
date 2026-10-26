import { useEffect, useRef, useState } from "react";
import { promptInviteAgent, type AgentLocale } from "../../../shared/explosive-chess/agent-handoff";

type CopyPhase = "idle" | "ok" | "fail";

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

export type AgentInviteProps = {
  line: string;
  copiedLabel: string;
  failedLabel: string;
  locale: AgentLocale;
};

/** One clickable row at the bottom of explosive-chess match setup. The prompt is copied, not shown. */
export function AgentInvite({ line, copiedLabel, failedLabel, locale }: AgentInviteProps) {
  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost";
  const prompt = promptInviteAgent(origin, locale);
  const [phase, setPhase] = useState<CopyPhase>("idle");
  const timer = useRef<number | null>(null);

  useEffect(() => {
    setPhase("idle");
  }, [line]);

  useEffect(
    () => () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    },
    [],
  );

  const label = phase === "ok" ? copiedLabel : phase === "fail" ? failedLabel : line;

  return (
    <button
      type="button"
      className="explosive-agent-invite"
      data-phase={phase}
      aria-live="polite"
      onClick={() => {
        void copyText(prompt).then((ok) => {
          setPhase(ok ? "ok" : "fail");
          if (timer.current != null) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setPhase("idle"), 2000);
        });
      }}
    >
      {label}
    </button>
  );
}
