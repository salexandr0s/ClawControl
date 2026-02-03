# WO-MC-004 — Artifact contract surfaced/enforced

## Summary
Mission Control currently stores “artifact contracts” (e.g., required outputs, integration points, phase-0 proof) but they are not consistently **surfaced to users** nor **enforced by the system**.

This work order adds:
1) **Contract surfacing**: a visible “Contract” section on a Work Order detail screen that lists required outputs + integration points + phase-0 proof.
2) **Contract enforcement**: automated validation that marks a Work Order as “Contract: PASS/FAIL” and blocks terminal transitions when required outputs are missing/invalid.

The goal is to make contracts actionable, not just documentation.

---

## Goals
- Show the contract in the Mission Control UI where a user is actively working a WO (or reviewing it).
- Provide a deterministic “contract compliance” check:
  - missing required outputs
  - invalid/mismatched output paths
  - optional: invalid content types (e.g., JSON parse failure) if specified
- Prevent marking a WO “Done / Ready / Completed” when contract compliance fails.
- Make the compliance status easy to understand with a checklist + failures list.

## Non-goals
- Deep semantic validation of documents (only structural/path/type checks).
- Multi-repo enforcement beyond configured workspace roots.

---

## Definitions
- **Artifact Contract**: JSON definition collocated with a Work Order artifact folder (e.g., `.../WO-XXXX/contract.json`) describing required outputs, integration points, and phase-0 proof.
- **Compliance**: PASS if all required outputs exist and pass basic validation rules.

---

## UX / UI spec

### Component: `ArtifactContractPanel`
On the Work Order detail page:
- Status badge: PASS / FAIL / UNKNOWN / INVALID_CONTRACT
- Summary: “3/5 required outputs present”
- Sections:
  1) Required outputs checklist
  2) Integration points list
  3) Phase-0 proof steps

### Component: `ContractChecklist`
For each required output:
- label/name
- expected path
- expected type
- status: Present / Missing / Invalid
- invalid reason when applicable (e.g. JSON parse error)

### Transition blocking UX
When user attempts terminal transition:
- If FAIL/INVALID_CONTRACT: show clear message and link/scroll to Contract panel.

---

## Backend / validation spec

### Contract loading
- Load `contract.json` from the WO artifact folder.
- If missing: status UNKNOWN.
- If invalid JSON/schema: status INVALID_CONTRACT with errors.

### Validation rules (phase 0)
For each `requiredOutputs[]` item:
- path must be within artifact folder (reject `..` traversal)
- file must exist
- type validation:
  - markdown: `.md` extension
  - json: parseable JSON
  - file: existence only

Return:
```ts
type ContractCompliance = {
  status: 'PASS'|'FAIL'|'UNKNOWN'|'INVALID_CONTRACT'
  missing: Array<{path: string; label?: string}>
  invalid: Array<{path: string; label?: string; reason: string}>
  present: Array<{path: string; label?: string}>
  contractErrors?: string[]
}
```

### Enforcement hook
On transition to terminal states:
- compute compliance
- reject transition with reasons if FAIL/INVALID

---

## Acceptance criteria
1) Contract visible on WO detail page when `contract.json` exists.
2) Compliance status computed server-side and shown in UI.
3) Missing outputs listed with clear counts + paths.
4) Terminal transition blocked when compliance FAIL/INVALID.
5) Reject path traversal/absolute paths.
6) Phase-0 proof steps displayed exactly as specified.

---

## Phase-0 proof
1) Create a contract with 2 required outputs, only one exists → UI shows FAIL.
2) Create missing file → refresh → UI shows PASS.
3) Attempt terminal transition with FAIL → blocked.
4) Transition with PASS → succeeds.
