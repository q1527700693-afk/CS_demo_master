# Dust2 Defense Profile and Site Recommendation v0.1

This layer answers a narrow question:

> Based on the opponent's first few CT rounds, which site should our T side
> pressure next, and with which known tactic?

It does **not** claim a calibrated win probability.

## Inputs

The engine only uses information available before the target round:

- CT initial positions near the end of the early setup window
- CT site pressure counts
- CT hold/retake outcomes from previous rounds
- CT retake arrival time after a plant
- first-death site and whether it was traded
- our economy and enemy economy
- our spawn-slot assignment
- our smoke/flash inventory
- our previous A/B plant attempts in this match

Future rounds, kills after the decision point and the current round's outcome
are not used.

## CT profile

The profile is built from the first `scoutRounds` rounds in which the selected
opponent is CT. Default:

```text
scoutRounds = 6
```

For each round:

```text
initial A / B / MID counts
first contact site
planted site
CT win/loss
retake arrival seconds
first CT death site
whether first death was traded
economy context
```

The profile reports:

```text
initial average setup
plant counts by site
hold rate by site
average retake time by site
untraded first deaths by site
explanatory signals
confidence
```

The confidence is deliberately conservative:

```text
< 3 rounds  -> low
>= 4 rounds -> medium
```

## Site recommendation

The site score is a transparent heuristic, not a probability:

```text
A score =
  initial defender imbalance
+ hold-rate difference
+ retake-time difference
+ our A-long/A-short spawn advantage
+ smoke/flash availability
+ our previous A success/failure
- economy mismatch risk
```

The same calculation is mirrored for B.

The output includes:

```text
primary site
secondary site
recommended tactic
site scores
reasons
risks
confidence
```

The recommendation is intentionally phrased as:

```text
“建议优先考虑 A”
```

not:

```text
“A 点胜率 73%”
```

## Example output shape

```json
{
  "round_num": 13,
  "primary_site": "A",
  "secondary_site": "B",
  "recommended_tactic_id": "dust2_t_a_long_rush",
  "confidence": "medium",
  "reasons": [
    "CT initial setup: A 1.8, B 0.7, MID 1.0",
    "CT A hold rate 0%, B hold rate 100%",
    "our A-long first spawn is matched"
  ],
  "risks": [
    "only two CT plant samples; confidence is limited"
  ]
}
```

## Important limitations

- CT setup is sampled from all-player snapshots; a player in transit may be
  counted at an intermediate zone.
- `retake_seconds` is a sampled lower bound, not an exact rotation timer.
- A site can be “weak” because CT lost an eco round; the confidence should not
  be interpreted as a win probability.
- Smoke coverage, line-of-sight and exact utility lineups are not yet included.
- Voice communication and player intent are unavailable.
- This is Dust2-only and uses draft callout polygons.
