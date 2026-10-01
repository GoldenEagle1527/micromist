/**
 * 结局演练 (stage 5, conserve): a restart choice that opens the next dive on a
 * sandboxed stage-5 copy of the save with the gaze at phase ① … ④ (scene/dive/
 * params.ts `rehearsal`; conserve/session/rehearsal.ts — kept in memory, the
 * real slot is never written), and, in such a dive only, shortcuts through
 * the sequence: skip 5 minutes, light every anchor, give particles back to
 * m ≥ 0.84, 封界 at once, 湮灭 at once.
 */
import type { GazeRehearsal } from "../conserve";
import type { ChoiceOption, DebugCommand, DebugCtx } from "./registry";

const rehearsing = (c: DebugCtx) => !!c.port?.gaze();
const act = (id: string, label: DebugCommand["label"], run: (g: GazeRehearsal) => void): DebugCommand => ({
  id: `ending.${id}`,
  section: "ending",
  label,
  kind: "action",
  when: rehearsing,
  apply: (c) => {
    const g = c.port?.gaze();
    if (g) run(g);
  },
});
const PHASES: readonly ChoiceOption[] = ["①", "②", "③", "④"].map((t, i) => ({ value: String(i), label: { text: t } }));

export const ENDING_COMMANDS: readonly DebugCommand[] = [
  {
    id: "ending.rehearsal",
    section: "ending",
    label: "rehearsal",
    kind: "choice",
    restart: true,
    when: (c) => c.conserve,
    options: () => [{ value: "", label: "off" }, ...PHASES],
    get: (c) => (c.draft.rehearsal === null ? "" : String(c.draft.rehearsal)),
    set: (c, v) => c.setDraft({ rehearsal: v === "" ? null : (Number(v) as 0 | 1 | 2 | 3) }),
  },
  act("skip", "gazeSkip", (g) => g.skip(300)),
  act("anchors", "gazeAnchors", (g) => g.lightAll()),
  act("return", "gazeReturn", (g) => g.returnParticles()),
  act("seal", "gazeSeal", (g) => g.seal()),
  act("annihilate", "gazeEnd", (g) => g.annihilate()),
];
