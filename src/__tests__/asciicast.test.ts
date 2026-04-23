import { describe, expect, it } from "vitest";
import { asciicastEvent, asciicastHeader } from "../asciicast.js";

describe("asciicast", () => {
  it("writes a valid v2 header", () => {
    const line = asciicastHeader({
      cols: 80,
      rows: 24,
      timestamp: 1760000000,
      command: "node fake.js",
      env: { SHELL: "/bin/zsh", TERM: "xterm-256color" },
    });

    expect(JSON.parse(line)).toEqual({
      version: 2,
      width: 80,
      height: 24,
      timestamp: 1760000000,
      command: "node fake.js",
      env: { SHELL: "/bin/zsh", TERM: "xterm-256color" },
    });
  });

  it("writes rounded event tuples", () => {
    expect(JSON.parse(asciicastEvent(1.23456789, "o", "hello"))).toEqual([
      1.234568,
      "o",
      "hello",
    ]);
  });
});
