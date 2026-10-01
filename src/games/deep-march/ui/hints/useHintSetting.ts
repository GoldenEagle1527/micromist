/** The setup screen's 「新手提示」 switch: on = hints shown (switching on starts them over). */
import { useCallback, useState } from "react";
import { setHintsOn } from "./hintModel";
import { loadHints, saveHints } from "./hintStore";
import { forgetTips } from "../../settings";

export function useHintSetting(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => !loadHints().off);
  const set = useCallback((next: boolean) => {
    if (next) forgetTips("hint:");
    saveHints(setHintsOn(loadHints(), next));
    setOn(next);
  }, []);
  return [on, set];
}
