import { type AppMcp, type CallToolResult, type McpServer, toolResult } from "@apps/core";
import { z } from "zod";
import {
  CreateDestination,
  CreateSearch,
  CreateViewing,
  PROPERTY_STATUSES,
  type PropertyDetail,
  type PropertySummary,
  Requirements,
  UpdateNotes,
  UpdateStatus,
} from "../contract";
import type { FlatsService, StoredImage } from "./service";

const INSTRUCTIONS = `A shared flat hunt: saved portal searches are polled for new listings, each becoming a property.

- A property's status is where it sits in the hunt: new (untriaged), shortlisted, viewing_booked, viewed, offer_made or
  rejected. Whether it is still on the market is its separate availability.
- The requirements document holds limits on stated facts (size, service charge, lease) that reject a flat, and the
  questions Jev (a reader model) answers from each listing to exclude or score it. A property's ranking is its score
  from those answers, its commutes and its price per sq ft against the untriaged median; higher is better.
- Try a draft of the requirements on one property with try_requirements before saving it; saving re-judges every
  untriaged property and may reject some.
- Commutes are timed by public transport to each destination; a property lists only those already timed.
- A property's sales are what it sold for before, by year, newest first, where the portal knows; lastSale is the
  newest. The requirements can score the year it last sold and how far the asking price is above that sale.
- Photos and floorplans are listed by id on get_property; view_photo shows one.
- Ids are UUIDs; find them with list_properties, list_searches or list_destinations.`;

const Id = (what: string) => z.uuid().describe(`The ${what}'s id`);

/** One line of the hunt per property, small enough to list them all; get_property has the rest. */
const listed = (property: PropertySummary) => ({
  id: property.id,
  status: property.status,
  address: property.address,
  postcode: property.postcode,
  price: property.price,
  ...(property.priceQualifier !== "" && { priceQualifier: property.priceQualifier }),
  availability: property.availability,
  propertyType: property.propertyType,
  bedrooms: property.bedrooms,
  sizeSqft: property.sizeSqft,
  tenure: property.tenure,
  leaseYearsRemaining: property.leaseYearsRemaining,
  annualServiceCharge: property.annualServiceCharge,
  lastSale: property.lastSale,
  commutes: property.commutes.map(({ name, minutes }) => ({ name, minutes })),
  ranking:
    property.ranking.kind === "scored"
      ? { score: property.ranking.total }
      : { excludedBecause: property.ranking.reason },
  firstSeenAt: property.firstSeenAt,
  urls: property.listings.map((listing) => listing.url),
});

/** The property page, with photos by id for view_photo rather than by browser URL. */
const shown = ({ thumbnailUrl: _, photos, viewings, ...property }: PropertyDetail) => ({
  ...property,
  photos: photos.map(({ id, kind }) => ({ id, kind })),
  viewings: viewings.map((viewing) => ({
    ...viewing,
    photos: viewing.photos.map(({ id, filename }) => ({ id, filename })),
  })),
});

const imageResult = ({ data, contentType }: StoredImage): CallToolResult => ({
  content: [{ type: "image", data: Buffer.from(data).toString("base64"), mimeType: contentType }],
});

