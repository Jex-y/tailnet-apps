import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import type { LiftSet } from "../../../../contract";
import type { EntryDetail } from "../../../../log";
import { estimatedMax, isRecord, isWorkSet } from "../../../../strength";
import { ConfirmButton } from "../../../components/ConfirmButton";
import { Icon } from "../../../components/Icon";
import { formatChange, formatKg, formatSet } from "../../../utils/format";
import type { WorkoutActions } from "../api/workouts";
import { type Row, valuesOf } from "../utils/plan";

export type Forecast = { readonly maxKg: number; readonly halfWidth: number };

type Props = {
  readonly entry: EntryDetail;
  readonly rows: readonly Row[];
  /** The best estimated max of the exercise's last session, which each set is measured against. */
  readonly lastBestKg: number | null;
  /** Every set of the exercise in other workouts, for spotting a record. */
  readonly before: readonly LiftSet[];
  /** Where the exercise's trend puts its max today, before this workout. */
  readonly forecast: Forecast | null;
  /** The row the dock is working on. */
  readonly selected: number | null;
  /** The set whose RPE the dock is asking for, if it is in this exercise. */
  readonly ratingId: string | null;
  readonly onSelect: (index: number) => void;
  readonly onAddSet: () => void;
  readonly actions: WorkoutActions;
};

/**
 * An exercise as a dense table, a row a set: what was done in its place last time, the weight, reps and RPE, the max
 * it implies and how that compares with last time. Tapping a row hands it to the dock.
 */
export const EntryTable = ({
  entry,
  rows,
  lastBestKg,
  before,
  forecast,
  selected,
  ratingId,
  onSelect,
  onAddSet,
  actions,
}: Props) => {
  const [notes, setNotes] = useState(entry.notes);
  const selectedRow = useRef<HTMLButtonElement>(null);

  // The row being worked on stays in sight between the sticky bar above and the dock below.
  useEffect(() => {
    if (selected !== null) {
      selectedRow.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selected]);
  const total = rows.length;
  // Work sets count 1, 2, 3 among themselves; warm-ups are marked W.
  const workNumbers = rows.map((_, at) => rows.slice(0, at + 1).filter((row) => valuesOf(row).kind === "work").length);

  return (
    <section className="card entry-table" aria-label={entry.exercise.name}>
      <header className="entry-heading">
        <h2>
          <Link href={`/exercises/${entry.exerciseId}`}>{entry.exercise.name}</Link>
        </h2>
        <span className="muted numeric">{selected === null ? `${total} sets` : `set ${selected + 1}/${total}`}</span>
      </header>
      <div className="set-grid label" aria-hidden="true">
        <span>#</span>
        <span>Last</span>
        <span>kg</span>
        <span>Reps</span>
        <span>RPE</span>
        <span>e1RM</span>
        <span>Δ</span>
      </div>
      <ol className="set-rows">
        {rows.map((row) => {
          const { weightKg, reps, rpe, kind } = valuesOf(row);
          const done = row.kind === "logged";
          const rating = done && row.set.id === ratingId;
          // Until it is rated a set would read as all-out, so its max waits for the rating.
          const max = done && !rating && isWorkSet(row.set) ? estimatedMax(row.set) : null;
          const record = done && isRecord(row.set, before);
          const number = kind === "warmup" ? "W" : String(workNumbers[row.index] ?? "");
          const classes = [
            "set-grid",
            "numeric",
            done ? "done" : "to-do",
            kind,
            row.index === selected ? "selected" : "",
          ];
          return (
            <li key={done ? row.set.id : `to-do-${row.index}`}>
              <button
                ref={row.index === selected ? selectedRow : undefined}
                type="button"
                className={classes.join(" ")}
                aria-pressed={row.index === selected}
                aria-label={`Set ${row.index + 1}${kind === "warmup" ? ", warm-up" : ""}: ${formatKg(weightKg)} kilograms for ${reps}${
                  done ? (rpe === null ? "" : ` at RPE ${rpe}`) : ", still to do"
                }`}
                onClick={() => onSelect(row.index)}
              >
                <span className="set-number">{number}</span>
                <span className="set-previous">{row.previous === null ? "–" : formatSet(row.previous)}</span>
                <span>{formatKg(weightKg)}</span>
                <span>{reps}</span>
                <span className={rating ? "up" : undefined}>
                  {rating ? "?" : done && kind === "work" ? (rpe ?? "–") : ""}
                </span>
                <span>{max === null ? "" : formatKg(max)}</span>
                <span className={max !== null && lastBestKg !== null && max > lastBestKg ? "up" : undefined}>
                  {record ? (
                    <span className="pr">PR</span>
                  ) : max === null || lastBestKg === null ? (
                    ""
                  ) : (
                    formatChange(max - lastBestKg)
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {(lastBestKg !== null || forecast !== null) && (
        <p className="entry-context muted numeric">
          {lastBestKg !== null && `Last session ${formatKg(lastBestKg)}`}
          {lastBestKg !== null && forecast !== null && " · "}
          {forecast !== null && `trend today ${formatKg(forecast.maxKg)} ± ${formatKg(forecast.halfWidth)}`}
        </p>
      )}
      <footer className="entry-footer">
        <button type="button" className="add-set" onClick={onAddSet}>
          <Icon name="plus" />
          Set
        </button>
        <input
          value={notes}
          placeholder="Note"
          aria-label={`Notes on ${entry.exercise.name}`}
          maxLength={10_000}
          onChange={(event) => setNotes(event.target.value)}
          onBlur={() => notes !== entry.notes && actions.updateEntry(entry, notes)}
        />
        <ConfirmButton className="quiet-link" confirm="Remove it?" onConfirm={() => actions.removeEntry(entry)}>
          Remove
        </ConfirmButton>
      </footer>
    </section>
  );
};
