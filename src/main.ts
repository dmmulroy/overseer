import { embedPrototype } from "./prototype-app";
import "./prototype.css";

const container = document.querySelector<HTMLElement>("#app");
if (container === null) {
  throw new Error("Missing #app container");
}

embedPrototype(container);
