import { defineRoutes, HttpError, type IdentityMode, parseBody, resolveViewer } from "@apps/core";
import { IDEMPOTENCY_HEADER, IdempotencyKey, Push } from "../contract";
import type { LiftsService } from "./service";

export type LiftsRoutesDeps = {
  readonly service: LiftsService;
  readonly identity: IdentityMode;
};

const idempotencyKey = (request: Request): string => {
  const key = IdempotencyKey.safeParse(request.headers.get(IDEMPOTENCY_HEADER));
  if (!key.success) {
    throw new HttpError(400, `A push needs an ${IDEMPOTENCY_HEADER} header`);
  }
  return key.data;
};

export const createLiftsRoutes = ({ service, identity }: LiftsRoutesDeps) => {
  const read =
    <T>(rows: (owner: string) => Promise<T>) =>
    async (request: Request) =>
      Response.json(await rows(resolveViewer(identity, request).login));

  return defineRoutes({
    "/lifts/api/exercises": { GET: read(service.exercises) },
    "/lifts/api/workouts": { GET: read(service.workouts) },
    "/lifts/api/entries": { GET: read(service.entries) },
    "/lifts/api/sets": { GET: read(service.sets) },
    "/lifts/api/programs": { GET: read(service.programs) },
    "/lifts/api/training-maxes": { GET: read(service.trainingMaxes) },
    "/lifts/api/program-days": { GET: read(service.programDays) },
    "/lifts/api/program-exercises": { GET: read(service.programExercises) },
    "/lifts/api/prescriptions": { GET: read(service.prescriptions) },
    "/lifts/api/sessions": { GET: read(service.sessions) },
    "/lifts/api/push": {
      POST: async (request) => {
        const { login } = resolveViewer(identity, request);
        const { mutations } = await parseBody(request, Push);
        await service.push(login, idempotencyKey(request), mutations);
        return new Response(null, { status: 204 });
      },
    },
  });
};
