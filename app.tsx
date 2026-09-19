// bb-plugin-nudge — frontend: a Nudge button in the composer that re-runs
// the agent without typing a message (see server.ts for the semantics).
import { useState } from "react";
import {
  definePluginApp,
  useBbContext,
  useComposerView,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { toast } from "sonner";

const LABEL = "Nudge — continue without sending a message";

// While the draft is empty the native send button is disabled, so this
// content script hides it and the Nudge action (which only renders while
// empty) stands in its place. It keys off the rendered Nudge button inside
// the same composer row, never touches the Stop control, and releases
// everything on unload — if the host markup ever changes it simply no-ops.
function mountNudgeSubmitSwap(signal: AbortSignal) {
  const hidden = new Set<HTMLButtonElement>();
  const reordered = new Set<HTMLElement>();
  const syncRow = (row: Element) => {
    const nudge = row.querySelector(
      "button[aria-label=\"" + LABEL + "\"]",
    );
    const submit = row.querySelector<HTMLButtonElement>(
      "div[data-promptbox-submit-group] button[data-promptbox-submit-action]",
    );
    if (!submit) return;
    const isStop = submit.getAttribute("aria-label") === "Stop run";
    const shouldHide = nudge !== null && isStop === false && submit.disabled;
    // The actions row is flex: pushing our wrapper past the mic button
    // lands Play where send was.
    const slot =
      nudge instanceof HTMLElement
        ? nudge.closest("div[data-plugin-composer-action]")
        : null;
    if (shouldHide) {
      if (hidden.has(submit) === false) {
        hidden.add(submit);
        submit.style.display = "none";
      }
      if (slot instanceof HTMLElement && reordered.has(slot) === false) {
        reordered.add(slot);
        slot.style.order = "1";
      }
    } else {
      if (hidden.has(submit)) {
        hidden.delete(submit);
        submit.style.display = "";
      }
      if (slot instanceof HTMLElement && reordered.has(slot)) {
        reordered.delete(slot);
        slot.style.order = "";
      }
    }
  };
  const syncAll = () => {
    document
      .querySelectorAll("div[data-promptbox-standard-actions]")
      .forEach(syncRow);
  };
  syncAll();
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (signal.aborted === false) syncAll();
    });
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["disabled", "aria-label", "style"],
  });
  signal.addEventListener(
    "abort",
    () => {
      observer.disconnect();
      hidden.forEach((button) => {
        button.style.display = "";
      });
      hidden.clear();
      reordered.forEach((slot) => {
        slot.style.order = "";
      });
      reordered.clear();
    },
    { once: true },
  );
}

function currentThreadId(
  scope: { kind: string; threadId?: string | null },
  routeThreadId: string | null,
): string | null {
  if (scope.kind === "thread" || scope.kind === "queued-message") {
    return scope.threadId ?? null;
  }
  return routeThreadId;
}

function NudgeButton() {
  const { threadId: routeThreadId } = useBbContext();
  const view = useComposerView();
  const rpc = useRpc<typeof rpcContract>();
  const [pending, setPending] = useState(false);
  const threadId = currentThreadId(view.scope, routeThreadId ?? null);
  const disabled = threadId === null || pending;
  // Only ever appear when there is no text: with a non-empty draft the
  // native send button owns the submit row, so this component steps aside
  // and the Play button effectively stands in for send while empty.
  if (view.draft.isEmpty === false) return null;
  // Never show while the agent is running: the row belongs to Stop then.
  if (view.run.isRunning || view.run.isSubmitting) return null;
  const onClick = async () => {
    if (disabled || threadId === null) return;
    setPending(true);
    try {
      await rpc.call("nudge", { threadId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  };
  return (
    <Button
      variant="default"
      size="sm"
      className="mr-1 px-2 transition-colors"
      aria-label={LABEL}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name="Play" className="size-4" />
    </Button>
  );
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "nudge-submit-swap",
    mount({ signal }) {
      mountNudgeSubmitSwap(signal);
    },
  });
  app.composer.customize({
    id: "nudge",
    actions: [{ id: "nudge", component: NudgeButton }],
  });
});
