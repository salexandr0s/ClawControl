# Release Checklist

Use this checklist when preparing a new release of SAVORG Mission Control.

---

## Pre-Release

### Code Quality

- [ ] All type errors resolved: `npm run typecheck`
- [ ] Linter passes: `npm run lint`
- [ ] Build succeeds: `npm run build`
- [ ] No console errors in browser

### Security

- [ ] All mutating endpoints use `enforceTypedConfirm()`
- [ ] All file operations use `isValidWorkspacePath()`
- [ ] No hardcoded secrets or credentials
- [ ] Activity logging for significant actions
- [ ] Review `docs/audit/audit-security.md` for gaps

### Database

- [ ] Migrations are up to date: `npm run db:migrate`
- [ ] Schema matches Prisma client: `npx prisma generate`
- [ ] Seed data works: `npm run db:seed`
- [ ] No pending schema changes

### Documentation

- [ ] README.md is current
- [ ] CHANGELOG.md updated with new version
- [ ] Breaking changes documented
- [ ] New features documented
- [ ] Security docs updated if needed

---

## Release Process

### Version Bump

1. Update version in `package.json`:
   ```json
   {
     "version": "0.2.0"
   }
   ```

2. Update version in `apps/mission-control/package.json`:
   ```json
   {
     "version": "0.2.0"
   }
   ```

### Changelog

Add entry to CHANGELOG.md:

```markdown
## [0.2.0] - YYYY-MM-DD

### Added
- Feature X
- Feature Y

### Changed
- Updated Z behavior

### Fixed
- Bug A
- Bug B

### Security
- Fixed security issue C
```

### Git Tag

```bash
git add -A
git commit -m "chore: release v0.2.0"
git tag v0.2.0
git push origin main --tags
```

### GitHub Release

1. Go to Releases → Draft new release
2. Select tag `v0.2.0`
3. Title: `v0.2.0`
4. Copy changelog entry to description
5. Publish release

---

## Post-Release

### Verification

- [ ] Clone fresh and follow README quickstart
- [ ] `npm install` succeeds
- [ ] `npm run build` succeeds
- [ ] `npm run dev` starts correctly
- [ ] Core features work in browser

### Communication

- [ ] Update any external documentation
- [ ] Notify users of breaking changes
- [ ] Close related GitHub issues

---

## Hotfix Process

For urgent fixes to released versions:

1. Create hotfix branch: `git checkout -b hotfix/v0.2.1`
2. Apply minimal fix
3. Bump patch version: `0.2.0` → `0.2.1`
4. Follow release process above
5. Cherry-pick fix to main if needed

---

## Version Numbering

We follow [Semantic Versioning](https://semver.org/):

| Change Type | Version Bump | Example |
|-------------|--------------|---------|
| Breaking change | Major | 0.x.x → 1.0.0 |
| New feature | Minor | 0.1.x → 0.2.0 |
| Bug fix | Patch | 0.1.0 → 0.1.1 |

During alpha (0.x.x):
- Minor version for features
- Patch version for fixes
- Breaking changes allowed in minor versions

---

## Dependencies

### Before Release

Check for security vulnerabilities:

```bash
npm audit
```

If vulnerabilities found:

```bash
# Auto-fix where possible
npm audit fix

# Review remaining issues
npm audit --audit-level=high
```

### Dependency Updates

Major dependency updates should be:
1. Done in a separate PR
2. Tested thoroughly
3. Documented in CHANGELOG

---

## Build Artifacts

### Production Build

```bash
# Clean previous builds
npm run clean

# Install fresh dependencies
npm install

# Build all packages
npm run build
```

### Build Verification

```bash
# Start production server
npm run start --prefix apps/mission-control

# Verify at http://localhost:3000
```

---

## Rollback Procedure

If a release has critical issues:

1. **Revert tag** (if not widely distributed):
   ```bash
   git tag -d v0.2.0
   git push origin :refs/tags/v0.2.0
   ```

2. **Publish hotfix**:
   - Apply fix
   - Release as v0.2.1
   - Note regression in CHANGELOG

3. **Communicate**:
   - Update GitHub release notes
   - Notify users if needed
