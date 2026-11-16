import { type PointerEvent, useState } from "react";
import type { Exercise } from "../../../../contract";
import type { Trend } from "../../../../trend";
import { formatChange, formatDay, formatKg, formatSet } from "../../../utils/format";
import { useElementWidth } from "../hooks/useElementWidth";
import { niceTicks } from "../utils/chart";

const MARGIN = { top: 10, right: 10, bottom: 22, left: 40 };
const COMPACT_MARGIN = { top: 4, right: 4, bottom: 4, left: 4 };
const STEPS = 40;

type Props = {
  readonly trend: Trend;
  /** What its sets are, for writing them out. */
  readonly exercise: Pick<Exercise, "bodyweight">;
  /** How far back the axis reaches, in weeks; `null` to start at the first session. */
  readonly weeks: number | null;
  /** A sparkline: no axes, no residuals, no reading out. */
  readonly compact?: boolean;
};

/**
 * Each session's best estimated max against the fitted line. The shaded band is where the line itself lies (95%
 * confidence); the dashed lines are where a single session should fall (95% prediction). Below, the residuals show
 * whether a straight line suits the data: they should scatter evenly about zero. Pointing at a session reads it out;
 * a slider under the chart does the same from the keyboard.
 */
export const TrendChart = ({ trend, exercise, weeks, compact = false }: Props) => {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const { points, fit } = trend;
  const margin = compact ? COMPACT_MARGIN : MARGIN;
  const height = compact ? 72 : 200;

  const start = weeks === null ? Math.min(-1, ...points.map(({ x }) => x)) : -weeks;
  const xs = Array.from({ length: STEPS + 1 }, (_, index) => start + (index / STEPS) * -start);
  // The axis holds the prediction interval, so the dashed lines stay in view; a sparkline holds just the band.
  const reach = (x: number) => (fit === null ? 0 : compact ? fit.confidenceHalfWidth(x) : fit.predictionHalfWidth(x));
  const edges = fit === null ? [] : xs.flatMap((x) => [fit.at(x) - reach(x), fit.at(x) + reach(x)]);
  const values = [...points.map(({ maxKg }) => maxKg), ...edges];
  const ticks = niceTicks(Math.min(...values), Math.max(...values), 4);
  const [low, high] = compact ? [Math.min(...values), Math.max(...values)] : [ticks[0] ?? 0, ticks.at(-1) ?? 1];
  const plot = { width: Math.max(0, width - margin.left - margin.right), height: height - margin.top - margin.bottom };
  const px = (x: number) => margin.left + ((x - start) / -start) * plot.width;
  const py = (y: number) => margin.top + (1 - (y - low) / (high - low || 1)) * plot.height;
  const line = (f: (x: number) => number) =>
    xs.map((x, index) => `${index === 0 ? "M" : "L"}${px(x).toFixed(1)} ${py(f(x)).toFixed(1)}`).join("");
  const band =
    fit === null
      ? ""
      : `${line((x) => fit.at(x) + fit.confidenceHalfWidth(x))}${xs
          .toReversed()
          .map((x) => `L${px(x).toFixed(1)} ${py(fit.at(x) - fit.confidenceHalfWidth(x)).toFixed(1)}`)
          .join("")}Z`;
  const last = points.length - 1;
  const shown = active === null ? undefined : points[active];
  const residualOf = (index: number) => fit?.residuals[index] ?? 0;
  const residualScale = fit === null || fit.residualSd === 0 ? 0 : 14 / (3 * fit.residualSd);

  const nearest = (event: PointerEvent<SVGSVGElement>) => {
    const pointer = event.clientX - event.currentTarget.getBoundingClientRect().left;
    const distances = points.map(({ x }) => Math.abs(px(x) - pointer));
    setActive(distances.indexOf(Math.min(...distances)));
  };

  return (
    <div className={compact ? "chart compact" : "chart"} ref={ref}>
      {width > 0 && (
        <svg
          width={width}
          height={height + (compact || fit === null ? 0 : 40)}
          role="img"
          aria-label={
            fit === null
              ? "Too few sessions to fit a trend"
              : `Estimated max trend, ${formatChange(fit.slope)} kilograms a week, at ${formatKg(fit.at(0))} today`
          }
          {...(!compact && {
            onPointerMove: nearest,
            onPointerDown: nearest,
            onPointerLeave: () => setActive(null),
          })}
        >
          {!compact &&
            ticks.map((tick) => (
              <g key={tick}>
                <line className="grid" x1={margin.left} x2={width - margin.right} y1={py(tick)} y2={py(tick)} />
                <text className="tick" x={margin.left - 8} y={py(tick)} dy="0.32em" textAnchor="end">
                  {formatKg(tick)}
                </text>
              </g>
            ))}
          {!compact && (
            <>
              <text className="tick" x={margin.left} y={height - 6} textAnchor="start">
                {weeks === null ? `${Math.round(-start)} wk ago` : `${weeks} wk ago`}
              </text>
              <text className="tick" x={width - margin.right} y={height - 6} textAnchor="end">
                today
              </text>
            </>
          )}
          {fit !== null && (
            <>
              <path className="band" d={band} />
              {!compact && (
                <>
                  <path className="interval" d={line((x) => fit.at(x) + fit.predictionHalfWidth(x))} />
                  <path className="interval" d={line((x) => fit.at(x) - fit.predictionHalfWidth(x))} />
                </>
              )}
              <path className="line" d={line(fit.at)} />
            </>
          )}
          {active !== null && shown !== undefined && (
            <line
              className="crosshair"
              x1={px(shown.x)}
              x2={px(shown.x)}
              y1={margin.top}
              y2={margin.top + plot.height}
            />
          )}
          {points.map((point, index) => (
            <circle
              key={point.set.id}
              className={
                index === last && trend.latest?.verdict === "above"
                  ? "dot latest above"
                  : index === last
                    ? "dot latest"
                    : "dot"
              }
              cx={px(point.x)}
              cy={py(point.maxKg)}
              r={compact ? 2.5 : index === (active ?? last) ? 5 : 3.5}
            />
          ))}
          {!compact && fit !== null && (
            <g transform={`translate(0 ${height + 20})`}>
              <line className="grid" x1={margin.left} x2={width - margin.right} y1={0} y2={0} />
              <text className="tick" x={margin.left - 8} y={0} dy="0.32em" textAnchor="end">
                ±0
              </text>
              {points.map((point, index) => {
                const size = Math.max(1, Math.abs(residualOf(index)) * residualScale);
                return (
                  <rect
                    key={point.set.id}
                    className="residual"
                    x={px(point.x) - 2}
                    y={residualOf(index) > 0 ? -size : 0}
                    width={4}
                    height={size}
                  />
                );
              })}
            </g>
          )}
        </svg>
      )}
      {!compact && points.length > 0 && (
        <input
          type="range"
          className="chart-scrub"
          min={0}
          max={last}
          value={active ?? last}
          onChange={(event) => setActive(Number(event.target.value))}
          onFocus={() => setActive((current) => current ?? last)}
          onBlur={() => setActive(null)}
          aria-label="Session"
          aria-valuetext={`${formatDay(points[active ?? last]?.date ?? "")}: ${formatKg(points[active ?? last]?.maxKg ?? 0)} kilograms`}
        />
      )}
      {shown !== undefined && active !== null && (
        <div
          className="chart-tooltip"
          style={px(shown.x) > width / 2 ? { right: width - px(shown.x) + 12 } : { left: px(shown.x) + 12 }}
        >
          <time dateTime={shown.date}>{formatDay(shown.date)}</time>
          <strong>{formatKg(shown.maxKg)} kg</strong>
          <span className="muted numeric">from {formatSet(shown.set, exercise)}</span>
          {fit !== null && <span className="muted numeric">{formatChange(residualOf(active))} vs trend</span>}
        </div>
      )}
    </div>
  );
};
