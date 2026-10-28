# CS Demo Master Parser

把 CS2 `.dem` 文件解析成后端可消费的 JSON（契约 `demo-parse-1.0.0`）。这是唯一接触 Source 2 二进制格式的组件，基于 [awpy](https://awpy.readthedocs.io/)。

后端通过 `backend/src/services/demoParser.js` 以子进程方式调用本脚本；也可以脱离后端单独运行来排查问题。

> 分工：解析器只抽取事实，不做规则判断、不打分、不调用大模型。规则与报告在 `backend/src/services/demoAnalysis.js`。

## 依赖

- Python **3.11+**（awpy 3.x 要求）
- `awpy`（自带 CS2 Demo 解码器，轮子安装不需要 Rust 工具链）
- 不需要联网解析：从本地 `.dem` 读取。只有 awpy 的可视化/地图资源才需要下载。

```bash
# 推荐：仓库内虚拟环境（后端会自动探测 parser/.venv）
python -m venv .venv
.venv/Scripts/python.exe -m pip install awpy      # Windows
.venv/bin/python -m pip install awpy             # macOS / Linux

# 或者装到任意解释器，然后告诉后端用哪个
export DEMO_PARSER_PYTHON=/usr/bin/python3
```

没有虚拟环境权限时，也可以把依赖解压到目录并用 `PYTHONPATH` 指定：

```bash
python -m pip install --target .pydeps awpy
export DEMO_PARSER_PYTHONPATH=$PWD/.pydeps
```

## 用法

```bash
python parse_demo.py --input match.dem --output parse.json
python parse_demo.py --input match.dem --output parse.json --target-player 76561198000000001
python parse_demo.py --check          # 只验证 awpy 可用，打印版本
```

| 参数 | 说明 |
| --- | --- |
| `--input` | `.dem` 路径，必填 |
| `--output` | 输出 JSON 路径，必填（原子写入：先写 `.tmp` 再改名） |
| `--target-player` | 目标玩家 SteamID64；缺省取全场击杀最多者 |
| `--max-rounds` | 最多保留回合数，默认 60 |
| `--sample-every` | 位置采样步长（tick），默认 32（0.5 秒） |
| `--check` | 仅检查依赖，成功时输出 `{"ok":true,"awpy":"…","polars":"…"}` |

退出码：`0` 成功；`2` 文件不可读或不是合法 Demo；`3` awpy 未安装；`4` 解析失败。错误信息以 JSON 写到 stderr：`{"error":{"code":"…","message":"…"}}`，后端据此映射 HTTP 状态。

## 输出契约

单文件 JSON，`schema_version` 固定为 `demo-parse-1.0.0`。字段说明与设计取舍见
[docs/ai-demo-analysis-design.md](../docs/ai-demo-analysis-design.md) 第 4 节。概要：

```text
parser, demo{file_name,size_bytes,sha256}, header, tick_rate,
players[], stats[], rounds[], target_player_id,
kills[], damages[], blinds[], bomb[], grenades[], smokes[], fires[],
round_economy[], target_samples[], target_death_snapshots[],
truncated[], warnings[]
```

每个事件都带 `event_id`（`kill_0001`、`hurt_0001`、`blind_0001`、`grenade_0001`、
`smoke_0001`、`fire_0001`、`bomb_0001`、`death_0001`）、`tick`、`round_num`，后端用
它们作为证据 ID 与 AI 引用白名单。

## 实现要点

- **死亡快照取 `tick-1`**：`snapshots(events="player_death")` 只返回存活玩家，且每个死亡 tick 返回全部存活者。只有按目标玩家自己的死亡 tick 取前一个 tick，才能得到「死时手持武器/是否换弹/还剩几颗道具」。
- **速度靠位置差推导**：`snapshots` 里 `velocity_x/y` 经常为 `null`，后端用相邻采样点与 tick 差计算水平速度。
- **投掷者缺失是常态**：公开 Demo 中烟雾/燃烧的 `thrower_steamid` 常为 `null`，这类轨迹标记为未知归属，只作上下文。
- **体积上限**：回合 60、击杀 5000、伤害 20000、闪光 5000、炸弹 2000、投掷物 4000、单条轨迹最多 240 个点（自动均匀降采样）、目标采样 40000。触发上限会写进 `truncated`。
- **文本编码**：输出固定 UTF-8（`ensure_ascii=False`），Windows 下脚本内部设置 `PYTHONIOENCODING`/`PYTHONUTF8`，玩家名中的中文/俄文不会乱码。

## 性能参考

本地一次真实解析（Windows / Python 3.13 / awpy 3.1.1，60 MB、10 回合的 `de_mirage` Demo）：

| 阶段 | 耗时 |
| --- | --- |
| 打开 + header | < 0.1 s |
| rounds / stats / kills / damages | < 0.4 s |
| grenades（20k 行聚合） | ~0.4 s |
| snapshots（0.5 秒采样，18k 行） | < 0.1 s |
| 全程（含写 1.4 MB JSON） | **~2.3 s** |

## 排错

| 现象 | 处理 |
| --- | --- |
| `ModuleNotFoundError: awpy` | 安装 awpy，或设置 `DEMO_PARSER_PYTHON` / `DEMO_PARSER_PYTHONPATH` |
| `invalid demo file` | 文件不是 CS2 Demo（`PBDEMS2`）或被截断 |
| 中文玩家名乱码 | 设置 `PYTHONUTF8=1`，或直接看后端产物（已强制 UTF-8） |
| 轨迹/烟雾没有投掷者 | Demo 本身缺失归属，属正常降级，会体现在 `data_limitations` |
