import React from "react";
import ReactDOM from "react-dom/client";
import "./prototype.css";
import "./utility-theme.css";
import { PrototypeApp } from "./prototype-app";

const rootElement = document.getElementById("root");
if (rootElement === null) throw new Error("Missing #root application mount");

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <PrototypeApp />
  </React.StrictMode>,
);
