import { Link } from "wouter";
import { COMPETITION_LIFTS, type Exercise } from "../../../../contract";
import { sessionsOf, type WorkoutDetail } from "../../../../log";
import { formatChange, formatKg, localToday } from "../../../utils/format";
import { trend } from "../utils/chart";
import { sumOfEstimates } from "../utils/fit";
import { LIFT_NAMES } from "../utils/lifts";
import { DEFAULT_WINDOW, trendOver } from "../utils/progress";
import { TrendChart } from "./TrendChart";

type Props = {
  readonly exercises: readonly Exercise[];
  readonly workouts: readonly WorkoutDetail[];
};

const WEEKS_A_MONTH = 365.25 / 12 / 7;

/**
 * Where each competition lift's trend puts its max today, and the total of the three. The total's interval adds the
 * three variances, taking the lifts as independent, and uses the fewest degrees of freedom among them.
 */
export const StrengthOverview = ({ exercises, workouts }: Props) => {
  const today = localToday();
  const weeks = DEFAULT_WINDOW.weeks;
  const lifts = COMPETITION_LIFTS.flatMap((lift) => {
    const exercise = exercises.find((each) => each.lift === lift);
    return exercise === undefined
      ? []
      : [{ lift, exercise, trend: trendOver(trend(sessionsOf(workouts, exercise.id)), today, weeks) }];
  });
  if (lifts.length === 0) {
    return null;
  }
  const fits = lifts.flatMap(({ trend: { fit } }) => (fit === null ? [] : [fit]));
  const total =
    fits.length === COMPETITION_LIFTS.length
      ? {
          now: sumOfEstimates(
            fits.map((fit) => ({ value: fit.at(0), standardError: fit.standardError(0), df: fit.df })),
          ),
          slope: sumOfEstimates(
            fits.map((fit) => ({ value: fit.slope, standardError: fit.slopeStandardError, df: fit.df })),
          ),
        }
      : null;

  return (
    <>
      {total !== null && (
        <section className="card total-card numeric">
          <p className="label">Total · fitted today</p>
          <p className="trend-headline">
            <strong>{formatKg(total.now.value)}</strong>
            <span className="muted">± {formatKg(total.now.halfWidth)} kg</span>
            <span className={total.slope.value - total.slope.halfWidth > 0 ? "rising" : undefined}>
              {formatChange(total.slope.value)}/wk
            </span>
          </p>
          <p className="muted">
            slope 95% CI [{formatChange(total.slope.value - total.slope.halfWidth)} to{" "}
            {formatChange(total.slope.value + total.slope.halfWidth)}] ·{" "}
            {formatChange(((total.slope.value * WEEKS_A_MONTH) / total.now.value) * 100)}% a month
          </p>
        </section>
      )}
      {lifts.map(({ lift, exercise, trend: lifted }) => {
        const { fit } = lifted;
        return (
          <Link key={lift} href={`/exercises/${exercise.id}`} className="card lift-card numeric">
            <span className="lift-card-heading">
              <strong>{LIFT_NAMES[lift]}</strong>
              {fit !== null && (
                <span className="muted">
                  n={fit.n} · R² {fit.r2.toFixed(2)}
                </span>
              )}
              <span className="lift-card-figure">
                {fit === null ? "–" : formatKg(fit.at(0))}
                {fit !== null && <small>±{formatKg(fit.confidenceHalfWidth(0))}</small>}
              </span>
            </span>
            {fit === null ? (
              <span className="muted">A trend needs three sessions in the last {weeks} weeks.</span>
            ) : (
              <>
                <TrendChart trend={lifted} weeks={weeks} compact />
                <span className="lift-card-foot">
                  <span className="muted">last {weeks} weeks</span>
                  <span>
                    <strong className={fit.slope - fit.slopeHalfWidth > 0 ? "rising" : undefined}>
                      {formatChange(fit.slope)}
                    </strong>{" "}
                    kg/wk{" "}
                    <span className="muted">
                      [{formatChange(fit.slope - fit.slopeHalfWidth)} to {formatChange(fit.slope + fit.slopeHalfWidth)}]
                    </span>
                  </span>
                </span>
              </>
            )}
          </Link>
        );
      })}
    </>
  );
};
