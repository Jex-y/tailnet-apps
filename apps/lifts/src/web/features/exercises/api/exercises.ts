import { useMemo } from "react";
import { type CompetitionLift, DEFAULT_WEIGHT_STEP_KG, type Exercise } from "../../../../contract";
import { useStore } from "../../../hooks/useStore";
import type { Store } from "../../../lib/store";
import { DEFAULT_STYLE, type Style } from "../utils/lifts";

const actions = (store: Store) => ({
  /** Adds an exercise, answering its id. */
  create: (name: string, lift: CompetitionLift | null = null, style: Style = DEFAULT_STYLE): string => {
    const id = crypto.randomUUID();
    store.write(() => {
      store.exercises.insert({ id, name, lift, weightStepKg: DEFAULT_WEIGHT_STEP_KG, ...style });
    });
    return id;
  },

  update: (
    exercise: Exercise,
    fields: Partial<Pick<Exercise, "name" | "lift" | "weightStepKg" | "measure" | "bodyweight">>,
  ) => {
    store.write(() => {
      store.exercises.update(exercise.id, (draft) => {
        Object.assign(draft, fields);
      });
    });
  },

  remove: (exercise: Exercise) => {
    store.write(() => {
      store.exercises.delete(exercise.id);
    });
  },
});

/** Every change to exercises, shown at once and sent when the server can be reached. */
export const useExerciseActions = () => {
  const store = useStore();
  return useMemo(() => actions(store), [store]);
};
