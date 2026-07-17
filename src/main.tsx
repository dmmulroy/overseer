import React from "react";
import ReactDOM from "react-dom/client";
import "@cloudflare/kumo/styles/standalone";
import "./overseer-utility-theme.css";
import "./prototype.css";
import { PrototypeApp } from "./prototype-app";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PrototypeApp />
  </React.StrictMode>,
);
