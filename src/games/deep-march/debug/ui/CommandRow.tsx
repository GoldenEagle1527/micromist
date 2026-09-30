/** One registry command as clickable controls (no typing): button, switch, choices, stepper or target list. */
import type { DebugDict } from "../i18n";
import { optionText, targetText } from "../labels";
import { stepValue, type DebugCommand, type DebugCtx } from "../registry";

type Props = { k: DebugCommand; c: DebugCtx; d: DebugDict; done: () => void };

export function CommandRow({ k, c, d, done }: Props) {
  const run = (f: () => void) => () => {
    f();
    done();
  };
  const tag = k.restart ? <span className="dm-dbg-tag">{d.needsRestart}</span> : null;
  if (k.kind === "action") {
    return (
      <div className="dm-dbg-row">
        <button type="button" className="dm-dbg-btn wide" onClick={run(() => k.apply(c))}>
          {d.cmd[k.label]}
        </button>
        {tag}
      </div>
    );
  }
  const body = (() => {
    switch (k.kind) {
      case "toggle": {
        const on = k.get(c);
        return (
          <button type="button" className={`dm-dbg-btn${on ? " on" : ""}`} aria-pressed={on} onClick={run(() => k.set(c, !on))}>
            {on ? d.on : d.off}
          </button>
        );
      }
      case "choice": {
        const cur = k.get(c);
        return k.options(c).map((o) => (
          <button key={o.value} type="button" className={`dm-dbg-btn${o.value === cur ? " on" : ""}`} aria-pressed={o.value === cur} onClick={run(() => k.set(c, o.value))}>
            {optionText(d, o.label)}
          </button>
        ));
      }
      case "stepper": {
        const v = k.get(c);
        const btn = (delta: number) => (
          <button key={delta} type="button" className="dm-dbg-btn" onClick={run(() => k.set(c, stepValue(k, v, delta)))}>
            {delta > 0 ? `+${delta}` : delta}
          </button>
        );
        return [...k.steps.map((s) => btn(-s)).reverse(), <span key="v" className="dm-dbg-value">{v}</span>, ...k.steps.map((s) => btn(s))];
      }
      case "targets":
        return k.items(c).map((t) => (
          <button key={`${t.kind}-${t.key}`} type="button" className="dm-dbg-btn" onClick={run(() => k.go(c, t))}>
            {targetText(d, t)}
          </button>
        ));
    }
  })();
  return (
    <div className="dm-dbg-row">
      <span className="dm-dbg-label">
        {d.cmd[k.label]}
        {tag}
      </span>
      <span className="dm-dbg-controls">{body}</span>
    </div>
  );
}
