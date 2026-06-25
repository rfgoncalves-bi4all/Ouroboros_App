import React from "react";
import ReactDOM from "react-dom/client";
import { RayfinProvider } from "@rayfin/sdk";
import { App } from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/*
      RayfinProvider injects:
        - useAuth() → { accessToken, userId, … }
        - Rayfin GraphQL endpoint via VITE_RAYFIN_GRAPHQL_URL
      No additional configuration is needed — auth flows from the Fabric
      session automatically when deployed with `rayfin up`.
    */}
    <RayfinProvider>
      <App />
    </RayfinProvider>
  </React.StrictMode>,
);
