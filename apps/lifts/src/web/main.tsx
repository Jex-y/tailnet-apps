import { installShell } from "@apps/core/web";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Router } from "wouter";
import { Layout } from "./components/Layout";
import { Pages } from "./components/Pages";
import { StoreContext } from "./hooks/useStore";
import { openStore, type Store } from "./lib/store";

// Lifts keeps its own look, Paper, pinned on the page, whatever theme the other apps are in.
void installShell({ theme: "own" });

const root = document.getElementById("root");
if (!root) {
  throw new Error("#root element missing from index.html");
}

const opening = openStore();

/** Draws the frame at once and the log as soon as the device has it back, so there is never a blank screen. */
const App = () => {
  const [store, setStore] = useState<Store | null>(null);

  useEffect(() => {
    void opening.then(setStore);
  }, []);

  return (
    <Router base="/lifts">
      {store === null ? (
        <Layout ready={false}>{null}</Layout>
      ) : (
        <StoreContext value={store}>
          <Layout ready>
            <Pages />
          </Layout>
        </StoreContext>
      )}
    </Router>
  );
};

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
