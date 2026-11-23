import { useState } from "react";
import { promptInviteAgent } from "../../shared/agent/handoff";
import { useLocale } from "../i18n";
import { copyText } from "../platform/play/copy-text";

export function AgentPage() {
  const { locale, t } = useLocale();
  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost";
  const prompt = promptInviteAgent(origin, locale);
  const [phase, setPhase] = useState<"idle" | "ok" | "fail">("idle");

  async function copy() {
    const ok = await copyText(prompt);
    setPhase(ok ? "ok" : "fail");
    window.setTimeout(() => setPhase("idle"), 2000);
  }

  const copyLabel = phase === "ok" ? t.agentCopied : phase === "fail" ? t.agentCopyFailed : t.agentCopy;

  return (
    <section className="agent-page">
      <h1>{t.agentTitle}</h1>
      <p className="lede">{t.agentBody}</p>
      <pre className="agent-prompt">{prompt}</pre>
      <button type="button" className="primary" onClick={() => void copy()}>
        {copyLabel}
      </button>
    </section>
  );
}
