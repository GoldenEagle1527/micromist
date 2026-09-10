import { intentLabelKey } from "./engine";
import type { Intent, RunState } from "./types";
import {
  type BladeCopy,
  cardTitle,
} from "./copy";

export function ApPips({ ap, max }: { ap: number; max: number }) {
  return (
    <span className="blade-ap" aria-label={`AP ${ap}/${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          className={`blade-ap-pip${i < ap ? " blade-ap-pip-on" : ""}`}
        />
      ))}
    </span>
  );
}

export function Bar({
  value,
  max,
  className,
  label,
}: {
  value: number;
  max: number;
  className: string;
  label: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={`blade-bar ${className}`} title={label}>
      <div className="blade-bar-fill" style={{ width: `${pct}%` }} />
      <span className="blade-bar-text">
        {label} {value}/{max}
      </span>
    </div>
  );
}

export function intentText(
  intent: Intent | null,
  t: BladeCopy,
): string {
  if (!intent) return t.intentNone;
  const key = intentLabelKey(intent) as keyof typeof t;
  const tpl = t[key];
  if (typeof tpl === "function") {
    const v =
      intent.kind === "windup"
        ? (intent.windupDamage ?? intent.value)
        : intent.value;
    return (tpl as (n: number) => string)(v);
  }
  return String(tpl ?? t.intentNone);
}

type IntentVisual = {
  tone: string;
  value: number | null;
  windup?: number;
};

export function intentVisual(intent: Intent | null): IntentVisual | null {
  if (!intent) return null;
  const v = intent.value;
  switch (intent.kind) {
    case "attack":
      return { tone: "attack", value: v };
    case "heavyAttack":
      return { tone: "heavy", value: v };
    case "defend":
      return { tone: "defend", value: v };
    case "windup":
      return {
        tone: "windup",
        value: intent.windupDamage ?? v,
        windup: intent.windupLeft ?? 0,
      };
    case "thorns":
      return { tone: "thorns", value: v };
    case "armorUp":
      return { tone: "armor", value: v };
    case "hex":
      return { tone: "hex", value: v };
    case "heal":
      return { tone: "heal", value: v };
    case "discard":
      return { tone: "discard", value: v };
    case "shatterBlock":
      return { tone: "shatter", value: v };
    default:
      return { tone: "attack", value: v };
  }
}

export function IntentIcon({ tone }: { tone: string }) {
  const common = {
    viewBox: "0 0 24 24",
    "aria-hidden": true as const,
    className: "blade-intent-svg",
  };
  switch (tone) {
    case "defend":
    case "armor":
      return (
        <svg {...common}>
          <path d="M12 2 4 5v6c0 5.25 3.4 9.74 8 11 4.6-1.26 8-5.75 8-11V5l-8-3z" />
        </svg>
      );
    case "shatter":
      return (
        <svg {...common}>
          <path d="M12 2 4 5v6c0 5.25 3.4 9.74 8 11 4.6-1.26 8-5.75 8-11V5l-8-3zm0 4 2 4h-4l2-4zm-1 6h2v5h-2v-5z" />
        </svg>
      );
    case "heal":
      return (
        <svg {...common}>
          <path d="M12 21s-7-4.35-7-10a4 4 0 0 1 7-2.65A4 4 0 0 1 19 11c0 5.65-7 10-7 10z" />
        </svg>
      );
    case "hex":
      return (
        <svg {...common}>
          <path d="M12 2c2.5 3 4 5.5 4 8a4 4 0 1 1-8 0c0-2.5 1.5-5 4-8zm-3 14h6l1 6H8l1-6z" />
        </svg>
      );
    case "thorns":
      return (
        <svg {...common}>
          <path d="M12 2 9 9H2l6 4-2 9 6-5 6 5-2-9 6-4h-7L12 2z" />
        </svg>
      );
    case "discard":
      return (
        <svg {...common}>
          <path d="M7 4h12v14H7V4zm-3 3h2v14h10v2H4V7z" />
        </svg>
      );
    case "windup":
      return (
        <svg {...common}>
          <path d="M4 19 14 4l2 1-3 5h7L9 22l-1-1 4-6H5l-1 4z" />
        </svg>
      );
    case "heavy":
      return (
        <svg {...common}>
          <path d="M3 20 13 3l2.2 1.2-3.5 6.3H21L8.5 22 7 20.8 11 13H4.8L3 20z" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M6.5 19.5 16 3.5l1.8 1-3.2 5.8H20L8.2 21.2 6.8 20 11 13H5.2L6.5 19.5z" />
        </svg>
      );
  }
}

export function IntentBadge({
  intent,
  broken,
  brokenLabel,
  label,
  intentKicker,
  windupSub,
}: {
  intent: Intent | null;
  broken: boolean;
  brokenLabel: string;
  label: string;
  intentKicker: string;
  windupSub: (n: number) => string;
}) {
  if (broken) {
    return (
      <div className="blade-intent blade-intent-broken" role="status">
        <span className="blade-intent-icon-wrap" aria-hidden="true">
          <IntentIcon tone="shatter" />
        </span>
        <div className="blade-intent-copy">
          <strong className="blade-intent-label">{brokenLabel}</strong>
        </div>
      </div>
    );
  }
  const vis = intentVisual(intent);
  if (!vis) {
    return (
      <div className="blade-intent blade-intent-none" role="status">
        <strong>{label}</strong>
      </div>
    );
  }
  return (
    <div
      className={`blade-intent blade-intent-${vis.tone}`}
      role="status"
      aria-label={label}
    >
      <span className="blade-intent-icon-wrap" aria-hidden="true">
        <IntentIcon tone={vis.tone} />
      </span>
      {vis.value != null ? (
        <span className="blade-intent-value">{vis.value}</span>
      ) : null}
      <div className="blade-intent-copy">
        <span className="blade-intent-kicker">{intentKicker}</span>
        <strong className="blade-intent-label">{label}</strong>
        {vis.windup != null && vis.windup > 0 ? (
          <span className="blade-intent-sub">{windupSub(vis.windup)}</span>
        ) : null}
      </div>
    </div>
  );
}

export function RuleBanner({
  ruleId,
  bl,
}: {
  ruleId: RunState["ruleId"];
  bl: BladeCopy;
}) {
  const rule = bl.rules[ruleId];
  if (!rule) return null;
  return (
    <div className="blade-rule-banner" title={rule.desc}>
      <strong>{bl.ruleBanner(rule.name)}</strong>
      <span className="hint">{rule.desc}</span>
    </div>
  );
}

export function HighlightsPanel({
  run,
  bl,
}: {
  run: RunState;
  bl: BladeCopy;
}) {
  const h = run.highlights;
  return (
    <div className="blade-highlights">
      <h3>{bl.highlightsTitle}</h3>
      <ul>
        <li>{bl.highlightMaxHit(h.maxHit)}</li>
        <li>{bl.highlightBreaks(h.breakInterrupts)}</li>
        <li>{bl.highlightMinHp(h.minHpSeen)}</li>
        {h.poisonKills > 0 ? (
          <li>{bl.highlightPoisonKills(h.poisonKills)}</li>
        ) : null}
        <li>{bl.highlightMaxAttacks(h.maxAttacksInTurn)}</li>
      </ul>
      {run.discoveredRecipes.length > 0 ? (
        <p className="hint">
          {bl.secretRecipesTitle}:{" "}
          {run.discoveredRecipes.map((id) => cardTitle(id, bl)).join(", ")}
        </p>
      ) : null}
    </div>
  );
}
