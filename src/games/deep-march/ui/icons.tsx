/** Tiny line icons for the action fan (drawn around 0,0, ~±9 units). */
export function IconUp() {
  return <path d="M -8 4 L 0 -4 L 8 4 M -8 10 L 0 2 L 8 10" />;
}
export function IconDown() {
  return <path d="M -8 -10 L 0 -2 L 8 -10 M -8 -4 L 0 4 L 8 -4" />;
}
export function IconSwim() {
  return (
    <path d="M -10 -3 Q -5 -8 0 -3 T 10 -3 M -10 4 Q -5 -1 0 4 T 10 4 M 3 -10 L 9 -10 L 9 -4" />
  );
}
export function IconLamp() {
  return (
    <>
      <circle r={4} />
      <path d="M 0 -10 L 0 -7 M 0 7 L 0 10 M -10 0 L -7 0 M 7 0 L 10 0 M -7 -7 L -5 -5 M 5 5 L 7 7 M -7 7 L -5 5 M 5 -5 L 7 -7" />
    </>
  );
}
/** Light-mode glyphs: narrow beam, wide fog-light fan, goggles. */
export function IconBeam() {
  return <path d="M -10 -3 L -10 3 L -5 3 L -5 -3 Z M -5 -1 L 10 -4 M -5 1 L 10 4 M -5 0 L 10 0" />;
}
export function IconHighBeam() {
  return <path d="M -10 -3 L -10 3 L -6 3 L -6 -3 Z M -6 -2 L 10 -9 M -6 -0.7 L 10 -3 M -6 0.7 L 10 3 M -6 2 L 10 9" />;
}
export function IconNightVision() {
  return (
    <>
      <circle cx={-5} r={4.5} />
      <circle cx={5} r={4.5} />
      <path d="M -0.5 0 L 0.5 0 M -10 -2 L -11 -4 M 10 -2 L 11 -4" />
    </>
  );
}
export function IconPanel() {
  return (
    <svg viewBox="-12 -12 24 24" aria-hidden="true">
      <path d="M -9 7 A 11 11 0 0 1 7 -9" fill="none" />
      <path d="M -5 7 A 7 7 0 0 1 3 -5" fill="none" />
      <circle cx={-7} cy={7} r={2.2} />
      <path d="M 3 9 L 9 9 L 9 3" fill="none" />
    </svg>
  );
}
export function IconExit() {
  return (
    <svg viewBox="-12 -12 24 24" aria-hidden="true">
      <path d="M 2 -9 L 9 -9 L 9 9 L 2 9" fill="none" />
      <path d="M 4 0 L -9 0 M -5 -4 L -9 0 L -5 4" fill="none" />
    </svg>
  );
}
export function IconFlip() {
  return (
    <svg viewBox="-12 -12 24 24" aria-hidden="true">
      <path d="M -8 -2 A 8 8 0 0 1 7 -4" fill="none" />
      <path d="M 8 2 A 8 8 0 0 1 -7 4" fill="none" />
      <path d="M 7 -9 L 7 -4 L 2 -4 M -7 9 L -7 4 L -2 4" fill="none" />
    </svg>
  );
}
