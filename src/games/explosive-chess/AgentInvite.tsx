import { useEffect, useId, useRef, useState } from "react";
import { promptInviteAgent } from "../../../shared/explosive-chess/agent-handoff";

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
  copyLabel: string;
  copiedLabel: string;
  failedLabel: string;
};

/** One sentence, one prompt, and one Copy button on the explosive-chess setup page. */
export function AgentInvite({ line, copyLabel, copiedLabel, failedLabel }: AgentInviteProps) {
  const titleId = useId();
  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost";
  const prompt = promptInviteAgent(origin);
  const [phase, setPhase] = useState<CopyPhase>("idle");
  const timer = useRef<number | null>(null);

  useEffect(() => {
    setPhase("idle");
  }, [copyLabel]);

  useEffect(
    () => () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    },
    [],
  );

  const buttonLabel = phase === "ok" ? copiedLabel : phase === "fail" ? failedLabel : copyLabel;

  return (
    <section className="explosive-agent-invite" aria-labelledby={titleId}>
      <p id={titleId}>{line}</p>
      <pre className="explosive-agent-prompt">{prompt}</pre>
      <button
        type="button"
        className="primary"
        aria-live="polite"
        onClick={() => {
          void copyText(prompt).then((ok) => {
            setPhase(ok ? "ok" : "fail");
            if (timer.current != null) window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => setPhase("idle"), 2000);
          });
        }}
      >
        {buttonLabel}
      </button>
    </section>
  );
}
