import { defineConfig } from "vitest/config";
export default defineConfig({test:{environment:"node",include:["scripts/xdesign-fidelity.case.ts"],testTimeout:180000,hookTimeout:180000,maxWorkers:1,server:{deps:{inline:[/\/@open-pencil\/core\//]}}}});
