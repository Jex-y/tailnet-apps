import { type FormEvent, useRef, useState } from "react";
import type { Exercise } from "../../../../contract";
import type { LoggedSet } from "../../../../log";
import { ConfirmButton } from "../../../components/ConfirmButton";
import { Icon } from "../../../components/Icon";
import { useDockPlacement } from "../hooks/useDockPlacement";
import { DECIMAL, type Draft, draftOf, FIELDS, type Field, type Parsed, parseDraft } from "../utils/draft";
import type { SetValues } from "../utils/plan";
import { RPES } from "../utils/session";
import { RestBar } from "./RestTimer";

/** The figures typed in, checked. */
export type Figures = Extract<Parsed, { ok: true }>["values"];

/**
 * What the dock is for. `ready` takes the next set's figures and logs it, or it and every set after it; `rate` asks how
 * hard the set just logged was while the rest runs, and still logs the next one; `edit` corrects a set already logged;
 * `idle` has nothing to log.
 */
export type DockMode =
  | {
      readonly kind: "ready";
      readonly label: string;
      readonly values: SetValues;
      /** How many sets the exercise has still to do, this one included. */
      readonly remaining: number;
      readonly onKind: (kind: SetValues["kind"]) => void;
      readonly onLog: (figures: Figures) => void;
      /** Logs this set as typed and the rest as planned, as when catching up on an exercise after the fact. */
      readonly onLogAll: (figures: Figures) => void;
    }
  | {
      readonly kind: "rate";
      readonly label: string;
      readonly set: LoggedSet;
      readonly since: string | null;
      /** The set the big button logs next, if there is one. */
      readonly next: SetValues | null;
      readonly onRate: (rpe: number) => void;
      /** Stops asking, leaving the set as it is. */
      readonly onSkip: () => void;
      readonly onLog: (figures: Figures) => void;
      readonly onAddSet: () => void;
    }
  | {
      readonly kind: "edit";
      readonly label: string;
      readonly set: LoggedSet;
      readonly onKind: (kind: SetValues["kind"]) => void;
      readonly onSave: (figures: Figures) => void;
      readonly onRemove: () => void;
    }
  | { readonly kind: "idle"; readonly label: string; readonly onAddSet: () => void };

/** How the exercise being logged is loaded and counted, which names the fields. */
type Counting = Pick<Exercise, "measure" | "bodyweight">;

const unitsOf = ({ measure, bodyweight }: Counting): Record<Field, string> => ({
  weightKg: bodyweight ? "+kg" : "kg",
  count: measure === "reps" ? "reps" : "s",
  rpe: "RPE",
});
const namesOf = ({ measure, bodyweight }: Counting): Record<Field, string> => ({
  weightKg: bodyweight ? "Weight added" : "Weight",
  count: measure === "reps" ? "Reps" : "Seconds",
  rpe: "RPE",
});

/** The figures the dock opens with: the set being corrected, else the one about to be lifted. */
const startingDraft = (mode: DockMode): Draft | null => {
  switch (mode.kind) {
    case "ready":
      return draftOf(mode.values);
    case "edit":
      return draftOf(mode.set);
    case "rate":
      return mode.next === null ? null : draftOf(mode.next);
    case "idle":
      return null;
  }
};

const KindToggle = ({
  kind,
  onKind,
}: {
  readonly kind: SetValues["kind"];
  readonly onKind: (kind: SetValues["kind"]) => void;
}) => (
  <button
    type="button"
    className="dock-chip"
    aria-pressed={kind === "warmup"}
    onClick={() => onKind(kind === "warmup" ? "work" : "warmup")}
  >
    Warm-up
  </button>
);

type Props = {
  readonly mode: DockMode;
  readonly exercise: Counting;
  /** Folded down to its label and big button, out of the way of the page, while logging or rating a set. */
  readonly stowed: boolean;
  readonly onStow: (stowed: boolean) => void;
};

/**
 * The controls, docked above the tab bar where the thumb rests, and above the system keyboard while it is up. Figures
 * go in on the system keyboard: tap a field, type over what it held, and the big button or Enter logs the set. Stowed,
 * or with nothing to type, it folds down to its label and big button, which stays where it was. It takes its mode
 * afresh when given a new `key`.
 */
