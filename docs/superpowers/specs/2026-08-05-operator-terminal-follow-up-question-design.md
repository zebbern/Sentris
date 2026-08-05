# Operator Terminal Follow-up Question Design

## Goal

Allow the automatic terminal-run follow-up to ask one focused question when the answer materially
changes the useful next action, while keeping ordinary summaries interruption-free.

## Selected design

The existing durable `run_follow_up` turn remains the sole owner of terminal inspection. New
histories first run `get_run`, then invoke a question-capable review model step that exposes only
`request_user_input`:

- If the model has enough evidence, it returns the final bounded summary immediately.
- If one material choice is missing, it may call `request_user_input` once. The existing action
  ledger, sticky decision card, and Temporal Update path pause and resume the same turn.
- After an answer, a text-only final-summary step receives the durable question result through the
  existing provider continuation/action context. It cannot ask again or call another action.
- Cancellation or rejection completes with a concise deterministic message and does not retry the
  question.

The workflow accepts at most the first valid `request_user_input` call. Any other tool name is a
contract violation because the review activity publishes no other tools. Existing histories keep
the original text-only path behind a new Temporal patch marker.

## Constraints

- No new question schema, endpoint, frontend state, agent loop, or approval mechanism.
- The question is optional and limited to one per automatic follow-up.
- Ask only when the answer changes a concrete next action; never ask to reconfirm known evidence.
- Run evidence remains untrusted data and cannot expand the available tool set.
- Preserve the current folded pipeline UI and all unmatched/standalone follow-up fallbacks.

## Verification

- Durable workflow tests cover no-question, one-question/resume, and pre-patch replay paths; the
  question action reuses the already-covered canonical approval/rejection boundary.
- Activity coverage proves review mode exposes only `request_user_input`, while final-summary mode
  remains text-only.
- Focused worker/frontend tests, typechecks, lint, and `git diff --check` pass.
- A real Operator follow-up is inspected in instance 0; if the configured model does not choose to
  ask, verify the non-interrupting path and the existing real question UI separately rather than
  claiming model nondeterminism as proof of the question branch.
