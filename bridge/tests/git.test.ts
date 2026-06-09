import { describe, expect, it } from "vitest";
import { parseNumstatOutput } from "../src/git";

describe("parseNumstatOutput", () => {
  it("parses git numstat output", () => {
    expect(parseNumstatOutput("10\t2\tsrc/api.ts\n-\t-\tassets/logo.png\n")).toEqual([
      {
        additions: 10,
        deletions: 2,
        file: "src/api.ts"
      },
      {
        additions: 0,
        deletions: 0,
        file: "assets/logo.png"
      }
    ]);
  });
});