const registerTools = (service: FlatsService, server: McpServer, login: string) => {
  const read = { readOnlyHint: true, openWorldHint: false } as const;
  const change = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
  const edit = { ...change, idempotentHint: true } as const;
  const remove = { ...change, destructiveHint: true, idempotentHint: true } as const;
  const property = async (id: string) => shown(await service.property(id));

  server.registerTool(
    "list_properties",
    {
      description: "Lists properties newest first, briefly: price, size, tenure, commutes and ranking.",
      inputSchema: {
        status: z
          .enum(PROPERTY_STATUSES)
          .optional()
          .describe("Only properties with this status; most of the hunt is rejected, so filter when you can"),
      },
      annotations: read,
    },
    ({ status }) => toolResult(async () => (await service.properties(status ?? null)).map(listed)),
  );
  server.registerTool(
    "get_property",
    {
      description:
        "Reads one property in full: the listing's description and key features, price history, ranking with each " +
        "contribution, notes, viewings and its photo ids.",
      inputSchema: { propertyId: Id("property") },
      annotations: read,
    },
    ({ propertyId }) => toolResult(() => property(propertyId)),
  );
  server.registerTool(
    "set_property_status",
    {
      description: "Moves a property through the hunt, e.g. shortlists or rejects it.",
      inputSchema: {
        propertyId: Id("property"),
        status: z.enum(PROPERTY_STATUSES),
        reason: z.string().max(500).optional().describe("Why it was rejected; only kept when status is rejected"),
      },
      annotations: edit,
    },
    ({ propertyId, ...update }) =>
      toolResult(async () => {
        await service.setStatus(propertyId, UpdateStatus.parse(update));
        return property(propertyId);
      }),
  );
  server.registerTool(
    "set_property_notes",
    {
      description: "Replaces a property's shared notes.",
      inputSchema: { propertyId: Id("property"), notes: UpdateNotes.shape.notes },
      annotations: edit,
    },
    ({ propertyId, notes }) =>
      toolResult(async () => {
        await service.setNotes(propertyId, notes);
        return property(propertyId);
      }),
  );
  server.registerTool(
    "add_viewing",
    {
      description: "Records a viewing of a property, as the connected person.",
      inputSchema: {
        propertyId: Id("property"),
        at: CreateViewing.shape.at.describe("When it was, ISO 8601 with an offset"),
        rating: CreateViewing.shape.rating.describe("1 to 5, or null for no rating"),
        notes: CreateViewing.shape.notes,
      },
      annotations: change,
    },
    ({ propertyId, ...viewing }) =>
      toolResult(async () => {
        await service.addViewing(propertyId, viewing, login);
        return property(propertyId);
      }),
  );
  server.registerTool(
    "delete_viewing",
    {
      description: "Deletes a viewing and its photos. Cannot be undone.",
      inputSchema: { viewingId: Id("viewing") },
      annotations: remove,
    },
    ({ viewingId }) =>
      toolResult(async () => {
        await service.deleteViewing(viewingId);
        return { deleted: viewingId };
      }),
  );
  server.registerTool(
    "view_photo",
    {
      description: "Shows one of a listing's photos or floorplans.",
      inputSchema: { photoId: Id("photo") },
      annotations: read,
    },
    ({ photoId }) => toolResult(() => service.photo(photoId), imageResult),
  );
  server.registerTool(
    "view_viewing_photo",
    {
      description: "Shows a photo someone took at a viewing.",
      inputSchema: { photoId: Id("viewing photo") },
      annotations: read,
    },
    ({ photoId }) => toolResult(() => service.viewingPhoto(photoId), imageResult),
  );
  server.registerTool(
    "delete_viewing_photo",
    {
      description: "Deletes a photo taken at a viewing. Cannot be undone.",
      inputSchema: { photoId: Id("viewing photo") },
      annotations: remove,
    },
    ({ photoId }) =>
      toolResult(async () => {
        await service.deleteViewingPhoto(photoId);
        return { deleted: photoId };
      }),
  );

  server.registerTool(
    "list_searches",
    {
      description: "Lists the saved portal searches being polled, with when each last succeeded and its last error.",
      annotations: read,
    },
    () => toolResult(() => service.searches()),
  );
  server.registerTool(
    "add_search",
    {
      description:
        "Saves a portal search results URL (e.g. a Rightmove search) to poll for new listings, and polls its first " +
        "pages now.",
      inputSchema: CreateSearch.shape,
      annotations: { ...change, openWorldHint: true },
    },
    (input) => toolResult(() => service.createSearch(input)),
  );
  server.registerTool(
    "set_search_enabled",
    {
      description: "Pauses or resumes polling a search. Resuming forgives its failures.",
      inputSchema: { searchId: Id("search"), enabled: z.boolean() },
      annotations: edit,
    },
    ({ searchId, enabled }) => toolResult(() => service.setSearchEnabled(searchId, enabled)),
  );
  server.registerTool(
    "delete_search",
    {
      description: "Stops polling a search and forgets it; properties it found stay.",
      inputSchema: { searchId: Id("search") },
      annotations: remove,
    },
    ({ searchId }) =>
      toolResult(async () => {
        await service.deleteSearch(searchId);
        return { deleted: searchId };
      }),
  );
  server.registerTool(
    "add_listing",
    {
      description:
        "Adds one listing by its portal URL. It is fetched and read in the background, so it appears in " +
        "list_properties a little later.",
      inputSchema: { url: z.url().describe("A listing page, e.g. https://www.rightmove.co.uk/properties/123") },
      annotations: { ...change, idempotentHint: true, openWorldHint: true },
    },
    ({ url }) => toolResult(() => service.addListing(url)),
  );

  server.registerTool(
    "get_requirements",
    {
      description: "Reads the requirements document: the limits, and the questions Jev answers about each listing.",
      annotations: read,
    },
    () => toolResult(() => service.requirements()),
  );
  server.registerTool(
    "try_requirements",
    {
      description:
        "Judges one property by a draft of the requirements without saving anything: the limit it breaks, each " +
        "question's answer and the resulting ranking. Only reworded or new questions are sent to Jev.",
      inputSchema: { requirements: Requirements, propertyId: Id("property") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (input, { signal }) => toolResult(() => service.trial(input, signal)),
  );
  server.registerTool(
    "save_requirements",
    {
      description:
        "Replaces the whole requirements document, then rejects untriaged properties the limits now rule out and " +
        "re-reads the rest. Read it with get_requirements first and send it back changed.",
      inputSchema: { requirements: Requirements },
      annotations: { ...edit, destructiveHint: true },
    },
    ({ requirements }) => toolResult(() => service.saveRequirements(requirements)),
  );

  server.registerTool(
    "list_destinations",
    {
      description: "Lists the places commutes are timed to, with the weekday arrival time for each.",
      annotations: read,
    },
    () => toolResult(() => service.destinations()),
  );
  server.registerTool(
    "add_destination",
    {
      description: "Adds a place to time every property's commute to, by public transport on a weekday.",
      inputSchema: {
        ...CreateDestination.shape,
        arriveBy: CreateDestination.shape.arriveBy.describe("London time to arrive by, HH:MM"),
      },
      annotations: { ...change, openWorldHint: true },
    },
    (input) => toolResult(() => service.createDestination(input)),
  );
  server.registerTool(
    "delete_destination",
    {
      description: "Stops timing commutes to a place and drops the times already found.",
      inputSchema: { destinationId: Id("destination") },
      annotations: remove,
    },
    ({ destinationId }) =>
      toolResult(async () => {
        await service.deleteDestination(destinationId);
        return { deleted: destinationId };
      }),
  );
};

/** The hunt is shared, so every tailnet login sees the same properties; viewings record who added them. */
export const createFlatsMcp = (service: FlatsService): AppMcp => ({
  instructions: INSTRUCTIONS,
  listing: "shared",
  registerTools: (server, viewer) => registerTools(service, server, viewer.login),
});
