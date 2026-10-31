# Dust2 Knowledge Base v0.1

This is the first deliverable of the curated Route A plan.

It is **not** a finished tactical truth database and it deliberately does not
pretend that approximate coordinates are verified. Its purpose is to give the
future Dust2 rule engine a stable vocabulary for:

- map callouts and approximate regions
- logical spawn slots
- core utility intents
- tactic templates
- evidence requirements
- validation status

## Current scope

```text
map: de_dust2 only
zones: 18
spawn slots: 8
core utility intents: 10
tactic templates: 6
  T: A long rush, B tunnel rush, A short split, mid default/fake
  CT: default, A long pressure
```

## Files

| File | Purpose |
|---|---|
| `meta.json` | map calibration, confidence policy, limits |
| `zones.json` | approximate callouts, world/radar conversion, spawn slots |
| `utility.json` | utility purpose, timing, target zone, evaluation checks |
| `tactics.json` | tactic steps, success conditions, failure modes, adaptations |
| `sources.json` | source IDs and validation status |
| `sources.md` | human-readable source notes and validation checklist |

Run the structural validator:

```bash
cd backend
node scripts/validate-dust2-knowledge.js
```

## Confidence policy

| Status | Meaning | Engine behavior |
|---|---|---|
| `verified` | Checked against a real demo and/or in-game | may drive a hard rule |
| `community` | From a public guide or community convention | can suggest, but needs evidence |
| `draft` | Initial expert draft | candidate-only, never definite blame |
| `unknown` | Data unavailable | no claim |

Most tactical and coordinate data in v0.1 is `draft`. This is intentional.

## Important limits

1. Zone centers and radii are approximate. They must be calibrated against real
   round-start and event coordinates before hard classification.
2. Utility entries describe **intent and checks**, not exact lineups. A future
   validation step must capture origin, yaw/pitch, detonation tick and smoke
   coverage from real demos.
3. A smoke landing in the target zone does not prove that a sightline was
   blocked. The first engine version should output “suspected utility issue”,
   not “the player definitely threw a bad smoke”.
4. Demo data has no voice communication or intent. “Criminal” labels are
   entertainment candidates with evidence, not statements about a person.
5. Do not infer other maps from this file.

## Validation workflow

For each of the first 5-10 Dust2 demos:

1. Select the user's team.
2. Map round-start positions to the logical spawn slots.
3. Calibrate zone centers/radii against actual player positions.
4. Mark each utility with one of:
   - thrown and landed in target zone
   - thrown but missed target zone
   - thrown too late
   - thrown but no confirmed value
   - unattributed / insufficient data
5. Classify the round tactic and compare it with the template steps.
6. Ask a human CS2 player to review:
   - Is the callout correct?
   - Is the utility description plausible?
   - Is the tactic label correct?
   - Is the stated responsibility supported by evidence?
7. Update `confidence` and `needs_validation` fields.

## Initial engine module

The first deterministic engine slice lives in:

```text
backend/src/services/dust2Knowledge.js
backend/src/services/dust2Tactics.js
backend/tests/dust2Tactics.test.js
```

It already supports:

- Dust2-only guard
- approximate zone lookup from world coordinates
- early-round zone counts
- candidate tactic classification for:
  - A long rush
  - B tunnel rush
  - A short split
  - mid default/fake
  - CT default
  - CT A long pressure
- observed utility matching by target zone
- basic flash blind outcome counts
- tactic-template checks for required zones, spawn slots and utility
- per-round player zone involvement

It deliberately does **not** yet judge economy, opponent tendencies or plan
quality. Those require calibration and real demo labels.

Offline probe after parsing a demo:

```bash
cd backend
node scripts/analyze-dust2-parse.js /tmp/demo-out/parse.json T 12
node scripts/analyze-dust2-parse.js /tmp/demo-out/parse.json CT
```

## What the future rule engine should do with this file

The engine should not ask an LLM to decide whether a tactic was good. It should:

1. Read the tactic template.
2. Read the round event timeline.
3. Check required spawn and utility conditions.
4. Compare expected steps with actual steps.
5. Produce facts such as:

```json
{
  "plan": "dust2_t_a_long_rush",
  "plan_quality": "reasonable",
  "execution": "partial",
  "failed_checks": ["mid_smoke_late", "a_long_flash_no_blind"],
  "candidate_responsibility": [
    {"player": "A", "type": "utility_timing", "confidence": "medium"}
  ]
}
```

The LLM should only turn those facts into narrative. It must not invent a smoke,
a kill, a lineup or a tactical result.

## Explicitly deferred

- exact utility lineup capture
- demo calibration of polygons
- engine implementation
- more maps
- persistent user/team profiles
- historical opponent database
- pre-aim scoring
- ML training

## Next validation inputs needed

- 5-10 Dust2 `.dem` files from the target 5-stack level
- confirmation of exact callout names used by the players
- at least 10 in-game utility lineups with origin/target
- 2-3 humans to review tactic labels and “criminal” candidates
