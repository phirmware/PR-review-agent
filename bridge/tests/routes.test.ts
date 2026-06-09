import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import type express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalHome = process.env.REVIEW_GUIDE_HOME;

interface AppResponse {
  statusCode: number;
  headers: Map<string, string>;
  body: string;
}

type ExpressWithHandle = express.Express & {
  handle(request: express.Request, response: express.Response, callback: (error: unknown) => void): void;
};

async function invokeApp(
  app: express.Express,
  pathname: string,
  options: { method?: "GET" | "POST"; body?: unknown } = {}
): Promise<AppResponse> {
  const body = options.body === undefined ? "" : JSON.stringify(options.body);
  let bodyPushed = false;
  const request = new Readable({
    read() {
      if (!bodyPushed && body) {
        bodyPushed = true;
        this.push(body);
      }
      this.push(null);
    }
  }) as unknown as express.Request;
  request.method = options.method ?? "GET";
  request.url = pathname;
  request.headers = {
    origin: "https://github.com",
    ...(body ? { "content-type": "application/json", "content-length": Buffer.byteLength(body).toString() } : {})
  };

  const chunks: Buffer[] = [];
  const headers = new Map<string, string>();

  return new Promise((resolve, reject) => {
    const response = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      }
    }) as unknown as express.Response;

    response.statusCode = 200;
    response.setHeader = (name: string, value: string | number | readonly string[]) => {
      headers.set(name.toLowerCase(), Array.isArray(value) ? value.join(",") : String(value));
      return response;
    };
    response.getHeader = (name: string) => headers.get(name.toLowerCase());
    response.removeHeader = (name: string) => {
      headers.delete(name.toLowerCase());
    };
    response.end = ((chunk?: unknown) => {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }

      resolve({
        statusCode: response.statusCode,
        headers,
        body: Buffer.concat(chunks).toString("utf8")
      });
      return response;
    }) as express.Response["end"];

    (app as ExpressWithHandle).handle(request, response, reject);
  });
}

describe("bridge routes", () => {
  beforeEach(async () => {
    process.env.REVIEW_GUIDE_HOME = await fs.mkdtemp(path.join(os.tmpdir(), "review-guide-routes-"));
    vi.resetModules();
  });

  afterEach(() => {
    process.env.REVIEW_GUIDE_HOME = originalHome;
  });

  it("returns health response shape with localhost extension CORS headers", async () => {
    const { createApp } = await import("../src/routes");
    const app = createApp();
    const response = await invokeApp(app, "/health");
    const payload = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://github.com");
    expect(payload).toEqual({
      ok: true,
      service: "review-guide-bridge",
      version: "0.1.0",
      provider: "mock"
    });
  });

  it("persists selected provider through the provider endpoint", async () => {
    const { createApp } = await import("../src/routes");
    const app = createApp();

    const providerResponse = await invokeApp(app, "/provider", {
      method: "POST",
      body: { provider: "copilot-cli" }
    });
    const providerPayload = JSON.parse(providerResponse.body);

    expect(providerResponse.statusCode).toBe(200);
    expect(providerPayload).toEqual({
      provider: "copilot-cli",
      providers: ["mock", "claude-code", "copilot-cli"]
    });

    const healthResponse = await invokeApp(app, "/health");
    const healthPayload = JSON.parse(healthResponse.body);
    expect(healthPayload.provider).toBe("copilot-cli");
  });
});
