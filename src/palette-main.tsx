import React from "react";
import ReactDOM from "react-dom/client";
import { PaletteApp } from "./screens/PaletteApp";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PaletteApp />
  </React.StrictMode>
);
