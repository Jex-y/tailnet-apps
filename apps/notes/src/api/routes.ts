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
import { ChangesQuery, IDEMPOTENCY_HEADER, IdempotencyKey, ImageQuery, MAX_IMAGE_BYTES, Push } from "../contract";
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

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The request body, if it is a PNG small enough to keep. */
const pngBody = async (request: Request): Promise<Blob> => {
  const length = Number(request.headers.get("Content-Length") ?? Number.NaN);
  if (!(length <= MAX_IMAGE_BYTES)) {
    throw new HttpError(413, `An image must say its length, and be at most ${MAX_IMAGE_BYTES} bytes`);
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES || !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    throw new HttpError(400, "An image must be a PNG");
  }
  return new Blob([bytes], { type: "image/png" });
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
    "/notes/api/pages/:id/blocks/:blockId/image": {
      PUT: async (request) => {
        const login = owner(request);
        const { seq } = parseQuery(request, ImageQuery);
        const pageId = id(request.params.id);
        const blockId = id(request.params.blockId);
        await service.putInkImage(login, pageId, blockId, seq, await pngBody(request));
        return new Response(null, { status: 204 });
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
