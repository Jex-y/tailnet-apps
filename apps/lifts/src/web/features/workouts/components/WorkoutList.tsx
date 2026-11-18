import { Link } from "wouter";
import type { WorkoutDetail } from "../../../../log";
import { bestEstimate, tonnage } from "../../../../strength";
import { dayBadge, formatKg, formatSet } from "../../../utils/format";

/** Workouts as given, each a card: its day, each exercise with its top set, and what was lifted in all. */
export const WorkoutList = ({ workouts }: { readonly workouts: readonly WorkoutDetail[] }) => (
  <ul className="workouts">
    {workouts.map((workout) => {
      const { weekday, day } = dayBadge(workout.date);
      return (
        <li key={workout.id}>
          <Link href={`/workouts/${workout.id}`} className="card workout">
            <time dateTime={workout.date} className="day">
              <span className="label">{weekday}</span>
              <strong className="numeric">{day}</strong>
            </time>
            <span className="workout-lines">
              {workout.name !== null && <strong className="workout-name">{workout.name}</strong>}
              {workout.entries.length === 0 && <span className="muted">Nothing logged</span>}
              {workout.entries.map((entry) => {
                const top = bestEstimate(entry.sets)?.set ?? entry.sets.at(-1);
                return (
                  <span key={entry.id} className="workout-line">
                    <span>{entry.exercise.name}</span>
                    <span className="numeric">{top === undefined ? "" : formatSet(top, entry.exercise)}</span>
                  </span>
                );
              })}
              <span className="workout-foot">
                {workout.finishedAt === null && <span className="badge">Under way</span>}
                <span className="numeric">{formatKg(tonnage(workout.entries.flatMap((entry) => entry.sets)))} kg</span>
              </span>
            </span>
          </Link>
        </li>
      );
    })}
  </ul>
);
