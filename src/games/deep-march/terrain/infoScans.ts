/**
 * Region-aware long horizontal scans of the class grid (infoClassGrid.ts; see
 * ENV_T.ringAxisLong): in the cave warren a cell is cave when rock is within
 * caveUpLong above and enough sides are closed within caveReachLong; in the canyon
 * belt a trench cell is canyon when two opposite walls (one vertical) are
 * ≤ canyonGapLong apart and a perpendicular direction stays open, and the canyon
 * label then extends upward to the lower wall crest (canyonRim).
 */
import { ENV, ENV_T } from "./terrainInfo";
import { REGION } from "./regions";
import { DIRS, type InfoGeom } from "./infoGeom";
import type { LineAt } from "./infoLines";

/** (ix, iz, ju, d0, up, k, rid, col) → the cell's class after the long rules. */
export function createLongScan(g: InfoGeom, L: LineAt, canyonRim: Int32Array) {
  const { iso, S, C, nyL } = g;
  const longD = new Float64Array(8);
  const longV = new Uint8Array(8);
  const longTop = new Int32Array(8); // row where the wall hit in each direction ends (first water row above)
  return (ix: number, iz: number, ju: number, d0: number, up: number, k: number, rid: number, col: number): number => {
    // long horizontal scans (same arithmetic as the short ones, farther reach)
    let closedL = 0;
    for (let dir = 0; dir < 8; dir++) {
      const dx = DIRS[dir * 2], dz = DIRS[dir * 2 + 1];
      const diag = dx !== 0 && dz !== 0;
      const steps = diag ? ENV_T.ringDiagLong : ENV_T.ringAxisLong;
      const len = diag ? C * Math.SQRT2 : C;
      let prev = d0;
      longD[dir] = Infinity;
      longV[dir] = 0;
      for (let st = 1; st <= steps; st++) {
        const l2 = L(ix + dx * st, iz + dz * st);
        const v = l2.d[ju];
        if (v >= iso) {
          longD[dir] = (st - 1 + (iso - prev) / (v - prev)) * len;
          const jA = Math.min(nyL - 1, ju + S), jB = Math.max(0, ju - S);
          longV[dir] = l2.d[jA] >= iso && l2.d[jB] >= iso ? 1 : 0;
          // crest of that wall: highest rock top (at this row) among the lines out to the reach
          let top = ju;
          for (let s2 = st; s2 <= steps; s2++) {
            const l3 = L(ix + dx * s2, iz + dz * s2);
            if (l3.d[ju] < iso) continue;
            let t = ju;
            while (t < nyL && l3.d[t] >= iso) t++;
            if (t > top) top = t;
          }
          longTop[dir] = top;
          break;
        }
        prev = v;
      }
      if (longD[dir] <= ENV_T.caveReachLong) closedL++;
    }
    if (rid === REGION.CAVE) {
      if ((up <= ENV_T.caveUpLong && closedL >= ENV_T.caveClosedLong) || (up <= ENV_T.overhangUp && closedL >= ENV_T.caveClosedLong - 1)) k = ENV.CAVE;
    } else if (up > ENV_T.overhangUp) {
      let rimPair = -1;
      for (let a = 0; a < 4; a++) {
        const gap = longD[a] + longD[a + 4];
        if (gap <= ENV_T.canyonGapLong && (longV[a] || longV[a + 4])) {
          const p = (a + 2) % 8;
          if (!Number.isFinite(longD[p]) || !Number.isFinite(longD[(p + 4) % 8])) {
            k = ENV.CANYON;
            rimPair = a;
            break;
          }
          if (k === ENV.CANYON && rimPair < 0) rimPair = a; // canyon by the short rule
        }
      }
      // the cells above stay canyon up to the lower of the two walls' crests
      if (k === ENV.CANYON && rimPair >= 0) canyonRim[col] = Math.max(canyonRim[col], Math.min(longTop[rimPair], longTop[rimPair + 4]));
    }
    return k;
  };
}
