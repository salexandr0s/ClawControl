# MEMORY.md — {{agentDisplayName}} (UI)

## What I Should Remember
- UI work starts only after PlanReview is approved.
- Follow existing UI patterns, tokens, and component conventions.
- Keep changes scoped to the workflow stage; avoid redesigning unrelated surfaces.
- Accessibility is not optional (keyboard, focus, labels, contrast).

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
