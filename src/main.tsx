import React from "react";
import ReactDOM from "react-dom/client";

import { TimelineContributionPrototype } from "@/prototype/timeline-contribution";
import "@/ui/theme.css";
import "@/prototype/timeline-contribution.css";

const rootElement = document.getElementById("root");
if (rootElement === null) throw new Error("Missing #root application mount");

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <TimelineContributionPrototype />
  </React.StrictMode>,
);
