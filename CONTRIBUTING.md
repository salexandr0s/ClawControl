# Contributing to SAVORG Mission Control

Thank you for your interest in contributing! This document provides guidelines for contributing to the project.

---

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR-USERNAME/savorgos.git`
3. Install dependencies: `npm install`
4. Create a branch: `git checkout -b feature/your-feature`

See [docs/SETUP.md](docs/SETUP.md) for detailed setup instructions.

---

## Development Workflow

### Running Locally

```bash
# Start development server
npm run dev

# Run type checking
npm run typecheck

# Run linter
npm run lint
```

### Making Changes

1. **Write code** — Follow existing patterns in the codebase
2. **Test locally** — Verify changes work in the browser
3. **Check types** — Run `npm run typecheck`
4. **Check lint** — Run `npm run lint`
5. **Commit** — Write clear commit messages

### Commit Messages

Use conventional commit format:

```
feat: add agent template export
fix: resolve path traversal in workspace
docs: update security documentation
refactor: simplify Governor policy lookup
```

---

## Code Style

### TypeScript

- Use strict TypeScript (no `any` unless absolutely necessary)
- Prefer interfaces over types for object shapes
- Export types that are part of public API

### React

- Use functional components with hooks
- Prefer server components where possible (Next.js App Router)
- Keep components focused and composable

### File Organization

```
apps/mission-control/
├── app/                 # Next.js app router pages
│   ├── (dashboard)/     # Dashboard layout group
│   └── api/             # API routes
├── components/          # React components
│   ├── shell/           # Layout components
│   └── ui/              # Reusable UI components
└── lib/                 # Server utilities
    ├── repo/            # Data access layer
    └── templates/       # Template utilities
```

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Files | kebab-case | `agent-templates-client.tsx` |
| Components | PascalCase | `AgentTemplatesClient` |
| Functions | camelCase | `getTemplateById` |
| Types/Interfaces | PascalCase | `AgentTemplate` |
| Constants | UPPER_SNAKE | `ALLOWED_SUBDIRS` |

---

## Security Requirements

All contributions must follow security guidelines:

### Governor Enforcement

All mutating API endpoints must use Governor:

```typescript
const result = await enforceTypedConfirm({
  actionKind: 'your.action',
  typedConfirmText,
})

if (!result.allowed) {
  return NextResponse.json({ error: result.errorType }, { status: 403 })
}
```

### Path Validation

File operations must validate paths:

```typescript
if (!isValidWorkspacePath(path)) {
  return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
}
```

### Activity Logging

Significant actions must be logged:

```typescript
await repos.activities.create({
  type: 'your.action',
  actor: 'user',
  entityType: 'entity',
  entityId: id,
  summary: 'Description of action',
  payloadJson: { /* details */ },
})
```

### Command Execution

Never use shell interpolation:

```typescript
// GOOD: Array arguments
spawn('command', ['arg1', 'arg2'])

// BAD: String interpolation
exec(`command ${arg1} ${arg2}`)
```

See [docs/SECURITY.md](docs/SECURITY.md) for full security guidelines.

---

## Pull Request Process

### Before Submitting

- [ ] Code follows project style
- [ ] Types are correct (`npm run typecheck`)
- [ ] Linter passes (`npm run lint`)
- [ ] Changes work in browser
- [ ] No security issues introduced

### PR Description

Include:
- **What** — Brief description of changes
- **Why** — Motivation for the change
- **How** — Technical approach (if non-obvious)
- **Testing** — How you verified the changes

### Review Process

1. Submit PR against `main` branch
2. Address review feedback
3. Squash commits if requested
4. Maintainer merges when approved

---

## Adding New Features

### API Routes

1. Create route in `apps/mission-control/app/api/`
2. Add Governor enforcement for mutations
3. Log activities for significant actions
4. Add to README if user-facing

### UI Pages

1. Create page in `apps/mission-control/app/(dashboard)/`
2. Add server component for data fetching
3. Add client component for interactivity
4. Add navigation item in `rail-nav.tsx`

### Governor Actions

1. Add action kind to `packages/core/src/governor/index.ts`
2. Set appropriate policy level
3. Add prompts for CONFIRM actions
4. Document in `docs/SECURITY.md`

### Workspace Directories

1. Add to `ALLOWED_SUBDIRS` in `lib/workspace.ts`
2. Add mock data in `packages/core/src/mocks/`
3. Update `docs/PATH_POLICY.md`

---

## Testing

### Manual Testing

Currently, testing is manual. Before submitting:

1. Start dev server: `npm run dev`
2. Navigate to affected pages
3. Test happy path and error cases
4. Check browser console for errors

### Future: Automated Tests

We plan to add:
- Unit tests with Vitest
- Integration tests for API routes
- E2E tests with Playwright

---

## Documentation

### When to Update Docs

- New features → Update README and relevant docs
- API changes → Update API documentation
- Security changes → Update SECURITY.md
- Path policy changes → Update PATH_POLICY.md

### Documentation Style

- Use clear, concise language
- Include code examples
- Use tables for structured information
- Link to related documentation

---

## Getting Help

- **Questions** — Open a GitHub Discussion
- **Bugs** — Open a GitHub Issue with reproduction steps
- **Security** — Email security@your-org.com (do not open public issue)

---

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
