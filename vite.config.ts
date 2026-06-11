import { defineConfig } from "vite";

export default defineConfig({
  base: "/SquadRush/",
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
