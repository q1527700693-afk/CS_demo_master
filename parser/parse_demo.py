#!/usr/bin/env python3
"""Parse a CS2 demo file into the backend's demo-analysis input contract.

This script is the only component that needs to understand the Source 2 demo
format. It deliberately does *no* judgement: it extracts measured facts and
writes them as JSON; all rules, report assembly and AI grounding live in the
Node backend (see backend/src/services/demoAnalysis.js).

Usage:
    python parse_demo.py --input match.dem --output parse.json [options]

Options:
    --input PATH            CS2 .dem file (required)
    --output PATH           destination JSON (required)
    --target-player STEAMID focus player; default is the top fragger
    --max-rounds N          keep at most N rounds (default 60)
    --sample-every N        target sample stride in ticks (default 32 = 0.5s)
    --check                 only verify that awpy is importable, then exit 0

Exit codes:
    0  success
    2  invalid usage or unreadable/invalid demo
    3  awpy (or its runtime) is not installed
    4  parsing failed

The JSON contract is documented in parser/README.md and validated by
backend/src/services/demoParser.js.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
import time
import traceback
from typing import Any, Iterable

SCHEMA_VERSION = "demo-parse-1.0.0"
MAX_KILLS = 5000
MAX_DAMAGES = 20000
MAX_BLINDS = 5000
MAX_BOMB = 2000
MAX_GRENADES = 4000
MAX_GRENADE_POINTS = 240
MAX_UTILITY_ROWS = 4000
MAX_INVENTORY = 400
DEFAULT_MAX_ROUNDS = 60
DEFAULT_SAMPLE_EVERY = 32


class UsageError(Exception):
    pass


def fail(code: int, message: str) -> None:
    payload = {"error": {"code": "demo_parse_failed" if code == 4 else "usage_error", "message": message}}
    sys.stderr.write(json.dumps(payload, ensure_ascii=False) + "\n")
    raise SystemExit(code)


def clean(value: Any) -> Any:
    """Convert polars/numpy scalars into JSON-safe values."""
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, float):
        return None if math.isnan(value) or math.isinf(value) else value
    if isinstance(value, (int, str)):
        return value
    if isinstance(value, dict):
        return {str(k): clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean(v) for v in value]
    item = getattr(value, "item", None)
    if callable(item):
        try:
            return clean(item())
        except Exception:  # pragma: no cover - defensive
            return None
    return str(value)


def rows(frame: Any, limit: int) -> tuple[list[dict[str, Any]], bool]:
    """Return at most `limit` rows; the flag reports truncation."""
    if frame is None:
        return [], False
    total = frame.height
    head = frame.head(limit) if total > limit else frame
    return [clean(row) for row in head.to_dicts()], total > limit


def steamid(value: Any) -> str | None:
    if value is None:
        return None
    text = str(clean(value)).strip()
    if not text or text in {"0", "None", "null"}:
        return None
    return text


def tick_rate(header: dict[str, Any], rounds: list[dict[str, Any]]) -> int:
    ticks = clean(header.get("playback_ticks"))
    seconds = clean(header.get("playback_time"))
    if isinstance(ticks, int) and isinstance(seconds, (int, float)) and seconds > 0:
        rate = round(ticks / seconds)
        if 32 <= rate <= 256:
            return rate
    return 64


class RoundIndex:
    def __init__(self, rounds: list[dict[str, Any]]) -> None:
        self.rounds = sorted(rounds, key=lambda r: r["round_num"])
        self.bounds = []
        for index, round_row in enumerate(self.rounds):
            start = round_row.get("start_tick") or 0
            end = round_row.get("official_end_tick") or round_row.get("end_tick") or start
            nxt = self.rounds[index + 1].get("start_tick") if index + 1 < len(self.rounds) else None
            self.bounds.append((start, end, nxt, round_row["round_num"]))

    def at(self, tick: int | None) -> int | None:
        if tick is None:
            return None
        for start, end, nxt, number in self.bounds:
            upper = nxt if nxt is not None else end
            if start <= tick <= max(end, upper):
                return number
        return None


def load_demo(path: str) -> Any:
    try:
        from awpy import Demo  # imported late so --check stays cheap
    except ModuleNotFoundError as error:  # pragma: no cover - environment dependent
        fail(3, f"awpy is not installed: {error}")
    except Exception as error:  # pragma: no cover
        fail(3, f"awpy could not be imported: {error}")
    try:
        return Demo(path)
    except FileNotFoundError:
        fail(2, f"demo file not found: {path}")
    except Exception as error:
        fail(2, f"invalid demo file: {error}")


def pick_target(stats: list[dict[str, Any]], explicit: str | None, warnings: list[str]) -> str | None:
    known = [row for row in stats if steamid(row.get("steamid"))]
    if explicit:
        if any(steamid(row.get("steamid")) == explicit for row in known):
            return explicit
        warnings.append(f"target player {explicit} is not in the demo roster; falling back to the top fragger")
    if not known:
        return None
    best = max(known, key=lambda row: (row.get("kills") or 0, row.get("adr") or 0))
    return steamid(best.get("steamid"))


def collect(demo: Any, explicit_target: str | None, max_rounds: int, sample_every: int) -> dict[str, Any]:
    warnings: list[str] = []
    truncated: list[str] = []
    header = clean(dict(demo.header or {}))

    round_rows, cut = rows(demo.rounds, max_rounds)
    if cut:
        truncated.append("rounds")
    rounds = []
    for row in round_rows:
        rounds.append({
            "round_num": row.get("round_num"),
            "start_tick": row.get("start_tick"),
            "freeze_end_tick": row.get("freeze_end_tick"),
            "end_tick": row.get("end_tick"),
            "official_end_tick": row.get("official_end_tick"),
            "winner_side": row.get("winner_side"),
            "reason_name": row.get("reason_name"),
            "is_knife_round": bool(row.get("is_knife_round") or False),
        })
    if not rounds:
        warnings.append("the demo contains no completed rounds")
    index = RoundIndex(rounds)
    last_tick = max((r.get("official_end_tick") or r.get("end_tick") or 0) for r in rounds) if rounds else 0

    stats_rows, cut = rows(demo.stats, 64)
    if cut:
        truncated.append("stats")
    stats = []
    for row in stats_rows:
        sid = steamid(row.get("steamid"))
        if not sid:
            continue
        stats.append({"steamid": sid, **{k: v for k, v in row.items() if k != "steamid"}})

    target = pick_target(stats, explicit_target, warnings)

    kills_raw, cut = rows(demo.kills, MAX_KILLS)
    if cut:
        truncated.append("kills")
    kills = []
    for position, row in enumerate(kills_raw, start=1):
        tick = row.get("tick")
        if tick is not None and last_tick and tick > last_tick:
            continue
        kills.append({
            "event_id": f"kill_{position:04d}",
            "tick": tick,
            "round_num": index.at(tick),
            "attacker_steamid": steamid(row.get("attacker_steamid")),
            "attacker_name": row.get("attacker_name"),
            "attacker_side": row.get("attacker_side"),
            "attacker_x": row.get("attacker_x"),
            "attacker_y": row.get("attacker_y"),
            "victim_steamid": steamid(row.get("victim_steamid")),
            "victim_name": row.get("victim_name"),
            "victim_side": row.get("victim_side"),
            "victim_x": row.get("victim_x"),
            "victim_y": row.get("victim_y"),
            "assister_steamid": steamid(row.get("assister_steamid")),
            "weapon": row.get("weapon"),
            "headshot": bool(row.get("headshot") or False),
            "penetrated": bool(row.get("penetrated") or False),
            "noscope": bool(row.get("noscope") or False),
            "thrusmoke": bool(row.get("thrusmoke") or False),
            "is_trade": bool(row.get("is_trade") or False),
            "victim_traded": bool(row.get("victim_traded") or False),
            "hitgroup_name": row.get("hitgroup_name"),
        })

    damage_raw, cut = rows(demo.damages, MAX_DAMAGES)
    if cut:
        truncated.append("damages")
    damages = []
    for position, row in enumerate(damage_raw, start=1):
        damages.append({
            "event_id": f"hurt_{position:04d}",
            "tick": row.get("tick"),
            "round_num": index.at(row.get("tick")),
            "attacker_steamid": steamid(row.get("attacker_steamid")),
            "victim_steamid": steamid(row.get("victim_steamid")),
            "weapon": row.get("weapon"),
            "dmg_health": row.get("dmg_health"),
            "hitgroup_name": row.get("hitgroup_name"),
        })

    blind_raw, cut = rows(demo.blinds, MAX_BLINDS)
    if cut:
        truncated.append("blinds")
    blinds = []
    for position, row in enumerate(blind_raw, start=1):
        blinds.append({
            "event_id": f"blind_{position:04d}",
            "tick": row.get("tick"),
            "round_num": index.at(row.get("tick")),
            "attacker_steamid": steamid(row.get("attacker_steamid")),
            "attacker_name": row.get("attacker_name"),
            "attacker_side": row.get("attacker_side"),
            "victim_steamid": steamid(row.get("victim_steamid")),
            "victim_name": row.get("victim_name"),
            "victim_side": row.get("victim_side"),
            "duration": row.get("duration"),
        })

    bomb_raw, cut = rows(demo.bomb, MAX_BOMB)
    if cut:
        truncated.append("bomb")
    bomb = []
    for position, row in enumerate(bomb_raw, start=1):
        bomb.append({
            "event_id": f"bomb_{position:04d}",
            "tick": row.get("tick"),
            "round_num": index.at(row.get("tick")),
            "event": row.get("event"),
            "steamid": steamid(row.get("steamid")),
            "bombsite": row.get("bombsite"),
            "x": row.get("x"),
            "y": row.get("y"),
        })

    grenades = build_grenades(demo, index, truncated, warnings)
    smokes, cut = collect_utility(getattr(demo, "smokes", None), "smoke", index)
    if cut:
        truncated.append("smokes")
    fires, cut = collect_utility(getattr(demo, "fires", None), "fire", index)
    if cut:
        truncated.append("fires")

    economy_raw, cut = rows(demo.round_economy, 256)
    if cut:
        truncated.append("round_economy")
    round_economy = [
        {
            "round_num": row.get("round_num"),
            "side": row.get("side"),
            "equipment_value": row.get("equipment_value"),
            "buy_type": row.get("buy_type"),
            "n_players": row.get("n_players"),
        }
        for row in economy_raw
    ]

    target_samples: list[dict[str, Any]] = []
    death_snapshots: list[dict[str, Any]] = []
    if target:
        target_samples = collect_samples(demo, index, target, sample_every, truncated, warnings)
        death_ticks = {kill["tick"] for kill in kills
                       if kill["victim_steamid"] == target and kill["tick"] is not None}
        death_snapshots = collect_death_snapshots(demo, index, target, death_ticks, truncated)

    return {
        "header": header,
        "tick_rate": tick_rate(header, rounds),
        "rounds": rounds,
        "players": [
            {
                "steamid": steamid(row.get("steamid")),
                "name": row.get("name"),
                "side": row.get("side"),
                "team_clan_name": row.get("team_clan_name"),
            }
            for row in rows(demo.players, 64)[0]
            if steamid(row.get("steamid"))
        ],
        "stats": stats,
        "target_player_id": target,
        "kills": kills,
        "damages": damages,
        "blinds": blinds,
        "bomb": bomb,
        "grenades": grenades,
        "smokes": smokes,
        "fires": fires,
        "round_economy": round_economy,
        "target_samples": target_samples,
        "target_death_snapshots": death_snapshots,
        "truncated": truncated,
        "warnings": warnings,
    }


def collect_samples(demo: Any, index: RoundIndex, target: str, every: int,
                    truncated: list[str], warnings: list[str]) -> list[dict[str, Any]]:
    try:
        frame = demo.snapshots(every=max(8, int(every)))
    except Exception as error:  # pragma: no cover - demo dependent
        warnings.append(f"player samples unavailable: {error}")
        return []
    samples: list[dict[str, Any]] = []
    for row in frame.to_dicts():
        if steamid(row.get("steamid")) != target:
            continue
        tick = row.get("tick")
        samples.append({
            "tick": tick,
            "round_num": index.at(tick),
            "x": row.get("x"),
            "y": row.get("y"),
            "z": row.get("z"),
            "yaw": row.get("yaw"),
            "pitch": row.get("pitch"),
            "velocity": row.get("velocity"),
            "velocity_x": row.get("velocity_x"),
            "velocity_y": row.get("velocity_y"),
            "health": row.get("health"),
            "armor": row.get("armor"),
            "active_weapon": row.get("active_weapon"),
            "is_reloading": row.get("is_reloading"),
            "is_jumping": row.get("is_jumping"),
            "is_crouched": row.get("is_crouched"),
            "is_scoped": row.get("is_scoped"),
            "flashbangs": row.get("flashbangs"),
            "smoke_grenades": row.get("smoke_grenades"),
            "he_grenades": row.get("he_grenades"),
            "fire_grenades": row.get("fire_grenades"),
            "equipment_value": row.get("equipment_value"),
            "money": row.get("money"),
        })
        if len(samples) >= 40000:
            truncated.append("target_samples")
            break
    return samples


def collect_death_snapshots(demo: Any, index: RoundIndex, target: str, death_ticks: set[int],
                            truncated: list[str]) -> list[dict[str, Any]]:
    """State of the target one tick before each of the target's own deaths.

    A dead pawn is dropped from `snapshots(events="player_death")`, and that call
    returns every *living* player at every death tick. Sampling `tick - 1` for the
    target's own death ticks is the reliable way to keep the weapon, reload state
    and grenade inventory that were actually held when the player died.
    """
    ticks = sorted(tick for tick in death_ticks if isinstance(tick, int) and tick > 1)
    if not ticks or len(ticks) > 400:
        if len(ticks) > 400:
            truncated.append("target_death_snapshots")
        ticks = ticks[:400]
    if not ticks:
        return []
    try:
        frame = demo.snapshots(ticks=[tick - 1 for tick in ticks])
    except Exception:  # pragma: no cover - demo dependent
        return []
    by_tick: dict[Any, dict[str, Any]] = {}
    for row in frame.to_dicts():
        if steamid(row.get("steamid")) != target:
            continue
        by_tick[row.get("tick")] = row
    snapshots: list[dict[str, Any]] = []
    for death_tick in ticks:
        row = by_tick.get(death_tick - 1)
        if not row:
            continue
        inventory = row.get("inventory")
        if isinstance(inventory, str) and len(inventory) > MAX_INVENTORY:
            inventory = inventory[:MAX_INVENTORY]
        snapshots.append({
            "event_id": f"death_{len(snapshots) + 1:04d}",
            "tick": death_tick,
            "round_num": index.at(death_tick),
            "x": row.get("x"),
            "y": row.get("y"),
            "z": row.get("z"),
            "yaw": row.get("yaw"),
            "health": row.get("health"),
            "armor": row.get("armor"),
            "active_weapon": row.get("active_weapon"),
            "is_reloading": row.get("is_reloading"),
            "flashbangs": row.get("flashbangs"),
            "smoke_grenades": row.get("smoke_grenades"),
            "he_grenades": row.get("he_grenades"),
            "fire_grenades": row.get("fire_grenades"),
            "inventory": inventory,
            "is_scoped": row.get("is_scoped"),
            "equipment_value": row.get("equipment_value"),
            "sampled_tick": row.get("tick"),
        })
    return snapshots


def build_grenades(demo: Any, index: RoundIndex, truncated: list[str],
                   warnings: list[str]) -> list[dict[str, Any]]:
    try:
        frame = demo.grenades
    except Exception as error:  # pragma: no cover - demo dependent
        warnings.append(f"grenade trajectories unavailable: {error}")
        return []
    grouped: dict[tuple[Any, Any], dict[str, Any]] = {}
    order: list[tuple[Any, Any]] = []
    for row in frame.to_dicts():
        key = (row.get("entity_id"), row.get("entity_serial"))
        if key not in grouped:
            grouped[key] = {
                "thrower_steamid": steamid(row.get("thrower_steamid")),
                "type": row.get("type"),
                "points": [],
                "point_ticks": [],
                "start_tick": row.get("tick"),
            }
            order.append(key)
        entry = grouped[key]
        if not entry["thrower_steamid"]:
            entry["thrower_steamid"] = steamid(row.get("thrower_steamid"))
        entry["points"].append([row.get("x"), row.get("y"), row.get("z")])
        entry["point_ticks"].append(row.get("tick"))

    grenades: list[dict[str, Any]] = []
    for key in order:
        entry = grouped[key]
        points, ticks = downsample(entry["points"], entry["point_ticks"])
        start = entry["start_tick"]
        grenades.append({
            "event_id": f"grenade_{len(grenades) + 1:04d}",
            "tick": start,
            "round_num": index.at(start),
            "type": entry["type"],
            "thrower_steamid": entry["thrower_steamid"],
            "points": points,
            "point_ticks": ticks,
        })
        if len(grenades) >= MAX_GRENADES:
            truncated.append("grenades")
            break
    return grenades


def downsample(points: list[list[Any]], ticks: list[Any]) -> tuple[list[list[Any]], list[Any]]:
    total = len(points)
    if total <= MAX_GRENADE_POINTS:
        return points, ticks
    stride = math.ceil(total / MAX_GRENADE_POINTS)
    picked = list(range(0, total, stride))
    if picked[-1] != total - 1:
        picked.append(total - 1)
    return [points[i] for i in picked], [ticks[i] for i in picked]


def collect_utility(frame: Any, kind: str, index: RoundIndex) -> tuple[list[dict[str, Any]], bool]:
    rows_out, cut = rows(frame, MAX_UTILITY_ROWS)
    items = []
    for position, row in enumerate(rows_out, start=1):
        items.append({
            "event_id": f"{kind}_{position:04d}",
            "kind": kind,
            "start_tick": row.get("start_tick"),
            "end_tick": row.get("end_tick"),
            "round_num": index.at(row.get("start_tick")),
            "thrower_steamid": steamid(row.get("thrower_steamid")),
            "thrower_side": row.get("thrower_side"),
            "type": row.get("type"),
            "x": row.get("x"),
            "y": row.get("y"),
            "z": row.get("z"),
        })
    return items, cut


def file_sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Parse a CS2 demo into analysis JSON")
    parser.add_argument("--input", required=False)
    parser.add_argument("--output", required=False)
    parser.add_argument("--target-player", default=None)
    parser.add_argument("--max-rounds", type=int, default=DEFAULT_MAX_ROUNDS)
    parser.add_argument("--sample-every", type=int, default=DEFAULT_SAMPLE_EVERY)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(list(argv) if argv is not None else None)

    if args.check:
        try:
            import awpy
            import polars
        except ModuleNotFoundError as error:
            fail(3, f"awpy is not installed: {error}")
        print(json.dumps({"ok": True, "awpy": getattr(awpy, "__version__", "unknown"),
                          "polars": getattr(polars, "__version__", "unknown")}))
        return 0

    if not args.input or not args.output:
        fail(2, "--input and --output are required")

    started = time.time()
    demo = load_demo(args.input)
    payload = collect(demo, args.target_player or None, max(1, args.max_rounds), max(8, args.sample_every))

    result = {
        "schema_version": SCHEMA_VERSION,
        "parser": {
            "name": "awpy",
            "version": getattr(sys.modules.get("awpy"), "__version__", "unknown"),
            "python": sys.version.split()[0],
            "elapsed_ms": round((time.time() - started) * 1000),
        },
        "demo": {
            "file_name": os.path.basename(args.input),
            "size_bytes": os.path.getsize(args.input),
            "sha256": file_sha256(args.input),
        },
        **payload,
    }

    tmp = args.output + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(result, handle, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, args.output)
    print(json.dumps({"ok": True, "output": args.output, "bytes": os.path.getsize(args.output),
                      "elapsed_ms": result["parser"]["elapsed_ms"]}))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as error:  # pragma: no cover - defensive
        traceback.print_exc()
        fail(4, f"{type(error).__name__}: {error}")
