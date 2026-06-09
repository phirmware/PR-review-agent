import { describe, expect, it } from "vitest";
import { normalizeSelectedFileText, resolveSelectedFilePath } from "../src/filePathResolver";

describe("file path resolver", () => {
  it("accepts root-level filenames when they look like files", () => {
    expect(resolveSelectedFilePath("openapi.yaml", [])).toBe("openapi.yaml");
  });

  it("strips GitHub formatting characters around selected paths", () => {
    expect(resolveSelectedFilePath("\u200eopenapi.yaml\u200e", ["openapi.yaml"])).toBe("openapi.yaml");
  });

  it("normalizes diff prefixes and quoted selections", () => {
    expect(resolveSelectedFilePath('"b/src/index.ts"', ["src/index.ts"])).toBe("src/index.ts");
  });

  it("does not accept arbitrary single words as file paths", () => {
    expect(resolveSelectedFilePath("openapi", [])).toBeNull();
  });

  it("normalizes invisible characters", () => {
    expect(normalizeSelectedFileText("\u202a b/openapi.yaml \u202c")).toBe("openapi.yaml");
  });
});
