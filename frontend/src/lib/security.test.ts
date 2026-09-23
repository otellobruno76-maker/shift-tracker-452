import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";

describe("sicurezza configurazione AI", () => {
  it("non contiene chiavi OpenAI nel sorgente frontend", () => {
    const files = globSync("src/**/*.{ts,tsx}").filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"));
    const source = files.map((file) => readFileSync(file, "utf8")).join("\n");
    expect(source).not.toMatch(/sk-[A-Za-z0-9_-]{20,}/);
    expect(source).not.toContain("OPENAI_API_KEY");
  });
});
