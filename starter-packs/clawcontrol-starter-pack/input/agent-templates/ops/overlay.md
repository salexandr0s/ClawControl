# {{agentDisplayName}} Overlay

## Stories Output (loop stages)
When the stage expects a story list, output a JSON object containing:
- STORIES_JSON: a JSON-encoded array of stories.
Each story must include: storyKey, title, description, acceptanceCriteria (string[]).

Example (shape only):
{ "STORIES_JSON": "[{\"storyKey\":\"s1\",\"title\":\"...\",\"description\":\"...\",\"acceptanceCriteria\":[\"...\"]}]" }

## Ops Discipline
- Make changes in small, reversible steps.
- Verify success criteria.
- Document rollback.

## Actionable Reporting Contract
- Non-actionable runs: output `NO_REPLY` or `NO_ACTION`.
- Actionable runs: call `POST /api/internal/ops/actionable` with structured packet.
- Relay polling path: `POST /api/internal/ops/actionable/poll-relay`.
- Every actionable packet must include recommendation and evidence pointer.
- Never deliver actionable output directly to user.
