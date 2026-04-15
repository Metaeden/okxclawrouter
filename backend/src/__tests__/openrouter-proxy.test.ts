import { describe, expect, it } from "vitest";
import {
  sanitizeOpenRouterJsonText,
  sanitizeSseEvent,
} from "../openrouter-proxy.js";

describe("openrouter response sanitizers", () => {
  it("removes reasoning_details from JSON responses", () => {
    const sanitized = sanitizeOpenRouterJsonText(
      JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: "OK",
              reasoning_details: [{ type: "reasoning.encrypted", data: "secret" }],
            },
          },
        ],
      }),
    );

    expect(JSON.parse(sanitized)).toEqual({
      choices: [
        {
          message: {
            role: "assistant",
            content: "OK",
          },
        },
      ],
    });
  });

  it("drops processing comment frames from SSE", () => {
    expect(sanitizeSseEvent(": OPENROUTER PROCESSING")).toBeNull();
  });

  it("removes reasoning_details from SSE data frames", () => {
    const event = sanitizeSseEvent(
      'data: {"choices":[{"delta":{"content":"OK","reasoning_details":[{"data":"secret"}]}}]}',
    );

    expect(event).toBe('data: {"choices":[{"delta":{"content":"OK"}}]}');
  });

  it("keeps done frames unchanged", () => {
    expect(sanitizeSseEvent("data: [DONE]")).toBe("data: [DONE]");
  });
});
