import { LiftSet } from "../../../../contract";
import { ConfirmButton } from "../../../components/ConfirmButton";
import { Icon } from "../../../components/Icon";
import { NumberCell } from "../../../components/NumberCell";
import { formatKg } from "../../../utils/format";
import type { SetValues } from "../utils/plan";
import { RPES, stepReps, stepWeight, WEIGHT_STEPS } from "../utils/session";
import { RestBar } from "./RestTimer";

/**
 * What the dock is for. `ready` sets up the next set and logs it; `rate` asks how hard the set just logged was while
 * the rest runs, and still logs the next one; `edit` corrects a set already logged; `idle` has nothing left to log.
 */
export type DockMode =
  | {
      readonly kind: "ready";
      readonly label: string;
      readonly values: SetValues;
      readonly onChange: (patch: Partial<SetValues>) => void;
      readonly onLog: () => void;
    }
  | {
      readonly kind: "rate";
      readonly label: string;
      readonly set: LiftSet;
      readonly since: string | null;
      readonly next: SetValues | null;
      readonly onRate: (rpe: number) => void;
      /** Stops asking, leaving the set as it is. */
      readonly onSkip: () => void;
      readonly onLog: () => void;
      readonly onAddSet: () => void;
    }
  | {
      readonly kind: "edit";
      readonly label: string;
      readonly set: LiftSet;
      readonly onChange: (patch: Partial<SetValues>) => void;
      readonly onRemove: () => void;
      readonly onClose: () => void;
    }
  | { readonly kind: "idle"; readonly label: string; readonly onAddSet: () => void };

const sized = ({ weightKg, reps }: Pick<SetValues, "weightKg" | "reps">) => `${formatKg(weightKg)} × ${reps}`;

const WeightStep = ({
  value,
  step,
  onChange,
}: {
  readonly value: number;
  readonly step: number;
  readonly onChange: (weightKg: number) => void;
}) => (
  <button
    type="button"
    className="numeric"
    aria-label={`${step < 0 ? "Minus" : "Plus"} ${Math.abs(step)} kilograms`}
    onClick={() => onChange(stepWeight(value, step))}
  >
    {step < 0 ? `−${-step}` : `+${step}`}
  </button>
);

const Weight = ({ value, onChange }: { readonly value: number; readonly onChange: (weightKg: number) => void }) => {
  const [downBig, downSmall, upSmall, upBig] = WEIGHT_STEPS;
  return (
    <div className="dock-weight">
      <WeightStep value={value} step={downBig} onChange={onChange} />
      <WeightStep value={value} step={downSmall} onChange={onChange} />
      <div className="dock-figure">
        <NumberCell
          value={value}
          schema={LiftSet.shape.weightKg}
          label="Weight in kilograms"
          inputMode="decimal"
          onCommit={onChange}
        />
        <span aria-hidden="true">kg</span>
      </div>
      <WeightStep value={value} step={upSmall} onChange={onChange} />
      <WeightStep value={value} step={upBig} onChange={onChange} />
    </div>
  );
};

const Reps = ({ value, onChange }: { readonly value: number; readonly onChange: (reps: number) => void }) => (
  <div className="dock-reps">
    <button type="button" aria-label="One rep fewer" onClick={() => onChange(stepReps(value, -1))}>
      <Icon name="minus" />
    </button>
    <div className="dock-figure">
      <NumberCell value={value} schema={LiftSet.shape.reps} label="Reps" inputMode="numeric" onCommit={onChange} />
      <span aria-hidden="true">reps</span>
    </div>
    <button type="button" aria-label="One rep more" onClick={() => onChange(stepReps(value, 1))}>
      <Icon name="plus" />
    </button>
  </div>
);

const KindToggle = ({
  kind,
  onChange,
}: {
  readonly kind: SetValues["kind"];
  readonly onChange: (patch: Partial<SetValues>) => void;
}) => (
  <button
    type="button"
    className="dock-chip"
    aria-pressed={kind === "warmup"}
    onClick={() => onChange({ kind: kind === "warmup" ? "work" : "warmup" })}
  >
    Warm-up
  </button>
);

/** The big button, always in the same place, so a set can be logged without looking. */
const Log = ({ label, onClick }: { readonly label: string; readonly onClick: () => void }) => (
  <button type="button" className="dock-log" onClick={onClick}>
    <Icon name="check" />
    {label}
  </button>
);

const Ready = ({ mode }: { readonly mode: Extract<DockMode, { kind: "ready" }> }) => (
  <>
    <Weight value={mode.values.weightKg} onChange={(weightKg) => mode.onChange({ weightKg })} />
    <Reps value={mode.values.reps} onChange={(reps) => mode.onChange({ reps })} />
    <div className="dock-row">
      <KindToggle kind={mode.values.kind} onChange={mode.onChange} />
    </div>
    <Log label={`Done · ${sized(mode.values)}`} onClick={mode.onLog} />
  </>
);

const Rate = ({ mode }: { readonly mode: Extract<DockMode, { kind: "rate" }> }) => (
  <>
    <RestBar since={mode.since} />
    <fieldset className="dock-rpe">
      <legend className="visually-hidden">{`RPE for ${sized(mode.set)}`}</legend>
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
      <button type="button" className="dock-skip" onClick={mode.onSkip}>
        Skip
      </button>
    </fieldset>
    {mode.next === null ? (
      <Log label="Add a set" onClick={mode.onAddSet} />
    ) : (
      <Log label={`Done · ${sized(mode.next)}`} onClick={mode.onLog} />
    )}
  </>
);

const Edit = ({ mode }: { readonly mode: Extract<DockMode, { kind: "edit" }> }) => (
  <>
    <Weight value={mode.set.weightKg} onChange={(weightKg) => mode.onChange({ weightKg })} />
    <Reps value={mode.set.reps} onChange={(reps) => mode.onChange({ reps })} />
    <fieldset className="dock-rpe-strip" disabled={mode.set.kind === "warmup"}>
      <legend className="visually-hidden">RPE</legend>
      <button
        type="button"
        aria-pressed={mode.set.rpe === null}
        aria-label="No RPE"
        onClick={() => mode.onChange({ rpe: null })}
      >
        –
      </button>
      {RPES.map((rpe) => (
        <button
          key={rpe}
          type="button"
          className="numeric"
          aria-pressed={mode.set.rpe === rpe}
          aria-label={`RPE ${rpe}`}
          onClick={() => mode.onChange({ rpe })}
        >
          {rpe}
        </button>
      ))}
    </fieldset>
    <div className="dock-row">
      <KindToggle kind={mode.set.kind} onChange={mode.onChange} />
      <ConfirmButton className="dock-chip" confirm="Delete it?" onConfirm={mode.onRemove}>
        Delete set
      </ConfirmButton>
    </div>
    <Log label="Done" onClick={mode.onClose} />
  </>
);

/**
 * The controls, docked at the bottom of the screen where the thumb rests. Its height never changes and its big button
 * never moves, whatever it is doing, so muscle memory finds it.
 */
export const Dock = ({ mode }: { readonly mode: DockMode }) => (
  <section className={`dock ${mode.kind}`} aria-label="Set controls">
    <p className="dock-label numeric">{mode.label}</p>
    {mode.kind === "ready" && <Ready mode={mode} />}
    {mode.kind === "rate" && <Rate mode={mode} />}
    {mode.kind === "edit" && <Edit mode={mode} />}
    {mode.kind === "idle" && <Log label="Add a set" onClick={mode.onAddSet} />}
  </section>
);
