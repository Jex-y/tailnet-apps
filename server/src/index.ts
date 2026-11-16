import {
  createConnectorStore,
  createJobQueue,
  createNotifierFactory,
  createSql,
  parseServerConfig,
  startConnectorServer,
  startServer,
} from "@apps/core";
import { createApps } from "./apps";

const config = parseServerConfig(process.env);
const sql = createSql(config.database);
const connector = config.connector.kind === "on" ? { ...config.connector, store: createConnectorStore(sql) } : null;
const apps = createApps({
  env: process.env,
  publicUrl: config.publicUrl,
  sql,
  blob: config.blob,
  notifier: createNotifierFactory(config.notify, sql),
  jobs: createJobQueue(sql),
  identity: config.identity,
});
const server = startServer({
  port: config.port,
  development: config.development,
  shell: { identity: config.identity, sql, webPush: config.notify },
  apps,
  authorize: connector && { publicUrl: config.publicUrl, store: connector.store },
});
console.log(`Listening on ${server.url}`);

const connectorServer =
  connector &&
  startConnectorServer({
    port: connector.port,
    url: connector.url,
    publicUrl: config.publicUrl,
    apps,
    store: connector.store,
  });
if (connectorServer !== null) {
  console.log(`Serving the connector on ${connectorServer.url}`);
}

const shutdown = async () => {
  await Promise.all([server.stop(), connectorServer?.stop()]);
  await sql.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
