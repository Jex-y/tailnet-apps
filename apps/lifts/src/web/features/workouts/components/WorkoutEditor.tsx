import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { type Exercise, type LiftSet, Workout } from "../../../../contract";
import { sessionsOf, type WorkoutDetail } from "../../../../log";
import { bestEstimate, isRecord, isWorkSet, tonnage } from "../../../../strength";
import { DEFAULT_WINDOW, trend, trendOver } from "../../../../trend";
import { ConfirmButton } from "../../../components/ConfirmButton";
import { Icon } from "../../../components/Icon";
import { useNow } from "../../../hooks/useNow";
import { formatDay, formatElapsed, formatKg, formatSet } from "../../../utils/format";
import { useWorkoutActions } from "../api/workouts";
import {
  doneRows,
  firstSet,
  type Intent,
  lastSession,
  NO_INTENT,
  openRows,
  plannedFrom,
  type Row,
  type SetValues,
  setValues,
  withChange,
} from "../utils/plan";
import { currentEntry, nextPlanned, setName, summariseSets } from "../utils/session";
import { Dock, type DockMode, type Figures } from "./Dock";
import { EntryTable, type Forecast } from "./EntryTable";
import { ExerciseSheet } from "./ExerciseSheet";
import { useRest } from "./RestTimer";

type Props = {
  readonly workout: WorkoutDetail;
  readonly workouts: readonly WorkoutDetail[];
  readonly exercises: readonly Exercise[];
};

const Bodyweight = Workout.shape.bodyweightKg.unwrap();

/** Time since the first set, and the rest since the last, ticking on their own so the page around them does not. */
const SessionClock = ({ first, last }: { readonly first: string | null; readonly last: string | null }) => {
  const now = useNow();
  const rest = useRest(last);
  return (
    <span className="session-clock numeric">
      <span>{first === null ? "0:00" : formatElapsed(now - Date.parse(first))}</span>
      {rest !== null && <span className="muted">rest {formatElapsed(rest)}</span>}
    </span>
  );
};

/**
 * One workout, open to change whether it is under way or long finished. Under way, finished exercises fold to a line,
 * the one being lifted is a table, the rest wait below, and the dock at the bottom logs each set. Finished, an exercise
 * added or given another set is laid out to log as it would be under way, so one done after the fact is caught up on
 * in a tap or two.
 */
