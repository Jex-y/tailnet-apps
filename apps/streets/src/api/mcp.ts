import { type AppMcp, HttpError, type McpServer, toolResult } from "@apps/core";
import { z } from "zod";
import { COMPLETION_PERCENT, MATCH_RADIUS_METRES, UpdateStrava } from "../contract";
import { MAX_NEARBY_METRES, type StreetsService } from "./service";

const INSTRUCTIONS = `The connected person's progress towards running every street in London, as CityStrides counts it.

- A street is every named road of one name within one borough. It is made of nodes about 50 m apart, and a node is run
  once a GPS track passes within ${MATCH_RADIUS_METRES} m of it. A street is complete at ${COMPLETION_PERCENT}% of its
  nodes; state is complete, partial or untouched.
- Runs come from Strava, checked every half hour during the day, or from uploaded GPX files. Walks, hikes and bike
  rides count too once switched on. Each new Strava activity sends the person a notification. Connecting Strava needs a
  browser: send the person to the app's Connect page. Everything else can be done here.
- Positions are WGS84 latitude and longitude in degrees, and only Greater London is tracked.
- The street network is imported from OpenStreetMap monthly and is the same for everyone; progress, runs and the
  Strava connection are the connected person's own.`;

const Lat = z.number().min(-90).max(90).describe("Latitude in degrees");
const Lon = z.number().min(-180).max(180).describe("Longitude in degrees");

const registerTools = (service: StreetsService, server: McpServer, login: string) => {
  const read = { readOnlyHint: true, openWorldHint: false } as const;
  const change = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
  const repeatable = { ...change, idempotentHint: true } as const;

  server.registerTool(
    "get_street_progress",
    {
      description:
        "Streets and nodes run overall and per borough, the streets completed most recently, new streets per week " +
        "for the last year and the current weekly streak.",
      annotations: read,
    },
    () => toolResult(() => service.stats(login)),
  );
  server.registerTool(
    "list_runs",
    {
      description: "The person's imported runs, newest first, each with how many streets it was the one to complete.",
      inputSchema: { limit: z.number().int().min(1).max(300).default(30) },
      annotations: read,
    },
    ({ limit }) => toolResult(() => service.activities(login, limit)),
  );
  server.registerTool(
    "suggest_streets",
    {
      description:
        "Where to run next from a starting point: up to five clusters of unfinished streets within 3 km, best first, " +
        "ranked by new streets per kilometre of travel.",
      inputSchema: { lat: Lat, lon: Lon },
      annotations: read,
    },
    ({ lat, lon }) => toolResult(() => service.suggestions(login, [lat, lon])),
  );
  server.registerTool(
    "list_streets_near",
    {
      description: "Streets centred within a radius of a point, nearest first, with the person's progress on each.",
      inputSchema: {
        lat: Lat,
        lon: Lon,
        radiusMetres: z.number().int().min(50).max(MAX_NEARBY_METRES).default(500),
      },
      annotations: read,
    },
    ({ lat, lon, radiusMetres }) => toolResult(() => service.streetsNear(login, [lat, lon], radiusMetres)),
  );
  server.registerTool(
    "get_streets_status",
    {
      description:
        "Whether Strava is connected and how its import is going, the person's runs by import status, and the size " +
        "and age of the street network.",
      annotations: read,
    },
    () =>
      toolResult(async () => ({ strava: await service.stravaStatus(login), network: await service.networkStatus() })),
  );
  server.registerTool(
    "set_counted_activities",
    {
      description:
        "Chooses whether Strava walks and hikes, and bike rides, count as well as runs. A setting left out is " +
        "kept. Turning either on re-reads the whole history.",
      inputSchema: { includeWalks: z.boolean().optional(), includeRides: z.boolean().optional() },
      annotations: repeatable,
    },
    (change) =>
      toolResult(async () => {
        const update = UpdateStrava.safeParse(change);
        if (!update.success) {
          throw new HttpError(400, z.prettifyError(update.error));
        }
        return service.setIncluded(login, update.data);
      }),
  );
  server.registerTool(
    "reimport_strava_history",
    {
      description: "Reads the person's whole Strava history again, for runs the half-hourly check has missed.",
      annotations: repeatable,
    },
    () =>
      toolResult(async () => {
        await service.restartBackfill(login);
        return service.stravaStatus(login);
      }),
  );
  server.registerTool(
    "disconnect_strava",
    {
      description:
        "Revokes and forgets the Strava connection. Runs already imported, and the streets they completed, are kept.",
      annotations: { ...change, destructiveHint: true },
    },
    () =>
      toolResult(async () => {
        await service.disconnect(login);
        return service.stravaStatus(login);
      }),
  );
  server.registerTool(
    "rematch_runs",
    {
      description:
        "Clears the person's progress and matches every run against the streets again. Progress reads low until it " +
        "finishes, a few minutes later.",
      annotations: repeatable,
    },
    () =>
      toolResult(async () => {
        await service.rematch(login);
        return { queued: true };
      }),
  );
  server.registerTool(
    "refresh_street_network",
    {
      description:
        "Imports London's streets from OpenStreetMap now rather than at the monthly refresh. Takes about an hour, " +
        "and affects everyone.",
      annotations: { ...repeatable, openWorldHint: true },
    },
    () =>
      toolResult(async () => {
        await service.refreshNetwork();
        return service.networkStatus();
      }),
  );
  server.registerTool(
    "import_gpx",
    {
      description: "Imports a run from the text of a GPX file. A file already imported is counted as a duplicate.",
      inputSchema: {
        filename: z.string().min(1).max(200).describe("Names the run when the file itself does not"),
        gpx: z.string().min(1).describe("The GPX document"),
      },
      annotations: repeatable,
    },
    ({ filename, gpx }) =>
      toolResult(() =>
        service.importGpx(login, [{ filename, bytes: new TextEncoder().encode(gpx), modifiedAt: null }]),
      ),
  );
};

/** Acts on the connected person's own runs and progress only. */
export const createStreetsMcp = (service: StreetsService): AppMcp => ({
  instructions: INSTRUCTIONS,
  listing: "shared",
  registerTools: (server, viewer) => registerTools(service, server, viewer.login),
});
