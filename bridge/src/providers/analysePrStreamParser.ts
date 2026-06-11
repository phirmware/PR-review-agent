import type { AnalysePrResponse, AnalysePrStreamEmit } from "@review-guide/shared";
import { AppError } from "../errors.js";
import { analysePrProviderStreamEventSchema, analysePrResponseSchema, extractJsonPayload } from "../schemas.js";

export class AnalysePrStreamParser {
  private buffer = "";
  private fullText = "";
  private finalResult: AnalysePrResponse | null = null;

  constructor(private readonly emit: AnalysePrStreamEmit) {}

  pushText(text: string): void {
    this.fullText += text;
    this.buffer += text;

    while (this.buffer.includes("\n")) {
      const newlineIndex = this.buffer.indexOf("\n");
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      this.parseLine(line);
    }
  }

  finish(task: string): AnalysePrResponse {
    if (this.buffer.trim()) {
      this.parseLine(this.buffer);
      this.buffer = "";
    }

    if (this.finalResult) {
      return this.finalResult;
    }

    try {
      return analysePrResponseSchema.parse(JSON.parse(extractJsonPayload(this.fullText)));
    } catch (error) {
      throw new AppError(`Provider did not emit a valid final streaming result for ${task}.`, 502, {
        cause: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private parseLine(rawLine: string): void {
    const line = rawLine.trim();
    if (!line) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new AppError("Provider emitted malformed streaming JSON.", 502, {
        line: line.slice(0, 240),
        cause: error instanceof Error ? error.message : String(error)
      });
    }

    const eventResult = analysePrProviderStreamEventSchema.safeParse(parsed);
    if (!eventResult.success) {
      throw new AppError("Provider emitted invalid streaming event shape.", 502, {
        line: line.slice(0, 240),
        issues: eventResult.error.issues
      });
    }

    const event = eventResult.data;
    if (event.type === "final") {
      this.finalResult = event.result;
      return;
    }

    this.emit(event);
  }
}
