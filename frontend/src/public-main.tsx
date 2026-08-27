import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { PublicApp } from "./PublicApp";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PublicApp />
  </StrictMode>,
);
