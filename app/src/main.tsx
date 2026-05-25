import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import AuthPopup from "./AuthPopup";
import "./index.css";

const isAuthPopup = window.location.pathname.replace(/\/$/, "") === "/auth";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{isAuthPopup ? <AuthPopup /> : <App />}</React.StrictMode>,
);
