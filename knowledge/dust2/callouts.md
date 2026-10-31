# Dust2 Team Callouts

This file intentionally separates **team-facing names** from the engine's stable
zone IDs. Directional words such as “left” and “right” are viewpoint-dependent,
so the engine uses world coordinates and zone IDs, while the UI can show the
team's habitual names.

## T-spawn view

Using the team's convention:

```text
匪家 / T 出生点
   左手方向 -> B洞 / B通
   中间方向 -> 中路
   右手方向 -> A大
```

This is a display convention only. It is not used for internal classification.

## B side

```text
匪家
  └─ B洞下层（B洞入口）
       └─ B洞上层
            ├─ B窗口 / 狗洞
            └─ B包点
```

| Engine ID | Team-facing name | Meaning |
|---|---|---|
| `b_tunnel` | B洞 / B通 | the whole B tunnel route |
| `lower_tunnels` | B洞下层 / B洞入口 | tunnel section closer to T spawn |
| `upper_tunnels` | B洞上层 | tunnel section closer to B site |
| `b_window` | B窗口 / 狗洞 | small window/opening beside B site |
| `b_site` | B包点 / B点 | bomb site B |

The `b_window` polygon is currently a draft. Validate its exact boundary in-game
or against a demo where a player explicitly holds the window.

## A side and mid

| Engine ID | Team-facing name |
|---|---|
| `a_long` | A大 / 长道 |
| `a_long_pit` | A大坑 / 坑位 |
| `long_doors` | A门 / 长门 |
| `a_short` | A小 |
| `a_short_stairs` | A小楼梯 |
| `a_site` | A包点 / A点 |
| `mid` | 中路 |
| `mid_doors` | 中门 |
| `xbox` | Xbox |
| `catwalk` | Catwalk / 警家连接 |
| `ct_spawn` | 警家 / CT家 |

## Rule for the knowledge base

Do not encode “left” or “right” as tactical truth. Encode:

```json
{
  "id": "b_tunnel",
  "display_aliases": ["B洞", "B通", "匪家左手"]
}
```

The stable identity is the zone ID and its coordinates. The alias is only for
human-readable output.
