# Weapon and Economy Highlight Contract

This layer sits between the demo parser and the AI coach. It does not rate players
by K/D. It extracts explainable weapon/economic moments and gives the AI a small,
evidence-linked fact set.

## Extracted signals

- low-cost/off-meta weapon kills
- first blood with a low-cost weapon
- eco/force/pistol-round kills
- multi-kill rounds with SMGs, shotguns, pistols or other special weapons
- Deagle/R8/dual-wield kills
- per-player top weapon profile for normal rifle/AWP context

## Example highlight

```json
{
  "player_name": "A",
  "weapon": "revolver",
  "weapon_label": "R8 Revolver",
  "cost": 600,
  "kills": 2,
  "first_bloods": 1,
  "economy_kills": 2,
  "rounds": [3, 8],
  "reason": "R8 Revolver 属于冷门/非常规选择；在 eco 局拿到 2 杀；其中 1 次首杀",
  "evidence_ids": ["kill_0041", "kill_0110"]
}
```

## AI prompt policy

The AI may mention ordinary AK/M4/AWP performance briefly, but must only make a
headline out of:

- an off-meta/low-cost weapon with real impact;
- an eco/force/pistol first blood;
- an SMG/shotgun timing or multi-kill;
- a special pistol (Deagle/R8/dual-wield) with real impact.

It must not infer long-term player style from one match. It must cite the kill
evidence IDs. If the sample is thin, it must say so.

## Files

```text
backend/src/services/weaponImpact.js
backend/tests/weaponImpact.test.js
```

During a demo job, the result is written to:

```text
<demo-job-dir>/weapon-facts.json
```

The AI job reads that file and adds the compact highlights to its fact payload.

## Current limits

- Weapon prices are approximate.
- A kill in an eco round does not prove that the opponent made a mistake.
- The extractor does not yet understand weapon pickup/drop history in detail.
- Bullet penetration, wallbang, smoke and flash interaction are not yet combined
  into the highlight score.
- The frontend does not display a separate weapon-highlights tab yet.

## Per-player impact and sampled transitions

The extractor also emits:

- `player_weapon_impact`: a transparent weapon-only score with kills, first
  bloods, economy kills and top weapons;
- `weapon_transitions`: sampled active-weapon changes from all-player snapshots.

`weapon_transitions` are **not** proof of a pickup or deliberate weapon switch.
They are compact context for the AI and must always be presented as sampled
evidence, not as a definitive pickup/drop log.
