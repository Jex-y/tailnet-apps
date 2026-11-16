import { useState } from "react";
import { Link, useLocation } from "wouter";
import { COMPETITION_LIFTS, type Exercise } from "../../../../contract";
import { type Session, sessionsOf, type WorkoutDetail } from "../../../../log";
import { bestEstimate, isWorkSet, repRecords } from "../../../../strength";
import { DEFAULT_WINDOW, trend, trendOver, type Window, weeksFrom } from "../../../../trend";
import { ConfirmButton } from "../../../components/ConfirmButton";
import { Icon } from "../../../components/Icon";
import { dayBadge, formatDay, formatKg, formatSet, formatWeight, localToday } from "../../../utils/format";
import { useExerciseActions } from "../api/exercises";
import { LIFT_NAMES } from "../utils/lifts";
import { atTodaysLevel, repProfile } from "../utils/progress";
import { RepProfileCard } from "./RepProfileCard";
import { StyleSelect } from "./StyleSelect";
import { TrendCard } from "./TrendCard";

type Props = {
  readonly exercises: readonly Exercise[];
  readonly workouts: readonly WorkoutDetail[];
  readonly exerciseId: string;
};

const sessionMax = (sets: Session["sets"]): string => {
  const best = bestEstimate(sets);
  return best === null ? "" : `est. max ${formatKg(best.maxKg)} kg`;
};

/** The longest work set of a timed exercise, as `60s`. */
const longest = (sets: Session["sets"]): string => {
  const seconds = sets.filter(isWorkSet).flatMap(({ seconds }) => (seconds === null ? [] : [seconds]));
  return seconds.length === 0 ? "–" : `${Math.max(...seconds)}s`;
};

const History = ({ exercise, sessions }: { readonly exercise: Exercise; readonly sessions: readonly Session[] }) => {
  const [window, setWindow] = useState<Window>(DEFAULT_WINDOW);
  const today = localToday();
  const within = sessions.filter(
    ({ workout }) => window.weeks === null || weeksFrom(workout.date, today) >= -window.weeks,
  );
  const fitted = trendOver(trend(sessions), today, window.weeks);
  const profile = repProfile(atTodaysLevel(within, fitted.fit, today));
  const all = sessions.flatMap((session) => session.sets);
  const dateOf = new Map(sessions.flatMap(({ workout, sets }) => sets.map((set) => [set.id, workout.date] as const)));
  const records = repRecords(all);
  const best = bestEstimate(all);
  const timed = exercise.measure === "seconds";

  return (
    <>
      <dl className="card standings">
        <div className="total">
          <dt className="label">{timed ? "Longest" : "Est. max"}</dt>
          <dd className="numeric">{timed ? longest(all) : best === null ? "–" : formatKg(best.maxKg)}</dd>
        </div>
        <div>
          <dt className="label">Sessions</dt>
          <dd className="numeric">{sessions.length}</dd>
        </div>
        <div>
          <dt className="label">Work sets</dt>
          <dd className="numeric">{all.filter(isWorkSet).length}</dd>
        </div>
      </dl>
      {!timed && <TrendCard trend={fitted} exercise={exercise} window={window} onWindow={setWindow} />}
      {profile !== null && <RepProfileCard profile={profile} />}
      {records.length > 0 && (
        <section className="card">
          <h2>Rep records</h2>
          <table className="records">
            <thead>
              <tr>
                <th scope="col">Reps</th>
                <th scope="col">Weight</th>
                <th scope="col">Set on</th>
              </tr>
            </thead>
            <tbody>
              {records.map(({ reps, set }) => (
                <tr key={reps}>
                  <td className="numeric">{reps}</td>
                  <td className="numeric">
                    {exercise.bodyweight ? formatWeight(set.weightKg, exercise) : `${formatKg(set.weightKg)} kg`}
                  </td>
                  <td>{formatDay(dateOf.get(set.id) ?? "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <h2>Sessions</h2>
      <ul className="workouts">
        {sessions.toReversed().map(({ workout, sets }) => {
          const { weekday, day } = dayBadge(workout.date);
          return (
            <li key={workout.id}>
              <Link href={`/workouts/${workout.id}`} className="card workout">
                <time dateTime={workout.date} className="day">
                  <span className="label">{weekday}</span>
                  <strong className="numeric">{day}</strong>
                </time>
                <span className="workout-lines">
                  <span className="set-chips numeric">
                    {sets.map((set) => (
                      <span key={set.id} className={isWorkSet(set) ? undefined : "warmup"}>
                        {formatSet(set, exercise)}
                      </span>
                    ))}
                  </span>
                  <span className="workout-foot numeric">{sessionMax(sets)}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
};

export const ExercisePage = ({ exercises, workouts, exerciseId }: Props) => {
  const actions = useExerciseActions();
  const [, navigate] = useLocation();
  const exercise = exercises.find((other) => other.id === exerciseId);
  const [name, setName] = useState(exercise?.name ?? "");

  const back = (
    <Link href="/exercises" className="back-link">
      <Icon name="back" />
      Exercises
    </Link>
  );
  if (exercise === undefined) {
    return (
      <>
        {back}
        <p className="muted">That exercise is not in the log.</p>
      </>
    );
  }
  const taken = (lift: Exercise["lift"]) => exercises.some((other) => other.lift === lift && other.id !== exercise.id);
  const sessions = sessionsOf(workouts, exercise.id);
  const rename = () => {
    const next = name.trim();
    if (next === "") {
      setName(exercise.name);
    } else if (next !== exercise.name) {
      actions.update(exercise, { name: next });
    }
  };

  return (
    <>
      {back}
      <div className="exercise-heading">
        <input
          className="title"
          value={name}
          aria-label="Exercise name"
          maxLength={100}
          onChange={(event) => setName(event.target.value)}
          onBlur={rename}
          onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
        />
        <select
          value={exercise.lift ?? ""}
          aria-label="Competition lift"
          onChange={(event) =>
            actions.update(exercise, { lift: COMPETITION_LIFTS.find((each) => each === event.target.value) ?? null })
          }
        >
          <option value="">Accessory</option>
          {COMPETITION_LIFTS.filter((lift) => !taken(lift)).map((lift) => (
            <option key={lift} value={lift}>
              Competition {LIFT_NAMES[lift].toLowerCase()}
            </option>
          ))}
        </select>
        <StyleSelect
          value={exercise}
          measureFixed={sessions.length > 0}
          onChange={(style) => actions.update(exercise, style)}
        />
      </div>
      {sessions.length === 0 ? (
        <>
          <p className="muted">Not logged yet. Add it to a workout and its records build up here.</p>
          <ConfirmButton
            confirm="Delete this exercise?"
            onConfirm={() => {
              actions.remove(exercise);
              navigate("/exercises");
            }}
          >
            Delete exercise
          </ConfirmButton>
        </>
      ) : (
        <History exercise={exercise} sessions={sessions} />
      )}
    </>
  );
};
