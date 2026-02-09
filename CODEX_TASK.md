# ClawControl Performance Investigation & Fixes

## Context
ClawControl is a desktop app (Electron + Next.js) for managing OpenClaw. The production build is experiencing severe performance issues.

**Workspace:** `/Users/savorgserver/OpenClaw/projects/ClawControl`
**Stack:** Next.js 14 monorepo, Electron, Prisma + SQLite, React

---

## Priority Issues

### 1. 🔴 CRITICAL: App is extremely slow / not snappy
**Symptom:** Everything feels sluggish. Tab switching takes forever.

**Investigate:**
- React re-renders — are components re-rendering unnecessarily on every state change?
- Check for missing `useMemo`/`useCallback` on expensive computations
- Look for synchronous blocking operations on the main thread
- Check if Next.js is doing unnecessary SSR/hydration in Electron context
- Inspect bundle size — are we loading too much JS upfront?
- Check for memory leaks (event listeners not cleaned up, growing state)

**Tools:**
- React DevTools Profiler
- Electron DevTools Performance tab
- `why-did-you-render` for React

---

### 2. 🔴 CRITICAL: Agents tab loads slowly every time
**Symptom:** Agents take a long time to load initially. After switching tabs and coming back, they reload from scratch instead of being cached.

**Expected behavior:** Load once, cache in memory, update in background periodically.

**Investigate:**
- Is the agents list being fetched on every tab mount?
- Check if React Query/SWR caching is configured (staleTime, cacheTime)
- Look for `useEffect` fetches without proper caching
- Check if the component unmounts completely on tab switch (losing state)

**Fix approach:**
- Implement proper caching with stale-while-revalidate pattern
- Keep agent data in global state (Zustand/Context) that persists across tab switches
- Background refresh with longer intervals (e.g., every 30s-60s)

---

### 3. 🟡 HIGH: Workspace tab not showing full workspace
**Symptom:** Only shows "agent-templates" and "playbooks" instead of the entire workspace tree.

**Context:** Workspace path is set correctly during launch.

**Investigate:**
- Check the file tree fetching logic — is it filtering/limiting results?
- Look for hardcoded paths or allowlist patterns
- Check if there's a depth limit on directory traversal
- Verify the workspace path is being passed correctly to the file tree component
- Check for errors in console when loading workspace

---

### 4. 🟡 HIGH: Plugins tab completely broken
**Symptom:** Can't click on Plugins tab at all — acts like it doesn't exist.

**Investigate:**
- Check if the Plugins tab/route is actually rendered
- Look for conditional rendering that hides it (feature flag? permission check?)
- Check for JS errors when clicking
- Inspect the element — is it there but with `pointer-events: none` or `display: none`?
- Check if there's a loading state that never resolves

---

## Deliverables

1. **Root cause analysis** for each issue with evidence (code snippets, profiler screenshots)
2. **Specific fixes** with diffs
3. **Performance metrics** before/after if possible
4. **Any quick wins** discovered along the way

## Commands

```bash
# Navigate to project
cd ~/OpenClaw/projects/ClawControl

# Install deps if needed
pnpm install

# Run in dev mode for debugging
pnpm dev

# Build production
pnpm build

# Run production build
pnpm start
```

## Notes
- Focus on production build behavior, not just dev mode
- The app uses Electron — check both renderer and main process
- Don't refactor unrelated code — surgical fixes only
