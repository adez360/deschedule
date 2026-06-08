import { defineConfig } from "orval";

export default defineConfig({
  scheduleSystem: {
    input: {
      target: "http://localhost:8000/openapi.json",
    },
    output: {
      mode: "tags-split",
      target: "src/api",
      schemas: "src/api/model",
      client: "react-query",
    },
  },
});
