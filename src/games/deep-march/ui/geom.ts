/** SVG helpers for the HUD. Angles in degrees, 0 = up, clockwise (screen space). */
export function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
}

export function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  const sweep = a1 > a0 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} ${sweep} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/** Closed annular sector between radii r0 < r1 and angles a0 < a1. */
export function sectorPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const [ax, ay] = polar(cx, cy, r1, a0);
  const [bx, by] = polar(cx, cy, r1, a1);
  const [px, py] = polar(cx, cy, r0, a1);
  const [qx, qy] = polar(cx, cy, r0, a0);
  const large = a1 - a0 > 180 ? 1 : 0;
  const f = (n: number) => n.toFixed(2);
  if (r0 <= 0) {
    return `M ${f(cx)} ${f(cy)} L ${f(ax)} ${f(ay)} A ${r1} ${r1} 0 ${large} 1 ${f(bx)} ${f(by)} Z`;
  }
  return `M ${f(ax)} ${f(ay)} A ${r1} ${r1} 0 ${large} 1 ${f(bx)} ${f(by)} L ${f(px)} ${f(py)} A ${r0} ${r0} 0 ${large} 0 ${f(qx)} ${f(qy)} Z`;
}

/** Radial tick marks. */
export function ticksPath(
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  a0: number,
  a1: number,
  step: number,
): string {
  let d = "";
  for (let a = a0; a <= a1 + 1e-6; a += step) {
    const [x0, y0] = polar(cx, cy, r0, a);
    const [x1, y1] = polar(cx, cy, r1, a);
    d += `M ${x0.toFixed(2)} ${y0.toFixed(2)} L ${x1.toFixed(2)} ${y1.toFixed(2)} `;
  }
  return d;
}

/** Client → SVG viewBox coordinates. */
export function toViewBox(svg: SVGSVGElement, clientX: number, clientY: number, vb: number): [number, number] {
  const r = svg.getBoundingClientRect();
  return [((clientX - r.left) / r.width) * vb, ((clientY - r.top) / r.height) * vb];
}
