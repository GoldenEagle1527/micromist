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
/** Absorb: particles drawn into a funnel. */
export function IconAbsorb() {
  return <path d="M -9 -8 L 0 2 L 9 -8 M 0 2 L 0 9 M -6 9 L 6 9 M -9 -2 L -7 -2 M 7 -2 L 9 -2 M -4 -10 L -3 -9 M 4 -10 L 3 -9" />;
}
/** Build: a tower on the seabed. */
export function IconBuild() {
  return <path d="M -9 9 L 9 9 M -5 9 L -3 -6 L 3 -6 L 5 9 M -4 -6 L 0 -10 L 4 -6 M -3 1 L 3 1" />;
}
/** Place: a drop pin onto the ground. */
export function IconPlace() {
  return <path d="M 0 5 L -6 -3 A 7 7 0 1 1 6 -3 Z M -9 9 L 9 9 M 0 -6 L 0 -4" />;
}
/** HUD button: the base panel (a house). */
export function IconBase() {
  return (
    <svg viewBox="-12 -12 24 24" aria-hidden="true">
      <path d="M -8 8 L -8 -1 L 0 -8 L 8 -1 L 8 8 Z M -3 8 L -3 2 L 3 2 L 3 8" fill="none" />
    </svg>
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
/** Light-mode glyphs: narrow beam, wide fog-light fan, sonar pings. */
export function IconBeam() {
  return <path d="M -10 -3 L -10 3 L -5 3 L -5 -3 Z M -5 -1 L 10 -4 M -5 1 L 10 4 M -5 0 L 10 0" />;
}
export function IconHighBeam() {
  return <path d="M -10 -3 L -10 3 L -6 3 L -6 -3 Z M -6 -2 L 10 -9 M -6 -0.7 L 10 -3 M -6 0.7 L 10 3 M -6 2 L 10 9" />;
}
export function IconSonar() {
  return (
    <>
      <circle cx={-8} r={1.6} />
      <path d="M -4 -4 A 5.7 5.7 0 0 1 -4 4 M 0 -7.5 A 10.6 10.6 0 0 1 0 7.5 M 3 -9 A 12.7 12.7 0 0 1 3 9" />
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
/** Speaker with waves (sound on) / crossed (muted). */
const SPEAKER = "M -9 -3 L -5 -3 L 0 -8 L 0 8 L -5 3 L -9 3 Z";
export function IconSound() {
  return (
    <svg viewBox="-12 -12 24 24" aria-hidden="true">
      <path d={SPEAKER} fill="none" />
      <path d="M 3.5 -3.5 A 5 5 0 0 1 3.5 3.5 M 6 -7 A 10 10 0 0 1 6 7" fill="none" />
    </svg>
  );
}
export function IconMute() {
  return (
    <svg viewBox="-12 -12 24 24" aria-hidden="true">
      <path d={SPEAKER} fill="none" />
      <path d="M 3 -4 L 10 4 M 10 -4 L 3 4" fill="none" />
    </svg>
  );
}
