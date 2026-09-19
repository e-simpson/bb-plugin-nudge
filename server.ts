// bb-plugin-nudge — re-run the agent without typing a message.

// An empty composer draft cannot be submitted, so this plugin adds an
// explicit Nudge affordance: on an errored thread it retries the failed turn
// by reference; on an idle thread it starts a turn with an agent-only
// continuation (same hidden-input rule BB uses for retries — no user bubble).
// Busy threads are refused — wait until the thread is idle or errored.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

// Hidden from the timeline; the provider still receives it so the turn starts.
export const NUDGE_TEXT = "Please continue.";

export const rpcContract = defineRpcContract({
  nudge: {
    input: z
      .object({
        threadId: z.string().trim().min(1),
        message: z.string().trim().min(1).max(2000).optional(),
        reason: z.string().trim().min(1).max(500).optional(),
      })
      .strict(),
    output: z
      .object({
        action: z.enum(["retried", "sent"]),
        delivery: z.string(),
        threadId: z.string(),
      })
      .strict(),
  },
});

type NudgeResult = {
  action: "retried" | "sent";
  delivery: string;
  threadId: string;
};

function deliveryOf(value: unknown): string {
  if (typeof value === "object" && value !== null) {
    const delivery = (value as { delivery?: unknown }).delivery;
    if (typeof delivery === "string") return delivery;
  }
  return "unknown";
}

async function nudgeThread(
  bb: BbPluginApi,
  args: { threadId: string; message?: string; reason?: string },
): Promise<NudgeResult> {
  const threadId = args.threadId.trim();
  if (threadId === "") throw new Error("threadId is required.");
  const thread = await bb.sdk.threads.get({ threadId });
  const status: unknown = (thread as { status?: unknown }).status;
  if (status === "error") {
    const reason = args.reason?.trim();
    const result = await bb.sdk.threads.retry(
      reason ? { threadId, reason } : { threadId },
    );
    return { action: "retried", delivery: deliveryOf(result), threadId };
  }
  if (status !== "idle") {
    const name = typeof status === "string" ? status : "busy";
    throw new Error(
      "Thread is " + name + " — nudge only runs on idle or errored threads.",
    );
  }
  const text = args.message?.trim() || NUDGE_TEXT;
  const visibility = args.message?.trim() ? undefined : ("agent-only" as const);
  const sent = await bb.sdk.threads.send({
    threadId,
    mode: "auto",
    input: [
      visibility
        ? { type: "text", text, mentions: [], visibility }
        : { type: "text", text, mentions: [] },
    ],
  });
  return { action: "sent", delivery: deliveryOf(sent), threadId };
}

const usage = [
  "Usage:",
  "  bb nudge [thread-id] [--message <text>] [--reason <text>] [--json]",
  "",
  "Re-runs the agent without typing a message: retries the failed turn on",
  "an errored thread, or starts an idle thread with a hidden continuation",
  "(no user bubble). Defaults to the current thread inside a BB thread.",
].join("\n");

function parseArgs(argv: string[]): {
  threadId?: string;
  message?: string;
  reason?: string;
  json: boolean;
  help: boolean;
} {
  let threadId: string | undefined;
  let message: string | undefined;
  let reason: string | undefined;
  let json = false;
  let help = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") json = true;
    else if (arg === "--help" || arg === "-h" || arg === "help") help = true;
    else if ((arg === "--message" || arg === "-m") && i + 1 < argv.length) {
      i += 1;
      message = argv[i];
    } else if ((arg === "--reason" || arg === "-r") && i + 1 < argv.length) {
      i += 1;
      reason = argv[i];
    } else if (threadId === undefined && arg.startsWith("--") === false) {
      threadId = arg;
    } else {
      help = true;
    }
  }
  return { threadId, message, reason, json, help };
}

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  bb.rpc.register(rpcContract, {
    nudge: ({ threadId, message, reason }) =>
      nudgeThread(bb, { threadId, message, reason }),
  });

  bb.cli.register({
    name: "nudge",
    summary: "Re-run the agent without sending a message (retry or continue)",
    commands: [
      {
        name: "nudge",
        summary: "Retry a failed turn, or continue an idle thread",
        usage: "bb nudge [thread-id] [--message <text>] [--reason <text>] [--json]",
      },
    ],
    async run(argv, ctx) {
      const parsed = parseArgs(argv);
      const reply = (value: unknown, text: string) => ({
        exitCode: 0,
        stdout: parsed.json ? JSON.stringify(value) : text,
      });
      if (parsed.help) return { exitCode: 0, stdout: usage };
      const threadId = parsed.threadId ?? ctx.threadId;
      if (!threadId) {
        return {
          exitCode: 1,
          stderr: "No thread selected. Pass a thread id or run inside a BB thread.\n" + usage,
        };
      }
      try {
        const result = await nudgeThread(bb, {
          threadId,
          message: parsed.message,
          reason: parsed.reason,
        });
        const text =
          result.action === "retried"
            ? "Retried failed turn on " + result.threadId + " (" + result.delivery + ")."
            : "Started " + result.threadId + " (" + result.delivery + ").";
        return reply(result, text);
      } catch (error) {
        return {
          exitCode: 1,
          stderr: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });

  bb.onDispose(() => {
    bb.log.info("disposed");
  });
}
