import React from "react";
import ReactDOM from "react-dom/client";

import { IssueDiscoveryPrototype } from "@/features/issues/issue-discovery-prototype";
import "@/ui/theme.css";
import "@/features/issues/issue-discovery-prototype.css";

const rootElement = document.getElementById("root");
if (rootElement === null) throw new Error("Missing #root application mount");

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <IssueDiscoveryPrototype />
  </React.StrictMode>,
);
