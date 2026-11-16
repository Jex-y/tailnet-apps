import { type FormEvent, useState } from "react";
import { Link } from "wouter";
import { COMPETITION_LIFTS, type CompetitionLift, type Exercise } from "../../../../contract";
import type { WorkoutDetail } from "../../../../log";
import { formatDay, formatKg } from "../../../utils/format";
import { useExerciseActions } from "../api/exercises";
import { LIFT_NAMES, missingLifts, summarise } from "../utils/lifts";
import { StrengthOverview } from "./StrengthOverview";

type Props = {
  readonly exercises: readonly Exercise[];
  readonly workouts: readonly WorkoutDetail[];
};

const byName = (a: Exercise, b: Exercise) => a.name.localeCompare(b.name);

export const ExercisesPage = ({ exercises, workouts }: Props) => {
  const actions = useExerciseActions();
  const [name, setName] = useState("");
  const [lift, setLift] = useState<CompetitionLift | "">("");

  const summaries = summarise(exercises.toSorted(byName), workouts);
  const free = missingLifts(exercises);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    actions.create(name.trim(), lift === "" ? null : lift);
    setName("");
    setLift("");
  };

  return (
    <>
      <h1>Exercises</h1>
      <StrengthOverview exercises={exercises} workouts={workouts} />
      {summaries.length === 0 && <p className="muted">Exercises you log appear here with their records.</p>}
      {summaries.length > 0 && (
        <ul className="card rows">
          {summaries.map(({ exercise, sessions, lastTrainedOn, bestMaxKg }) => (
            <li key={exercise.id}>
              <Link href={`/exercises/${exercise.id}`} className="row">
                <span className="row-main">
                  <strong>{exercise.name}</strong>
                  <span className="muted">
                    {lastTrainedOn === null
                      ? "Not logged yet"
                      : `${sessions === 1 ? "1 session" : `${sessions} sessions`} · ${formatDay(lastTrainedOn)}`}
                  </span>
                </span>
                {bestMaxKg !== null && (
                  <span className="figure">
                    <span className="label">Est. max</span>
                    <span className="numeric">{formatKg(bestMaxKg)}</span>
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <form className="card new-exercise" onSubmit={submit}>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="New exercise"
          aria-label="Exercise name"
          maxLength={100}
          required
        />
        {free.length > 0 && (
          <select
            value={lift}
            aria-label="Competition lift"
            onChange={(event) => setLift(COMPETITION_LIFTS.find((each) => each === event.target.value) ?? "")}
          >
            <option value="">Accessory</option>
            {free.map((each) => (
              <option key={each} value={each}>
                Competition {LIFT_NAMES[each].toLowerCase()}
              </option>
            ))}
          </select>
        )}
        <button type="submit" disabled={name.trim() === ""}>
          Add
        </button>
      </form>
    </>
  );
};
