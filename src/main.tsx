import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { App } from "./app";
import "./shadcn.css";
import "./playground.css";

const root = document.getElementById("root")!;
const app = (
  <StrictMode>
    <App initialPath={window.location.pathname} />
  </StrictMode>
);

if (root.hasChildNodes()) {
  hydrateRoot(root, app);
} else {
  createRoot(root).render(app);
}
