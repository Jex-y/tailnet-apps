import type { Exercise } from "../../../../contract";
import { type Trend, WINDOWS, type Window } from "../../../../trend";
import { formatChange, formatKg } from "../../../utils/format";
import { TrendChart } from "./TrendChart";

type Props = {
  readonly trend: Trend;
  readonly exercise: Pick<Exercise, "bodyweight">;
  readonly window: Window;
  readonly onWindow: (window: Window) => void;
};

const VERDICTS = {
  above: "a real rise",
  within: "within the usual scatter",
  below: "a real dip",
} as const;

const interval = (value: number, halfWidth: number, format: (value: number) => string) =>
  `${format(value - halfWidth)} to ${format(value + halfWidth)}`;

/** The fitted trend of an exercise's estimated max, its uncertainty, and whether the latest session stands out. */
export const TrendCard = ({ trend, exercise, window, onWindow }: Props) => {
  const { fit, latest } = trend;

  return (
    <section className="card trend-card">
      <fieldset className="segmented">
        <legend className="visually-hidden">Span of the trend</legend>
        {WINDOWS.map((each) => (
          <label key={each.label}>
            <input
              type="radio"
              name="trend-window"
              className="visually-hidden"
              checked={each === window}
              onChange={() => onWindow(each)}
            />
            {each.label}
          </label>
        ))}
      </fieldset>
      {fit === null ? (
        <p className="muted">
          A trend needs three sessions in the span; there {trend.points.length === 1 ? "is" : "are"}{" "}
          {trend.points.length}.
        </p>
      ) : (
        <>
          <p className="trend-headline numeric">
            <strong>{formatKg(fit.at(0))}</strong>
            <span className="muted">± {formatKg(fit.confidenceHalfWidth(0))} kg today</span>
            <span className={fit.slope - fit.slopeHalfWidth > 0 ? "rising" : undefined}>
              {formatChange(fit.slope)}/wk
            </span>
          </p>
          <TrendChart trend={trend} exercise={exercise} weeks={window.weeks} />
          <dl className="stats numeric">
            <div>
              <dt>Slope, 95% CI</dt>
              <dd className="stat">
                {formatChange(fit.slope)} kg/wk{" "}
                <span className="muted">[{interval(fit.slope, fit.slopeHalfWidth, formatChange)}]</span>
              </dd>
            </div>
            <div>
              <dt>R² · residual SD · n</dt>
              <dd className="stat">
                {fit.r2.toFixed(2)} · {formatKg(fit.residualSd)} kg · {fit.n}
              </dd>
            </div>
            {latest !== null && (
              <>
                <div>
                  <dt>Latest session</dt>
                  <dd className="stat">
                    {formatKg(latest.point.maxKg)} kg{" "}
                    <span className="muted">expected {formatKg(latest.expectedKg)}</span>
                  </dd>
                </div>
                <div>
                  <dt>95% prediction interval</dt>
                  <dd className="stat">
                    {interval(latest.expectedKg, latest.halfWidth, formatKg)} →{" "}
                    <strong className={latest.verdict === "above" ? "rising" : undefined}>
                      {VERDICTS[latest.verdict]}
                    </strong>
                  </dd>
                </div>
              </>
            )}
          </dl>
          <p className="footnote muted">
            Least squares on each session’s best estimated max (RTS RPE chart). Band: 95% confidence interval of the
            line. Dashed: 95% prediction interval for one session. The latest session is judged against the sessions
            before it, so it cannot pull the line towards itself.
          </p>
        </>
      )}
    </section>
  );
};
