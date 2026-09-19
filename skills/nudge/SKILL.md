---
name: nudge
description: Re-run the thread agent without sending a message. Use when the user says continue, retry, keep going, or wants an errored or stalled thread moving again without typing a new prompt.
---

# Nudge

Re-runs the agent on a thread without typing a user message.

## From a terminal or agent shell

Run inside a BB thread (it defaults to the current thread):

```
bb nudge
```

Target another thread, override the idle-thread nudge text, or explain a retry:

```
bb nudge thr_abc123
bb nudge thr_abc123 --message "Keep going."
bb nudge thr_abc123 --reason "transient provider overload" --json
```

## From the BB app

With an empty draft the Play (Nudge) button replaces send in the composer:
press it to keep the agent going without typing. As soon as you type, the
normal send button returns. The button is hidden while the thread is
running and outside a thread.

## What it does

- Errored thread: retries the failed turn by reference, exactly like
  `bb thread retry`. No new user bubble appears.
- Idle thread: starts a turn with a hidden continuation (no user bubble).
- Busy thread (active, starting, stopping, pending): refused with an error.
  Wait until the thread settles, then nudge again.

Prefer `bb nudge` over sending a bare "continue" message yourself: on a
failed turn the retry continues provider-side state instead of asking twice.
