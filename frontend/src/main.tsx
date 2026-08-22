import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { schedulePwaRegistration } from "./pwa/register";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("无法找到应用挂载节点 #root。请检查 index.html。")
}

schedulePwaRegistration();

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