export const WorkoutEditor = ({ workout, workouts, exercises }: Props) => {
  const actions = useWorkoutActions();
  const [, navigate] = useLocation();
  const [picking, setPicking] = useState(false);
  const [intents, setIntents] = useState<ReadonlyMap<string, Intent>>(new Map());
  const [chosen, setChosen] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ readonly entryId: string; readonly index: number } | null>(null);
  const [ratingId, setRatingId] = useState<string | null>(null);
  const [stowed, setStowed] = useState(false);
  const [title, setTitle] = useState(workout.name ?? "");
  // The name Claude gives arrives with a sync, likely while the finished workout is open.
  useEffect(() => setTitle(workout.name ?? ""), [workout.name]);
  const [notes, setNotes] = useState(workout.notes);
  const [bodyweight, setBodyweight] = useState(workout.bodyweightKg === null ? "" : String(workout.bodyweightKg));

  const underWay = workout.finishedAt === null;
  const others = workouts.filter((other) => other.id !== workout.id && other.date <= workout.date);
  const plans = workout.entries.map((entry) => {
    const template = lastSession(workouts, workout, entry.exerciseId)?.sets ?? [];
    const intent = intents.get(entry.id) ?? NO_INTENT;
    const history = sessionsOf(others, entry.exerciseId);
    return {
      id: entry.id,
      entry,
      template,
      intent,
      history,
      rows:
        underWay || entry.id === chosen
          ? openRows(entry.sets, template, intent, firstSet(entry.exercise))
          : doneRows(entry.sets, template),
      before: history.flatMap((session) => session.sets),
      lastBestKg: bestEstimate(template)?.maxKg ?? null,
    };
  });
  type Plan = (typeof plans)[number];

  const sets = workout.entries.flatMap((entry) => entry.sets);
  const loggedTimes = sets.map((set) => set.loggedAt).sort();
  const current = underWay
    ? currentEntry(plans, (plan) => plan.rows, chosen)
    : (plans.find((plan) => plan.entry.id === chosen) ?? null);
  const picked = plans.find((plan) => plan.entry.id === selection?.entryId);
  const pickedRow = picked?.rows.find((row) => row.index === selection?.index);
  const next = current === null ? null : nextPlanned(current.rows);
  const rated = plans.flatMap((plan) =>
    plan.entry.sets.filter((set) => set.id === ratingId).map((set) => ({ plan, set })),
  )[0];

  const forecast = ({ history }: Plan): Forecast | null => {
    const fit = trendOver(trend(history), workout.date, DEFAULT_WINDOW.weeks).fit;
    return fit === null ? null : { maxKg: fit.at(0), halfWidth: fit.confidenceHalfWidth(0) };
  };
  const setIntent = (entryId: string, intent: Intent) => setIntents(new Map(intents).set(entryId, intent));
  const choose = (entryId: string) => {
    setChosen(entryId);
    setSelection(null);
  };
  const change = (plan: Plan, row: Row, patch: Partial<SetValues>) => {
    if (row.kind === "logged") {
      actions.updateSet(row.set, patch);
    } else {
      setIntent(plan.entry.id, withChange(plan.rows, plan.intent, row.index, patch));
    }
  };
  type Planned = Extract<Row, { kind: "planned" }>;
  /** After the last set still to do, the exercise is no longer the one chosen. */
  const logged = (plan: Plan, row: Planned, all: boolean) => {
    setSelection(null);
    if (
      chosen === plan.entry.id &&
      (all || !plan.rows.some((other) => other.kind === "planned" && other.index > row.index))
    ) {
      setChosen(null);
    }
  };
  const log = (plan: Plan, row: Planned, figures: Figures) => {
    const values = { ...row.values, ...figures };
    // A weight, rep count or time typed in carries down to the sets still to do that matched it.
    const { weightKg, reps, seconds } = values;
    setIntent(plan.entry.id, withChange(plan.rows, plan.intent, row.index, { weightKg, reps, seconds }));
    const id = actions.addSet(plan.entry, values, row.index);
    // A work set lifted just now is asked its RPE, unless one was typed in with it.
    setRatingId(underWay && values.kind === "work" && values.rpe === null ? id : null);
    logged(plan, row, false);
  };
  const logAll = (plan: Plan, row: Planned, figures: Figures) => {
    actions.addSets(plan.entry, plannedFrom(plan.rows, plan.intent, row.index, { ...row.values, ...figures }));
    setRatingId(null);
    logged(plan, row, true);
  };
  /** One more set to do, which the dock then offers to log. */
  const addSet = (plan: Plan) => {
    setIntent(plan.entry.id, { ...plan.intent, extra: plan.rows.length - plan.template.length + 1 });
    choose(plan.entry.id);
  };
  const remove = (plan: Plan, set: LiftSet, index: number) => {
    actions.removeSet(set);
    // Gone from the log, it goes back to being a set still to do, as it was lifted.
    setIntent(plan.entry.id, {
      ...plan.intent,
      changes: new Map(plan.intent.changes).set(index, { ...setValues(set), rpe: null }),
    });
    setSelection(null);
    if (ratingId === set.id) {
      setRatingId(null);
    }
  };
  const select = (plan: Plan, index: number) => {
    const same = selection?.entryId === plan.entry.id && selection.index === index;
    setSelection(same ? null : { entryId: plan.entry.id, index });
    // A row tapped is a row to work on, so its figures show.
    setStowed(false);
  };
  const saveBodyweight = () => {
    const typed = bodyweight.trim().replace(",", ".");
    const parsed = typed === "" ? null : Bodyweight.safeParse(Number(typed));
    if (parsed !== null && !parsed.success) {
      setBodyweight(workout.bodyweightKg === null ? "" : String(workout.bodyweightKg));
    } else if ((parsed?.data ?? null) !== workout.bodyweightKg) {
      actions.update(workout, { bodyweightKg: parsed?.data ?? null });
    }
  };

  const label = (plan: Plan, row: Row) =>
    `${plan.entry.exercise.name} · ${row.kind === "logged" ? "editing " : ""}${setName(plan.rows, row.index)}`;
  const rowKey = (plan: Plan, row: Row) => `${plan.entry.id}:${row.index}`;
  const remainingFrom = (plan: Plan, from: Row) =>
    plan.rows.filter((row) => row.kind === "planned" && row.index >= from.index).length;
  const dock = ((): { readonly key: string; readonly mode: DockMode; readonly exercise: Exercise } | null => {
    if (picked !== undefined && pickedRow !== undefined) {
      const { exercise } = picked.entry;
      return pickedRow.kind === "logged"
        ? {
            key: `edit:${pickedRow.set.id}`,
            exercise,
            mode: {
              kind: "edit",
              label: label(picked, pickedRow),
              set: pickedRow.set,
              onKind: (kind) => change(picked, pickedRow, { kind }),
              onSave: (figures) => {
                actions.updateSet(pickedRow.set, figures);
                setSelection(null);
              },
              onRemove: () => remove(picked, pickedRow.set, pickedRow.index),
            },
          }
        : {
            key: rowKey(picked, pickedRow),
            exercise,
            mode: {
              kind: "ready",
              label: label(picked, pickedRow),
              values: pickedRow.values,
              remaining: remainingFrom(picked, pickedRow),
              onKind: (kind) => change(picked, pickedRow, { kind }),
              onLog: (figures) => log(picked, pickedRow, figures),
              onLogAll: (figures) => logAll(picked, pickedRow, figures),
            },
          };
    }
    if (current === null) {
      return null;
    }
    const { exercise } = current.entry;
    if (rated !== undefined) {
      return {
        // Keyed as the set it logs next, so figures typed for it outlast the question.
        key: next === null ? "rate" : rowKey(current, next),
        exercise,
        mode: {
          kind: "rate",
          label: `How hard was ${formatSet(rated.set, rated.plan.entry.exercise)}? · ${rated.plan.entry.exercise.name}`,
          set: rated.set,
          since: loggedTimes.at(-1) ?? null,
          next: next?.values ?? null,
          onRate: (rpe) => {
            actions.updateSet(rated.set, { rpe });
            setRatingId(null);
          },
          onSkip: () => setRatingId(null),
          onLog: (figures) => next !== null && log(current, next, figures),
          onAddSet: () => addSet(current),
        },
      };
    }
    return next === null
      ? {
          key: "idle",
          exercise,
          mode: {
            kind: "idle",
            label: `${current.entry.exercise.name} · all sets done`,
            onAddSet: () => addSet(current),
          },
        }
      : {
          key: rowKey(current, next),
          exercise,
          mode: {
            kind: "ready",
            label: label(current, next),
            values: next.values,
            remaining: remainingFrom(current, next),
            onKind: (kind) => change(current, next, { kind }),
            onLog: (figures) => log(current, next, figures),
            onLogAll: (figures) => logAll(current, next, figures),
          },
        };
  })();
  const selectedIn = (plan: Plan) =>
    selection?.entryId === plan.entry.id
      ? selection.index
      : dock?.mode.kind === "ready" && current === plan && next !== null
        ? next.index
        : null;

  const records = plans.flatMap(({ entry, before }) => {
    const best = bestEstimate(entry.sets);
    return best !== null && isRecord(best.set, before)
      ? [{ id: entry.id, name: entry.exercise.name, maxKg: best.maxKg }]
      : [];
  });
  const rpes = sets.filter(isWorkSet).flatMap(({ rpe }) => (rpe === null ? [] : [rpe]));
  const currentAt = current === null ? -1 : plans.indexOf(current);

  return (
    <>
      <div className={underWay ? "session-bar" : "session-bar finished"}>
        <label className="session-day">
          <span className="label">{underWay ? "Under way" : (workout.name ?? "Finished")}</span>
          <strong>{formatDay(workout.date)}</strong>
          <input
            type="date"
            value={workout.date}
            aria-label="Training day"
            onChange={(event) => event.target.value !== "" && actions.update(workout, { date: event.target.value })}
          />
        </label>
        {underWay && <SessionClock first={loggedTimes[0] ?? null} last={loggedTimes.at(-1) ?? null} />}
        <button
          type="button"
          className={underWay ? "primary" : undefined}
          onClick={() => {
            if (underWay) {
              actions.finish(workout);
            } else {
              actions.update(workout, { finishedAt: null });
            }
            navigate(underWay ? `/workouts/${workout.id}` : "/");
          }}
        >
          {underWay ? "Finish" : "Reopen"}
        </button>
      </div>

      {!underWay && records.length > 0 && (
        <ul className="card records-made">
          {records.map((record) => (
            <li key={record.id}>
              <span className="pr">PR</span>
              <span>{record.name}</span>
              <span className="numeric">
                {formatKg(record.maxKg)}
                <small>kg est. max</small>
              </span>
            </li>
          ))}
        </ul>
      )}

      {plans.map((plan, at) => {
        const { entry } = plan;
        if (!underWay || at === currentAt) {
          return (
            <EntryTable
              key={entry.id}
              entry={entry}
              rows={plan.rows}
              lastBestKg={plan.lastBestKg}
              before={plan.before}
              forecast={forecast(plan)}
              selected={selectedIn(plan)}
              ratingId={dock?.mode.kind === "rate" ? dock.mode.set.id : null}
              onSelect={(index) => select(plan, index)}
              onAddSet={() => addSet(plan)}
              actions={actions}
            />
          );
        }
        if (at < currentAt) {
          const best = bestEstimate(entry.sets);
          return (
            <button key={entry.id} type="button" className="card entry-folded numeric" onClick={() => choose(entry.id)}>
              <Icon name="check" />
              <strong>{entry.exercise.name}</strong>
              <span className="muted">{summariseSets(entry.sets, entry.exercise) || "No work sets"}</span>
              <span>{best === null ? "" : formatKg(best.maxKg)}</span>
              {records.some((record) => record.id === entry.id) && <span className="pr">PR</span>}
            </button>
          );
        }
        return (
          <button key={entry.id} type="button" className="entry-next numeric" onClick={() => choose(entry.id)}>
            {at === currentAt + 1 && <span className="label">Next</span>}
            <strong>{entry.exercise.name}</strong>
            <span className="muted">{summariseSets(plan.template, entry.exercise) || "New"}</span>
          </button>
        );
      })}

      <button type="button" className="add-exercise" onClick={() => setPicking(true)}>
        <Icon name="plus" />
        {workout.entries.length === 0 ? "Add your first exercise" : "Add exercise"}
      </button>
      {picking && (
        <ExerciseSheet
          exercises={exercises}
          workouts={workouts}
          onClose={() => setPicking(false)}
          onPick={(exerciseId) => {
            choose(actions.addEntry(workout, exerciseId));
            setPicking(false);
          }}
        />
      )}

      <section className="card session-meta">
        <dl className="tallies">
          <div>
            <dt className="label">Work sets</dt>
            <dd className="numeric">{sets.filter(isWorkSet).length}</dd>
          </div>
          <div>
            <dt className="label">Lifted</dt>
            <dd className="numeric">
              {formatKg(tonnage(sets) / 1000)}
              <small>t</small>
            </dd>
          </div>
          <div>
            <dt className="label">Mean RPE</dt>
            <dd className="numeric">
              {rpes.length === 0 ? "–" : formatKg(rpes.reduce((sum, rpe) => sum + rpe, 0) / rpes.length)}
            </dd>
          </div>
          <div>
            <dt className="label">Bodyweight</dt>
            <dd>
              <input
                className="numeric"
                inputMode="decimal"
                value={bodyweight}
                placeholder="–"
                aria-label="Bodyweight in kilograms"
                onChange={(event) => setBodyweight(event.target.value)}
                onBlur={saveBodyweight}
              />
              <small>kg</small>
            </dd>
          </div>
        </dl>
        <input
          className="session-name"
          value={title}
          placeholder={underWay ? "Named once finished" : "Name"}
          aria-label="Name of the session"
          maxLength={80}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => {
            const typed = title.trim();
            // A name can be changed but not cleared: blank leaves it as it was.
            if (typed === "") {
              setTitle(workout.name ?? "");
            } else if (typed !== workout.name) {
              actions.update(workout, { name: typed });
            }
          }}
        />
        <textarea
          rows={2}
          value={notes}
          placeholder="Notes on the session"
          aria-label="Notes on the session"
          maxLength={10_000}
          onChange={(event) => setNotes(event.target.value)}
          onBlur={() => notes !== workout.notes && actions.update(workout, { notes })}
        />
        <ConfirmButton
          className="quiet-link"
          confirm="Delete the whole workout?"
          onConfirm={() => {
            actions.remove(workout);
            navigate(underWay ? "/" : "/history");
          }}
        >
          Delete workout
        </ConfirmButton>
      </section>

      {dock !== null && (
        <Dock key={dock.key} mode={dock.mode} exercise={dock.exercise} stowed={stowed} onStow={setStowed} />
      )}
    </>
  );
};
