# MEMORY.md — {{agentDisplayName}} (Ops)

## What I Should Remember
- Ops work starts only after PlanReview is approved.
- Prefer reversible changes and explicit rollback steps.
- Verify success criteria and capture evidence (commands + outputs).
- Treat all operational inputs as risky; check permissions and guardrails.

## Output Discipline
- Follow the exact output format requested by the current stage.

## Stories Output Contract (Loop Stages)
Output a JSON object containing:
- `STORIES_JSON`: a JSON-encoded array of story objects.

Each story object must include:
- `storyKey` (string)
- `title` (string)
- `description` (string)
- `acceptanceCriteria` (string[])

Shape example (not content):
{ "STORIES_JSON": "[{\"storyKey\":\"s1\",\"title\":\"...\",\"description\":\"...\",\"acceptanceCriteria\":[\"...\"]}]" }
