import { type FormEvent, useEffect, useRef, useState } from "react";
import type { Exercise } from "../../../../contract";
import type { WorkoutDetail } from "../../../../log";
import { Icon } from "../../../components/Icon";
import { formatDay } from "../../../utils/format";
import { useExerciseActions } from "../../exercises/api/exercises";
import { StyleSelect } from "../../exercises/components/StyleSelect";
import { DEFAULT_STYLE, LIFT_NAMES, missingLifts, type Style, summarise } from "../../exercises/utils/lifts";

type Props = {
  readonly exercises: readonly Exercise[];
  readonly workouts: readonly WorkoutDetail[];
  readonly onPick: (exerciseId: string) => void;
  readonly onClose: () => void;
};

/**
 * Finds an exercise by name as it is typed, or makes one of that name. Covers the screen from the top on a phone,
 * where a sheet rising from the bottom would sit under the keyboard.
 */
export const ExerciseSheet = ({ exercises, workouts, onPick, onClose }: Props) => {
  const create = useExerciseActions().create;
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [style, setStyle] = useState<Style>(DEFAULT_STYLE);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const wanted = query.trim().toLowerCase();
  const recentFirst = summarise(exercises, workouts)
    .filter(({ exercise }) => exercise.name.toLowerCase().includes(wanted))
    .sort(
      (a, b) =>
        (b.lastTrainedOn ?? "").localeCompare(a.lastTrainedOn ?? "") || a.exercise.name.localeCompare(b.exercise.name),
    );
  const exact = exercises.some((exercise) => exercise.name.toLowerCase() === wanted);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const [only] = recentFirst;
    if (wanted !== "" && !exact) {
      onPick(create(query.trim(), null, style));
    } else if (only !== undefined && recentFirst.length === 1) {
      onPick(only.exercise.id);
    }
  };

  return (
    <dialog ref={dialog} className="sheet" aria-label="Add an exercise" onClose={onClose}>
      <form onSubmit={submit}>
        <header className="sheet-heading">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search or name a new exercise"
            aria-label="Exercise name"
            maxLength={100}
            enterKeyHint="done"
          />
          <button type="button" className="quiet" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <ul className="choices">
          {wanted !== "" && !exact && (
            <li className="create-choice">
              <button type="submit" className="choice create">
                <span>Create “{query.trim()}”</span>
                <Icon name="plus" />
              </button>
              <StyleSelect value={style} onChange={setStyle} />
            </li>
          )}
          {recentFirst.map(({ exercise, lastTrainedOn }) => (
            <li key={exercise.id}>
              <button type="button" className="choice" onClick={() => onPick(exercise.id)}>
                <span>{exercise.name}</span>
                <span className="muted">{lastTrainedOn === null ? "New" : formatDay(lastTrainedOn)}</span>
              </button>
            </li>
          ))}
          {wanted === "" &&
            missingLifts(exercises).map((lift) => (
              <li key={lift}>
                <button type="button" className="choice create" onClick={() => onPick(create(LIFT_NAMES[lift], lift))}>
                  <span>{LIFT_NAMES[lift]}</span>
                  <Icon name="plus" />
                </button>
              </li>
            ))}
        </ul>
      </form>
    </dialog>
  );
};
