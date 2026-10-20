import {
  defineRoutes,
  HttpError,
  type IdentityMode,
  parseBody,
  parseParam,
  parseQuery,
  resolveViewer,
} from "@apps/core";
import { z } from "zod";
import { ChangesQuery, IDEMPOTENCY_HEADER, IdempotencyKey, Push } from "../contract";
import type { NotesService } from "./service";

export type NotesRoutesDeps = {
  readonly service: NotesService;
  readonly identity: IdentityMode;
};

const id = (value: string) => parseParam(value, z.uuid());

const idempotencyKey = (request: Request): string => {
  const key = IdempotencyKey.safeParse(request.headers.get(IDEMPOTENCY_HEADER));
  if (!key.success) {
    throw new HttpError(400, `A push needs an ${IDEMPOTENCY_HEADER} header`);
  }
  return key.data;
};

export const createNotesRoutes = ({ service, identity }: NotesRoutesDeps) => {
  const owner = (request: Request) => resolveViewer(identity, request).login;

  return defineRoutes({
    "/notes/api/notebooks": { GET: async (request) => Response.json(await service.notebooks(owner(request))) },
    "/notes/api/pages": { GET: async (request) => Response.json(await service.pages(owner(request))) },
    "/notes/api/pages/:id/changes": {
      GET: async (request) => {
        const { since } = parseQuery(request, ChangesQuery);
        return Response.json(await service.changes(owner(request), id(request.params.id), since));
      },
    },
    "/notes/api/push": {
      POST: async (request) => {
        const login = owner(request);
        const { mutations } = await parseBody(request, Push);
        await service.push(login, idempotencyKey(request), mutations);
        return new Response(null, { status: 204 });
      },
    },
  });
};
