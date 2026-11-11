import { createServer, type Server } from "node:http";

// A stand-in for Anthropic's Messages API on port 8799, where functions/.env.local points the emulator's SDK. The real
// API is never called from the tests or the emulator.

export const PORT = 8799;

/** What the stand-in answers next: the reply text, its usage, and why it stopped. */
export interface FakeAnswer {
  text: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: "end_turn" | "max_tokens" | "refusal";
  /** An HTTP error instead of a message. */
  status?: number;
}

/** A request the stand-in received. */
export interface Received {
  readonly path: string;
  readonly apiKey: string | undefined;
  readonly body: Record<string, unknown>;
}

export interface FakeClaude {
  readonly received: Received[];
  answer: FakeAnswer;
  reset(): void;
  close(): Promise<void>;
}

const NORMAL: FakeAnswer = { text: "A reworded post.", inputTokens: 1000, outputTokens: 200, stopReason: "end_turn" };

export async function startFakeClaude(): Promise<FakeClaude> {
  const fake: FakeClaude = {
    received: [],
    answer: { ...NORMAL },
    reset() {
      fake.received.length = 0;
      fake.answer = { ...NORMAL };
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };

  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => (raw += chunk.toString("utf8")));
    req.on("end", () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      // SDK 1.x sends the key as a bearer token; older ones as x-api-key.
      const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
      const apiKey = bearer ?? req.headers["x-api-key"];
      fake.received.push({ path: req.url ?? "", apiKey: typeof apiKey === "string" ? apiKey : undefined, body });
      const { answer } = fake;
      res.setHeader("Content-Type", "application/json");
      if (answer.status) {
        res.statusCode = answer.status;
        res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "The stand-in failed on purpose." } }));
        return;
      }
      res.end(
        JSON.stringify({
          id: `msg_fake_${fake.received.length}`,
          type: "message",
          role: "assistant",
          model: body["model"],
          content: answer.stopReason === "refusal" ? [] : [{ type: "text", text: answer.text }],
          stop_reason: answer.stopReason,
          stop_sequence: null,
          stop_details: answer.stopReason === "refusal" ? { type: "refusal", category: null, explanation: null } : null,
          usage: { input_tokens: answer.inputTokens, output_tokens: answer.outputTokens },
        }),
      );
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, "127.0.0.1", () => resolve());
  });
  return fake;
}
