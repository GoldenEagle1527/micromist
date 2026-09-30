/**
 * The tide forecast card (plan M6) in the base panel's tide section: what a
 * tide called now would bring — m, wall thickness and chaos stage after the
 * tide beside this generation's, and the cracks that would open or heal.
 */
import type { TideForecast } from "../../conserve";
import type { ForecastDict } from "./forecastI18n";

type Props = { forecast: TideForecast; labels: ForecastDict };

export function TideForecastCard({ forecast: f, labels: l }: Props) {
  const stage = (s: number) => l.stages[s] ?? String(s);
  const rows: [string, string, string, boolean][] = [
    [l.m, f.m.toFixed(3), f.now.m.toFixed(3), f.m.toFixed(3) !== f.now.m.toFixed(3)],
    [l.wall, l.metres(f.thickness), l.metres(f.now.thickness), Math.round(f.thickness) !== Math.round(f.now.thickness)],
    [l.stage, stage(f.stage), stage(f.now.stage), f.stage !== f.now.stage],
  ];
  return (
    <div className="dm-tide-forecast">
      <b>{l.title}</b>
      <table className="dm-base-table">
        <thead>
          <tr>
            <th />
            <th>{l.next}</th>
            <th>{l.now}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, next, now, changed]) => (
            <tr key={name} className={changed ? "changed" : undefined}>
              <td>{name}</td>
              <td>
                <b>{next}</b>
              </td>
              <td className="dim">{now}</td>
            </tr>
          ))}
          <tr className={f.cracks.opening || f.cracks.healing ? "changed" : undefined}>
            <td>{l.cracks}</td>
            <td colSpan={2}>{l.crackLine(f.cracks)}</td>
          </tr>
        </tbody>
      </table>
      <p className="dm-base-note dim">{l.note}</p>
    </div>
  );
}
