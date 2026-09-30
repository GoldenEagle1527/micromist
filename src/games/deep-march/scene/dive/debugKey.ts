/** Debug: B toggles the spawn-candidate markers (outside text fields); returns the unbind. */
import type { SpawnDebugView } from "../spawnDebug";

export function listenSpawnDebugKey(view: SpawnDebugView): () => void {
  const onKey = (ev: KeyboardEvent) => {
    if (ev.code !== "KeyB" || ev.repeat) return;
    const t = ev.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    view.setVisible(!view.visible);
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
