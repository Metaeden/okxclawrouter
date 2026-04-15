import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  filterSupportedModels,
  getAdvertisedModels,
  getSupportedModelIds,
  invalidateSupportedModelCache,
} from "../backend-models.js";

describe("backend model discovery", () => {
  beforeEach(() => {
    invalidateSupportedModelCache();
    vi.restoreAllMocks();
  });

  it("should advertise only models reported by the backend", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              { id: "openrouter/free" },
              { id: "paid/claude-sonnet-4-6" },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const models = await getAdvertisedModels();
    expect(models.map((model) => model.id)).toEqual([
      "openrouter/free",
      "paid/claude-sonnet-4-6",
    ]);
  });

  it("should filter unsupported and duplicate models from a fallback chain", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              { id: "openrouter/free" },
              { id: "paid/gpt-5.4" },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(
      filterSupportedModels([
        "openrouter/free",
        "paid/gpt-5.4",
        "paid/gpt-5.4",
      ]),
    ).resolves.toEqual([
      "openrouter/free",
      "paid/gpt-5.4",
    ]);
  });

  it("should fall back to local model definitions when backend discovery fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const supported = await getSupportedModelIds();
    expect(supported.has("openrouter/free")).toBe(true);
    expect(supported.has("paid/gemini-3.1-pro")).toBe(true);
  });
});
