# ui/hints — new-player hints (conserve mode, plan M9)

One small card at a time, top right under the HUD buttons, for the first loop of the conserve mode:
采集 (absorb a node) → 建核心 (G, place the base core) → 存入 (deposit at the base) → 唤潮 (call the tide) → 放流 (release, after the first tide).

| File | Role |
|---|---|
| `hintModel.ts` | Pure: the steps, which one is current, completing a step by doing it, 「知道了」, 「不再提示」, switching on again (= from the start), validating stored progress |
| `hintObservation.ts` | Pure: the dive's telemetry (expedition, base, tide) → what the model needs; `busy` while loading, during a tide's warning / show / murk, a recall or with the base panel open |
| `hintStore.ts` | Progress in the platform game-store (`deep-march` / key `hints`), written only when it changes |
| `useHints.ts` | The hook for the dive HUD; H dismisses the current hint |
| `useHintSetting.ts` | The setup screen's 「新手提示」 checkbox |
| `HintCard.tsx`, `hints.css` | The card (key and touch wording): small, top right, off the crosshair and the controls |
| `i18n.ts` | zh / en texts |

Rules: nothing is shown in the free dive; a hint never pauses or blocks the game; a returning world (generation ≥ 2) skips straight to 放流. Tests: `test:hints` (model, observation, the base panel's tide advice), `test:i18n` (texts).
