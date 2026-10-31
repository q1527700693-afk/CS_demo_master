# Dust2 v0.1 Demo Validation Notes

## Inputs reviewed

Five local Dust2 demos were parsed with awpy 3.1.1:

| Demo | Map | Rounds |
|---|---|---:|
| `9205536974862648204_0` | de_dust2 | 15 |
| `9208773991702023180_0` | de_dust2 | 24 |
| `9216514553255287308_0` | de_dust2 | 23 |
| `9220032991349219468_0` | de_dust2 | 29 |
| `9221581047725859468_0` | de_dust2 | 17 |

All five were Dust2. The common roster was identified across side switches by
the roster containing `cj9y` in the local test data; the engine accepts either a
demo team name or a SteamID roster.

## Calibration corrections made from real data

1. `ct_spawn` was moved from an incorrect right-side radar estimate to the
   observed CT-spawn area around radar `(620,179)`.
2. T spawn radius was expanded to cover the observed spawn spread.
3. Early-round classification now starts at `round.freeze_end_tick`, not
   `round.start_tick`; otherwise every buy phase looks like a slow mid setup.
4. Radar polygons are now used before circle fallback for major route areas.
5. Smoke/fire/molly throwers can be inferred from grenade trajectories when the
   demo parser leaves `thrower_steamid` null:
   - same entity when available
   - nearest first trajectory point/tick
   - nearest fire endpoint for fire entities
   All attributions are marked `medium` or `low` confidence.
6. Bombsite plant events are used as an objective signal. Early B pressure plus
   an A plant is classified as a fake/default candidate, not a B rush.

## Initial engine observations

These are draft observations, not final coaching conclusions.

### Own-team T side

Across the five demos, the engine most often labeled the tested team's T rounds
as one of:

```text
dust2_t_mid_default_fake
dust2_t_b_tunnel_rush
dust2_t_a_long_rush (rare)
```

The recurring pattern is early B-tunnel/mid pressure followed by an A plant, or
a committed B hit. This may represent a real team tendency; it still requires
human review because the B-tunnel and mid polygons overlap at the T-side
approach.

### Opponent T side

Opponents also mixed:

```text
dust2_t_mid_default_fake
dust2_t_b_tunnel_rush
```

and their bomb plants were split between A and B. The engine currently does not
yet produce a stable opponent-style label from these counts; that comes after
manual round labels.

## Rounds to review first

These rounds exercise different template branches:

| Demo | Round | Why review |
|---|---:|---|
| `9208773991702023180_0` | 13 | early B pressure, A plant -> fake/rotate candidate |
| `9208773991702023180_0` | 16 | B plant -> B rush candidate |
| `9220032991349219468_0` | 20 | A-long early pressure, B plant -> fake/rotate candidate |
| `9220032991349219468_0` | 23 | A-long early pressure, A plant -> A-long candidate |
| `9221581047725859468_0` | 15 | A-long pressure, B plant -> fake/rotate candidate |

For each round the human reviewer should answer:

- Is the bomb site correct?
- Did the team actually intend the early route pressure?
- Is the label (rush vs default/fake) correct?
- Which player was responsible for the key utility or entry?
- Did the engine miss a rotate or overcount a shared corridor?

## Current limitations

- Callouts are still draft polygons; route overlap can cause false positives.
- Utility thrower attribution is inferred and must be shown as medium/low
  confidence in reports.
- Smoke coverage/LOS is not implemented; the engine cannot yet say that a smoke
  definitively failed to block a specific angle.
- Pre-aim is not computed.
- The first version analyzes template fit, not economy-optimal decision quality.
- The AI narrative layer is not connected to this engine yet.

## Next calibration step

Calibrate the overlapping T-side approach areas:

```text
t_ramp vs lower_tunnels
mid vs xbox
a_short vs catwalk
b_tunnel vs upper_tunnels
ct_spawn vs mid_doors
```

Use the `center_radar` / `polygon_radar` fields in `zones.json` and verify with
the five parsed demos plus in-game lineups.
