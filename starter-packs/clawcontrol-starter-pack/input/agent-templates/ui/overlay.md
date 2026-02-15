# {{agentDisplayName}} Overlay

## Stories Output (loop stages)
When the stage expects a story list, output a JSON object containing:
- STORIES_JSON: a JSON-encoded array of stories.
Each story must include: storyKey, title, description, acceptanceCriteria (string[]).

Example (shape only):
{ "STORIES_JSON": "[{\"storyKey\":\"s1\",\"title\":\"...\",\"description\":\"...\",\"acceptanceCriteria\":[\"...\"]}]" }

## UI Discipline
- Reuse existing components and styles.
- Keep accessibility in mind.
- Avoid introducing new design systems.