export const Dock = ({ mode, exercise, stowed, onStow }: Props) => {
  const [draft, setDraft] = useState(() => startingDraft(mode));
  const [invalid, setInvalid] = useState<readonly Field[]>([]);
  const dock = useRef<HTMLFormElement>(null);
  const inputs = useRef<Partial<Record<Field, HTMLInputElement | null>>>({});
  useDockPlacement(dock);
  // A set being corrected was tapped for, so it always shows its figures.
  const stowable = mode.kind === "ready" || mode.kind === "rate";
  const compact = mode.kind === "idle" || (stowable && stowed);

  const commit = (use: (figures: Figures) => void) => {
    if (draft === null) {
      return;
    }
    const parsed = parseDraft(draft, exercise.measure);
    if (parsed.ok) {
      use(parsed.values);
      return;
    }
    setInvalid(parsed.invalid);
    const [first] = parsed.invalid;
    if (first !== undefined) {
      inputs.current[first]?.focus();
    }
  };
  const done = (event: FormEvent) => {
    event.preventDefault();
    switch (mode.kind) {
      case "ready":
        return commit(mode.onLog);
      case "edit":
        return commit(mode.onSave);
      case "rate":
        return mode.next === null ? mode.onAddSet() : commit(mode.onLog);
      case "idle":
        return mode.onAddSet();
    }
  };

  const [units, names] = [unitsOf(exercise), namesOf(exercise)];
  const weight = draft?.weightKg.trim() || "–";
  const count = draft?.count.trim() || "–";
  const logLabel =
    mode.kind === "edit"
      ? "Save"
      : mode.kind === "idle" || (mode.kind === "rate" && mode.next === null)
        ? "Add a set"
        : `Done · ${exercise.bodyweight ? (weight === "0" ? "BW" : `BW+${weight}`) : weight} × ${count}${
            exercise.measure === "seconds" && count !== "–" ? "s" : ""
          }`;

  return (
    <form
      ref={dock}
      className={`dock ${mode.kind}${compact ? " compact" : ""}`}
      aria-label="Set controls"
      noValidate
      onSubmit={done}
    >
      <div className="dock-head">
        <p className="dock-label numeric">{mode.label}</p>
        {mode.kind === "ready" && !compact && mode.remaining > 1 && (
          <button type="button" className="dock-chip" onClick={() => commit(mode.onLogAll)}>
            Log all {mode.remaining}
          </button>
        )}
        {mode.kind === "ready" && !compact && <KindToggle kind={mode.values.kind} onKind={mode.onKind} />}
        {mode.kind === "edit" && (
          <>
            <KindToggle kind={mode.set.kind} onKind={mode.onKind} />
            <ConfirmButton className="dock-chip" confirm="Delete it?" onConfirm={mode.onRemove}>
              Delete
            </ConfirmButton>
          </>
        )}
        {mode.kind === "rate" && !compact && (
          <button type="button" className="dock-chip" onClick={mode.onSkip}>
            Skip
          </button>
        )}
        {stowable && (
          <button
            type="button"
            className="dock-chip dock-stow"
            aria-label={stowed ? "Show the set controls" : "Hide the set controls"}
            aria-expanded={!stowed}
            onClick={() => onStow(!stowed)}
          >
            <Icon name={stowed ? "up" : "down"} />
          </button>
        )}
      </div>

      {/* While the last set is rated the next one's figures wait, so the rest and the ratings have the room. */}
      {!compact && draft !== null && mode.kind !== "rate" && (
        <div className="dock-fields">
          {FIELDS.map((field) => (
            <label key={field} className="dock-field numeric">
              <input
                ref={(input) => {
                  inputs.current[field] = input;
                }}
                className="dock-value"
                inputMode={DECIMAL[field] ? "decimal" : "numeric"}
                enterKeyHint="done"
                autoComplete="off"
                maxLength={7}
                value={draft[field]}
                placeholder="–"
                aria-label={names[field]}
                aria-invalid={invalid.includes(field)}
                // Typing replaces what the field held, so a new weight never needs clearing first.
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => {
                  setDraft({ ...draft, [field]: event.target.value });
                  setInvalid(invalid.filter((other) => other !== field));
                }}
              />
              <span className="dock-unit">{units[field]}</span>
            </label>
          ))}
        </div>
      )}

      {mode.kind === "rate" && !compact && (
        <div className="dock-rate">
          <RestBar since={mode.since} />
          <fieldset className="dock-rpe">
            <legend className="visually-hidden">{mode.label}</legend>
            {RPES.map((rpe) => (
              <button
                key={rpe}
                type="button"
                className="numeric"
                aria-pressed={mode.set.rpe === rpe}
                aria-label={`RPE ${rpe}`}
                onClick={() => mode.onRate(rpe)}
              >
                {rpe}
              </button>
            ))}
          </fieldset>
        </div>
      )}

      <button type="submit" className="dock-log">
        <Icon name="check" />
        {logLabel}
      </button>
    </form>
  );
};
