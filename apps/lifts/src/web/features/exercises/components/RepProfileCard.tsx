import type { LoggedSet } from "../../../../log";
import { maxShare } from "../../../../strength";
import { formatKg } from "../../../utils/format";
import { useElementWidth } from "../hooks/useElementWidth";
import { niceTicks } from "../utils/chart";
import type { RepProfile } from "../utils/progress";

const HEIGHT = 200;
const MARGIN = { top: 8, right: 8, bottom: 22, left: 40 };
/** The reps axis: the chart says little beyond twelve. */
const MAX_REPS = 12;
/** How many per cent either side of the fitted max the interval bars span edge to edge. */
const SPAN_PCT = 8;

const VERDICTS = { strong: "relatively strong", weak: "under-trained", level: "in line" } as const;

const signed = (pct: number) => `${pct < 0 ? "−" : "+"}${Math.abs(pct).toFixed(1)}%`;

/**
 * Every work set's weight against its reps, under the curves one fitted max implies at RPE 10 and RPE 8. Below,
 * each rep range's mean distance from that max with its 95% interval: a range is flagged only when the interval
 * leaves out zero.
 */
export const RepProfileCard = ({ profile }: { readonly profile: RepProfile<LoggedSet> }) => {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const curve = (rir: number) =>
    Array.from({ length: 45 }, (_, index) => 1 + (index / 44) * (MAX_REPS - 1)).flatMap((reps) => {
      const share = maxShare(reps, 10 - rir);
      return share === null ? [] : [{ reps, kg: profile.maxKg * share }];
    });
  const [allOut, inReserve] = [curve(0), curve(2)];
  const shown = profile.sets.filter(({ reps }) => reps <= MAX_REPS);
  const ticks = niceTicks(
    Math.min(...shown.map(({ loadKg }) => loadKg), ...inReserve.map(({ kg }) => kg)),
    Math.max(...shown.map(({ loadKg }) => loadKg), profile.maxKg),
    4,
  );
  const [low, high] = [ticks[0] ?? 0, ticks.at(-1) ?? 1];
  const plot = { width: Math.max(0, width - MARGIN.left - MARGIN.right), height: HEIGHT - MARGIN.top - MARGIN.bottom };
  const px = (reps: number) => MARGIN.left + ((reps - 1) / (MAX_REPS - 1)) * plot.width;
  const py = (kg: number) => MARGIN.top + (1 - (kg - low) / (high - low)) * plot.height;
  const path = (points: readonly { reps: number; kg: number }[]) =>
    points
      .map(({ reps, kg }, index) => `${index === 0 ? "M" : "L"}${px(reps).toFixed(1)} ${py(kg).toFixed(1)}`)
      .join("");
  const position = (pct: number) => `${Math.min(100, Math.max(0, 50 + (pct / SPAN_PCT) * 50))}%`;

  return (
    <section className="card profile-card">
      <h2>Rep–strength profile</h2>
      <p className="trend-headline numeric">
        <strong>{formatKg(profile.maxKg)}</strong>
        <span className="muted">
          ± {formatKg(profile.halfWidth)} kg fitted max today · {profile.sets.length} work sets
        </span>
      </p>
      <div className="chart" ref={ref}>
        {width > 0 && (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={`Weight against reps for ${profile.sets.length} work sets, under the curves a ${formatKg(profile.maxKg)} kilogram max implies`}
          >
            {ticks.map((tick) => (
              <g key={tick}>
                <line className="grid" x1={MARGIN.left} x2={width - MARGIN.right} y1={py(tick)} y2={py(tick)} />
                <text className="tick" x={MARGIN.left - 8} y={py(tick)} dy="0.32em" textAnchor="end">
                  {formatKg(tick)}
                </text>
              </g>
            ))}
            {[1, 3, 5, 8, 10, 12].map((reps) => (
              <text key={reps} className="tick" x={px(reps)} y={HEIGHT - 6} textAnchor="middle">
                {reps === 1 ? "1 rep" : reps}
              </text>
            ))}
            <path className="line" d={path(allOut)} />
            <path className="interval" d={path(inReserve)} />
            {shown.map((set, index) => (
              <circle
                key={set.id}
                className={set.rpe !== null && set.rpe < 8.5 ? "dot easy" : "dot"}
                // Spread a little sideways, so equal sets do not hide one another.
                cx={px(set.reps) + ((index % 5) - 2) * 1.5}
                cy={py(set.loadKg)}
                r={3}
              />
            ))}
          </svg>
        )}
      </div>
      <p className="legend muted">
        <span className="key line-key" /> RPE 10 <span className="key interval-key" /> RPE 8{" "}
        <span className="key dot-key" /> RPE 8.5+ <span className="key easy-key" /> easier
      </p>
      <table className="ranges numeric">
        <thead>
          <tr>
            <th scope="col">Reps</th>
            <th scope="col">n</th>
            <th scope="col">Against the max, 95% CI</th>
            <th scope="col">Reads as</th>
          </tr>
        </thead>
        <tbody>
          {profile.ranges.map((range) => (
            <tr key={range.label}>
              <th scope="row">{range.label}</th>
              <td>{range.n}</td>
              <td>
                {range.meanPct === null ? (
                  <span className="muted">no sets</span>
                ) : (
                  <>
                    <span className="ci" aria-hidden="true">
                      <span className="ci-zero" />
                      {range.halfWidthPct !== null && (
                        <span
                          className="ci-bar"
                          style={{
                            left: position(range.meanPct - range.halfWidthPct),
                            right: `calc(100% - ${position(range.meanPct + range.halfWidthPct)})`,
                          }}
                        />
                      )}
                      <span className={`ci-mean ${range.verdict ?? ""}`} style={{ left: position(range.meanPct) }} />
                    </span>
                    <span className="muted">
                      {signed(range.meanPct)}
                      {range.halfWidthPct !== null &&
                        ` [${signed(range.meanPct - range.halfWidthPct)}, ${signed(range.meanPct + range.halfWidthPct)}]`}
                    </span>
                  </>
                )}
              </td>
              <td className={range.verdict === "strong" || range.verdict === "weak" ? "flagged" : "muted"}>
                {range.verdict === null ? "–" : VERDICTS[range.verdict]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="footnote muted">
        Each work set’s load is first carried to today’s level along the trend, then one max is fitted to them all by
        least squares on load = max × the chart’s share for its reps and RPE. Ranges show their sets’ mean distance
        from it, with a t interval.
      </p>
    </section>
  );
};
