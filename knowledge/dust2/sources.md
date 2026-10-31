# Dust2 v0.1 Sources

This document records where knowledge came from and what still needs verification.
It is intentionally conservative: public guide URLs are **candidates**, not
authoritative facts until a human opens and checks them.

## Source table

| ID | Source | Status | Used for |
|---|---|---|---|
| `local_map_calibration` | `frontend/public/maps/2000933/map_data.json` | verified | radar/world coordinate calibration |
| `local_radar_image` | `frontend/public/maps/2000933/radars/de_dust2.png` | verified asset | approximate zone centers |
| `expert_draft` | Project tactical draft | draft | callouts, spawn roles, tactics, utility intent |
| `community_callouts` | Community Dust2/callout references | needs validation | callout names, common utility targets |
| `awpy_docs` | <https://awpy.readthedocs.io/> | reference | demo parsing, event semantics |
| `hltv_demos` | <https://www.hltv.org/results> | future optional | small validation/demo set |

The machine-readable form is `sources.json`.

## Coordinate calibration

From the local CS2 build `2000933` radar metadata:

```text
de_dust2
pos_x = -2476
pos_y = 3239
scale = 4.4
rotate = 1
```

World-to-radar:

```text
radar_x = (world_x - pos_x) / scale
radar_y = (pos_y - world_y) / scale
```

Radar-to-world:

```text
world_x = pos_x + radar_x * scale
world_y = pos_y - radar_y * scale
```

The zone centers in `zones.json` were estimated visually from the radar image.
They are therefore `draft`, not `verified`.

## Public reference candidates

These are starting points for a human-assisted source review:

- <https://totalcsgo.com/maps>
- <https://steamcommunity.com/app/730/guides/>
- <https://liquipedia.net/counterstrike/Dust_II>
- <https://awpy.readthedocs.io/>
- <https://github.com/pnxenopoulos/awpy>
- <https://www.hltv.org/results>

Before using an external source as a factual reference:

1. Confirm the page still exists and is about CS2, not only CS:GO.
2. Confirm the utility is still valid after map/update changes.
3. Record the exact URL and access date in `sources.json`.
4. Do not copy long text or paid guide content.
5. If possible, reproduce the line/tactic in a local demo and mark it `verified`.

## Validation checklist

### Callouts

- [ ] A long / long doors / pit names match the team's language
- [ ] A short / stairs / catwalk names match the team's language
- [ ] Mid / Xbox / mid doors names match
- [ ] B tunnels / upper / lower names match
- [ ] CT spawn / CT ramp names match

### Utility

- [ ] `t_mid_fast_smoke` validates from the intended spawn
- [ ] `t_a_long_smoke` validates against the intended A long angle
- [ ] `t_a_long_flash` blinds the intended defender position
- [ ] `t_a_short_smoke` validates at A short
- [ ] `t_a_short_flash` creates a usable entry window
- [ ] `t_b_tunnel_smoke` validates at B tunnel
- [ ] `t_b_tunnel_fire` creates a useful delay
- [ ] `t_b_tunnel_flash` blinds the B-site defender
- [ ] `t_a_site_postplant_smoke` covers the intended retake lane
- [ ] `ct_a_long_push_flash` supports a survivable A long push

### Tactics

- [ ] A long rush steps match actual team behavior
- [ ] B tunnel rush steps match actual team behavior
- [ ] A short split timing is realistic
- [ ] Mid default/fake conditions make sense
- [ ] CT default roles match the team's defensive setup
- [ ] CT A long pressure is only recommended when the evidence supports it

## Known source limitations

- The workspace may not have stable internet access to review every URL.
- Videos and in-game demos are not machine-readable by this draft.
- A public guide may be outdated after a CS2 map update.
- A “good” lineup on one ping/browser setup can fail on another; treat timings
  as ranges, not exact promises.
- No source in this folder overrides actual demo evidence.
