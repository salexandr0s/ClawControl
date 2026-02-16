#!/usr/bin/env node

 

import fsp from 'node:fs/promises';
import path from 'node:path';

const ROLES = [
  'build',
  'buildreview',
  'ceo',
  'guard',
  'manager',
  'ops',
  'plan',
  'planreview',
  'research',
  'security',
  'ui',
  'uireview',
];

const REQUIRED_GLOBAL_DOCS = [
  'AGENTS.md',
  'SOUL.md',
  'HEARTBEAT.md',
  'ACCESS.md',
  'CONTEXT.md',
  'agents/SOUL.md',
  'agents/HEARTBEAT.md',
];

const REQUIRED_AGENT_DOCS = [
  'SOUL.md',
  'HEARTBEAT.md',
  'ONBOARDING.md',
  'CAPABILITIES.md',
  'MEMORY.md',
  'WORKING.md',
  'ANNOUNCEMENT.md',
  '.learnings/LEARNINGS.md',
];

function parseArgs(argv) {
  const out = {
    root: process.cwd(),
    maxContextAgeDays: 30,
    failOnStale: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--fail-on-stale') {
      out.failOnStale = true;
      continue;
    }

    if (arg.startsWith('--root=')) {
      out.root = arg.slice('--root='.length);
      continue;
    }

    if (arg === '--root') {
      out.root = argv[i + 1] || out.root;
      i += 1;
      continue;
    }

    if (arg.startsWith('--max-context-age-days=')) {
      out.maxContextAgeDays = Number(arg.slice('--max-context-age-days='.length));
      continue;
    }

    if (arg === '--max-context-age-days') {
      out.maxContextAgeDays = Number(argv[i + 1] || out.maxContextAgeDays);
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isFinite(out.maxContextAgeDays) || out.maxContextAgeDays < 0) {
    throw new Error('max-context-age-days must be a non-negative number');
  }

  out.root = path.resolve(out.root);
  return out;
}

async function exists(absPath) {
  try {
    await fsp.access(absPath);
    return true;
  } catch {
    return false;
  }
}

async function readText(absPath) {
  return fsp.readFile(absPath, 'utf8');
}

function extractMetadata(content) {
  const lastUpdatedMatch = content.match(/^\s*-\s*Last Updated:\s*(.+)$/im);
  const updatedByMatch = content.match(/^\s*-\s*Updated By:\s*(.+)$/im);
  const sourceMatch = content.match(/^\s*-\s*Source of Truth:\s*(.+)$/im);

  return {
    lastUpdated: lastUpdatedMatch ? lastUpdatedMatch[1].trim() : null,
    updatedBy: updatedByMatch ? updatedByMatch[1].trim() : null,
    sourceOfTruth: sourceMatch ? sourceMatch[1].trim() : null,
  };
}

function parseIsoDate(dateValue) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return null;
  const asDate = new Date(`${dateValue}T00:00:00Z`);
  if (Number.isNaN(asDate.getTime())) return null;
  return asDate;
}

function daysBetween(dateA, dateB) {
  const diffMs = Math.max(0, dateA.getTime() - dateB.getTime());
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

async function main() {
  const args = parseArgs(process.argv);
  const errors = [];
  const warnings = [];

  for (const relPath of REQUIRED_GLOBAL_DOCS) {
    const absPath = path.join(args.root, relPath);
    if (!(await exists(absPath))) {
      errors.push(`Missing required global doc: ${relPath}`);
    }
  }

  const activeRoles = [];
  for (const role of ROLES) {
    const rolePromptPath = path.join(args.root, 'agents', `${role}.md`);
    if (await exists(rolePromptPath)) {
      activeRoles.push(role);
    }
  }

  for (const role of activeRoles) {
    for (const rel of REQUIRED_AGENT_DOCS) {
      const relPath = path.join('agents', role, rel);
      const absPath = path.join(args.root, relPath);
      if (!(await exists(absPath))) {
        errors.push(`Missing required agent doc: ${relPath}`);
      }
    }
  }

  const metadataTargets = ['ACCESS.md', 'CONTEXT.md'];
  for (const relPath of metadataTargets) {
    const absPath = path.join(args.root, relPath);
    if (!(await exists(absPath))) continue;

    const content = await readText(absPath);
    const metadata = extractMetadata(content);

    if (!metadata.lastUpdated) errors.push(`Missing metadata in ${relPath}: Last Updated`);
    if (!metadata.updatedBy) errors.push(`Missing metadata in ${relPath}: Updated By`);
    if (!metadata.sourceOfTruth) errors.push(`Missing metadata in ${relPath}: Source of Truth`);

    if (metadata.lastUpdated) {
      const lastDate = parseIsoDate(metadata.lastUpdated);
      if (!lastDate) {
        errors.push(`Invalid Last Updated format in ${relPath}: ${metadata.lastUpdated} (expected YYYY-MM-DD)`);
      } else {
        const today = new Date();
        const ageDays = daysBetween(today, lastDate);
        if (ageDays > args.maxContextAgeDays) {
          warnings.push(`${relPath} is stale (${ageDays} days old; threshold ${args.maxContextAgeDays})`);
        }
      }
    }
  }

  console.log(`[check-agent-docs] Root: ${args.root}`);
  console.log(`[check-agent-docs] Active roles detected: ${activeRoles.join(', ') || '(none)'}`);

  if (errors.length > 0) {
    console.error('[check-agent-docs] Errors:');
    for (const msg of errors) {
      console.error(`  - ${msg}`);
    }
  }

  if (warnings.length > 0) {
    console.warn('[check-agent-docs] Warnings:');
    for (const msg of warnings) {
      console.warn(`  - ${msg}`);
    }
  }

  if (errors.length > 0) {
    process.exit(1);
  }

  if (warnings.length > 0 && args.failOnStale) {
    process.exit(1);
  }

  console.log('[check-agent-docs] OK');
}

main().catch((err) => {
  console.error(`[check-agent-docs] ${err.message}`);
  process.exit(1);
});
