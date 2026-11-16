import { type AppMcp, type McpServer, toolResult } from "@apps/core";
import { z } from "zod";
import { CreateAccount, KINDS, type NetWorthSeries, NewLineItem, Pence, TagName } from "../contract";
import type { MoneyService } from "./service";

const INSTRUCTIONS = `The connected person's own money: their accounts, net worth over time, transactions and investments.

- Amounts are whole pence. Money leaving an account, and anything owed, is negative.
- An account's balance is kept up to date by a bank link, by Hargreaves Lansdown CSV exports (a portfolio, revalued
  daily), or by hand. Only a manual account's balance can be set.
- Every transaction has one or more line items that add up to its amount, and tags live on line items. Splitting a
  transaction replaces all its items; send one item to put it back together or just to tag the whole of it.
- Spending counts line items in cash accounts by calendar month; an item with several tags counts under each.
- Ids are UUIDs; find them with the list tools. A bank can only be linked from the web app, as it needs a login.`;

const AccountId = z.uuid().describe("The account's id");
const LocalDate = z.iso.date();

const sum = (amounts: readonly number[]) => amounts.reduce((total, amount) => total + amount, 0);

/** One point a month and the latest, which is as much history as a conversation needs. */
const monthly = (series: NetWorthSeries) =>
  series
    .filter(
      (point, index) => index === series.length - 1 || point.date.slice(0, 7) !== series[index + 1]?.date.slice(0, 7),
    )
    .map(({ date, byKind }) => ({ date, total: sum(Object.values(byKind)), byKind }));

