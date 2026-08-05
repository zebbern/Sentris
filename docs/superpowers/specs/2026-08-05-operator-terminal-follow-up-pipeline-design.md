# Operator Terminal Follow-up Pipeline Design

## Goal

Present an Operator-launched workflow and its automatic terminal inspection as one coherent
user journey without changing the durable execution model.

## Current problem

The backend correctly creates a fresh `run_follow_up` Temporal turn after an Operator-launched
run becomes terminal. The frontend currently renders that durable turn as a second chat turn,
including its system-generated user message. It then renders terminal evidence and another run
card below the timeline. Users therefore see one logical workflow journey split across multiple
sections with a duplicated run card.

## Selected design

Extend the existing `OperatorTimeline` display projection:

1. Keep the existing `execute_plan` to proposal-turn projection.
2. Index succeeded `run_workflow` and `retry_run` actions by their exact `runId`.
3. Project a `run_follow_up` turn onto the display turn that launched the same `runId`. If that
   launch was itself projected into a proposal turn, reuse that final display turn.
4. Suppress the user-role message belonging to a projected `run_follow_up` turn. It is generated
   by the terminal coordinator and is control-plane narration, not user input.
5. Render the follow-up's `get_run` action and assistant summary in chronological order inside
   the source display group.
6. Render deterministic terminal evidence at the end of that group once the follow-up has an
   assistant response.
7. Omit the evidence section's second `OperatorRunActivity` when the same display group already
   contains the source run action. Keep it for standalone manual run inspections.

No backend rows, Temporal histories, action identities, messages, or API contracts are changed.

## Compatibility and fallbacks

- A `run_follow_up` without a matching visible source action remains its own turn.
- Direct `get_run` requests continue to show both recorded evidence and the run card.
- Finding inspections retain their existing follow-up actions and source-run card.
- Failed or still-running automatic follow-ups remain visible through their durable action state;
  terminal evidence appears only after a successful inspection and assistant response.
- Retry-launched runs use the same exact-`runId` projection as ordinary launches.

## Verification

- A focused rendered regression covers launch turn + automatic follow-up and proves there is one
  display group, no generated automatic-follow-up bubble, one run card, and visible terminal
  evidence/summary.
- Existing standalone `get_run` evidence behavior remains covered.
- Frontend typecheck and focused lint pass.
- The completed real Operator session is reloaded in the browser and verified for coherent
  grouping, no duplicate run card, no framework overlay, and no console errors.