const registerTools = (service: MoneyService, server: McpServer, owner: string) => {
  const read = { readOnlyHint: true, openWorldHint: false } as const;
  const change = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
  const edit = { ...change, idempotentHint: true } as const;
  const destroy = { ...change, destructiveHint: true } as const;

  server.registerTool(
    "get_net_worth",
    {
      description: "Reads every account with its latest balance, the total, and net worth at each month end by kind.",
      inputSchema: { months: z.number().int().min(1).max(240).default(12).describe("How far back the history goes") },
      annotations: read,
    },
    ({ months }) =>
      toolResult(async () => {
        const accounts = await service.accounts(owner);
        return {
          total: sum(accounts.map((account) => account.balance?.amount ?? 0)),
          accounts,
          history: monthly(await service.netWorth(owner, months)),
        };
      }),
  );
  server.registerTool(
    "create_money_account",
    {
      description: "Adds an account whose balance is entered by hand, such as a property, a pension or a loan.",
      inputSchema: { name: CreateAccount.shape.name, kind: CreateAccount.shape.kind },
      annotations: change,
    },
    (input) => toolResult(() => service.createAccount(owner, input)),
  );
  server.registerTool(
    "update_money_account",
    {
      description: "Renames an account or changes what kind of thing it holds. Only the fields given change.",
      inputSchema: { accountId: AccountId, name: CreateAccount.shape.name.optional(), kind: z.enum(KINDS).optional() },
      annotations: edit,
    },
    ({ accountId, name, kind }) =>
      toolResult(() =>
        service.updateAccount(owner, accountId, {
          ...(name !== undefined && { name }),
          ...(kind !== undefined && { kind }),
        }),
      ),
  );
  server.registerTool(
    "delete_money_account",
    {
      description: "Deletes an account with its balances, transactions and holdings. Cannot be undone.",
      inputSchema: { accountId: AccountId },
      annotations: destroy,
    },
    ({ accountId }) => toolResult(() => service.deleteAccount(owner, accountId)),
  );
  server.registerTool(
    "list_account_balances",
    {
      description: "Reads an account's recorded balances, newest first.",
      inputSchema: { accountId: AccountId },
      annotations: read,
    },
    ({ accountId }) => toolResult(() => service.balances(owner, accountId)),
  );
  server.registerTool(
    "set_account_balance",
    {
      description: "Records what a manual account was worth at the end of a day, replacing any balance already there.",
      inputSchema: { accountId: AccountId, date: LocalDate.describe("YYYY-MM-DD, not in the future"), amount: Pence },
      annotations: edit,
    },
    ({ accountId, date, amount }) => toolResult(() => service.setBalance(owner, accountId, date, amount)),
  );
  server.registerTool(
    "delete_account_balance",
    {
      description: "Removes a manual account's recorded balance for a day.",
      inputSchema: { accountId: AccountId, date: LocalDate },
      annotations: destroy,
    },
    ({ accountId, date }) => toolResult(() => service.deleteBalance(owner, accountId, date)),
  );
  server.registerTool(
    "list_transactions",
    {
      description: "Reads transactions newest first, 50 at a time, each with its line items and their tags.",
      inputSchema: {
        accountId: AccountId.optional(),
        tag: TagName.optional().describe("Only transactions with a line item tagged so"),
        untagged: z.boolean().default(false).describe("Only transactions with a line item that has no tag"),
        search: z.string().trim().min(1).max(100).optional().describe("Matched against descriptions and counterparty"),
        before: z.string().optional().describe("The `next` of the page before, to read on"),
      },
      annotations: read,
    },
    ({ accountId, tag, untagged, search, before }) =>
      toolResult(() => {
        const [bookedOn, id] = before?.split("_") ?? [];
        return service.transactions(
          owner,
          {
            accountId: accountId ?? null,
            tags: tag !== undefined ? { kind: "tagged", name: tag } : untagged ? { kind: "untagged" } : { kind: "any" },
            search: search ?? null,
          },
          bookedOn === undefined || id === undefined ? null : { bookedOn, id },
        );
      }),
  );
  server.registerTool(
    "split_transaction",
    {
      description:
        "Replaces a transaction's line items, which must add up to its amount. Tags not seen before are created.",
      inputSchema: {
        transactionId: z.uuid().describe("The transaction's id"),
        items: z.array(NewLineItem).min(1).max(50),
      },
      annotations: edit,
    },
    ({ transactionId, items }) => toolResult(() => service.splitTransaction(owner, transactionId, { items })),
  );
  server.registerTool(
    "list_tags",
    { description: "Reads every tag with how many line items carry it.", annotations: read },
    () => toolResult(() => service.tags(owner)),
  );
  server.registerTool(
    "rename_tag",
    {
      description: "Renames a tag on every line item that carries it. Refused if the new name is already a tag.",
      inputSchema: { name: TagName, to: TagName },
      annotations: edit,
    },
    ({ name, to }) => toolResult(() => service.renameTag(owner, name, to)),
  );
  server.registerTool(
    "delete_tag",
    {
      description: "Deletes a tag, taking it off every line item. Cannot be undone.",
      inputSchema: { name: TagName },
      annotations: destroy,
    },
    ({ name }) => toolResult(() => service.deleteTag(owner, name)),
  );
  server.registerTool(
    "get_spending",
    {
      description: "Reads income, outgoings and the net per tag for each of the last calendar months, newest first.",
      inputSchema: { months: z.number().int().min(1).max(60).default(6) },
      annotations: read,
    },
    ({ months }) => toolResult(() => service.spending(owner, months)),
  );
  server.registerTool(
    "list_holdings",
    {
      description: "Reads every investment held, with its units, price in pence, value, cost and FT Markets symbol.",
      annotations: read,
    },
    () => toolResult(() => service.holdings(owner)),
  );
  server.registerTool(
    "set_security_symbol",
    {
      description:
        "Sets the FT Markets symbol a held security is repriced from each day (e.g. GB00B59G4Q73:GBP, OCDO:LSE), or null to stop repricing it. Refused unless FT quotes that symbol in sterling.",
      inputSchema: {
        code: z.string().min(1).describe("The security's code from list_holdings"),
        symbol: z.string().trim().min(1).max(40).nullable(),
      },
      annotations: { ...edit, openWorldHint: true },
    },
    ({ code, symbol }) => toolResult(() => service.setSymbol(owner, code, symbol)),
  );
  server.registerTool(
    "import_hl_export",
    {
      description:
        "Takes the text of a Hargreaves Lansdown CSV export. A holdings export replaces what the account held; a transaction history adds the rows not already there and needs the account's id.",
      inputSchema: {
        csv: z.string().min(1).max(2_000_000),
        accountId: AccountId.nullable()
          .default(null)
          .describe("Omit for a holdings export to go by the account it names"),
      },
      annotations: edit,
    },
    ({ csv, accountId }) => toolResult(() => service.importHl(owner, csv, accountId)),
  );
  server.registerTool(
    "list_bank_connections",
    {
      description: "Reads each linked bank with when its consent runs out, when it last synced and any sync error.",
      annotations: read,
    },
    () => toolResult(() => service.banking(owner)),
  );
  server.registerTool(
    "sync_bank_connection",
    {
      description: "Reads a linked bank's balances and transactions now rather than at the next scheduled sync.",
      inputSchema: { connectionId: z.uuid().describe("The connection's id from list_bank_connections") },
      annotations: { ...edit, openWorldHint: true },
    },
    ({ connectionId }) =>
      toolResult(async () => {
        await service.syncConnection(owner, connectionId);
        return { queued: true };
      }),
  );
  server.registerTool(
    "disconnect_bank",
    {
      description: "Withdraws a bank's consent. Its accounts and their history stay, from then on kept by hand.",
      inputSchema: { connectionId: z.uuid().describe("The connection's id from list_bank_connections") },
      annotations: { ...destroy, openWorldHint: true },
    },
    ({ connectionId }) => toolResult(() => service.disconnect(owner, connectionId)),
  );
};

/** Acts on the connected person's own money only. */
export const createMoneyMcp = (service: MoneyService): AppMcp => ({
  instructions: INSTRUCTIONS,
  listing: "shared",
  registerTools: (server, viewer) => registerTools(service, server, viewer.login),
});
