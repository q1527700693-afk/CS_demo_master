# 全员导出协议 1.2.0（后端交接）

本次仅修改本地解析与 ZIP 导出。前端、云端后端不修改。ZIP 仍为 manifest、metrics、rounds、events、map 五个 JSON 文件；所有文件 schema_version 为 1.2.0，adapter_version 为 2.1.0。旧缓存自动失效，无需删除原 Demo。

## 新增字段

| 文件／字段 | 内容 |
|---|---|
| manifest.export_scope | 全员导出范围、全局源数据覆盖计数、位置采样频率、道具归属规则 |
| map.all_player_samples | 全部玩家按 0.5 秒间隔的状态，格式 `{tick,time_seconds,round_num,state}`；state 保留 awpy 提供的位置、朝向、血量、阵营、武器、库存等原始字段 |
| map.global_sampling | 真实 tick 间隔、秒间隔、全知视角说明和回合范围 |
| map.all_trajectories | 全部道具，按 entity_id + entity_serial 分组；包含 type、thrower_player_id、ownership、start_tick、end_tick、points、point_ticks、records |
| events.global_items | 全场 kill、damage、weapon_fire、blind、item_transaction、bomb_action、smoke_cloud、fire_area 事件；data.record 保留原始字段 |
| events.global_coverage | 各数据集 source_rows 与 retained_source_rows，便于核对覆盖范围 |
| metrics.all_player_stats | 全员 awpy 原始统计 |

每条轨迹保留所有源行，不再抽稀到最多 200 点；points、point_ticks、records 一一对齐。records 保留每个点的原始属性，包括源投掷者信息。投掷者缺失时为 null；同一实体有冲突归属时 ownership 为 conflicting，不按距离猜测。坐标缺失仍为 null，不补零。所有 SteamID 为字符串，禁止转 JS Number。

## 兼容字段

原有 events.items、map.player_samples、target_keyframes、combat_participant_states、nearby_context、trajectories、unattributed_trajectories、metrics.modules、metrics.tables 和目标玩家报告逻辑保持原意。manifest.analysis_scope 描述单人分析；新增 export_scope 描述全员原始数据，二者不能混淆。后端新增全员展示时使用 global_items / all_player_samples / all_trajectories，不要将新旧流合并累加。

## 覆盖边界

“全员／全场”指 Demo 中记录的非刀局有效回合（start_tick 到 end_tick，含冻结时间）。沿用原有回合过滤；不导出热身和回合外数据。位置为每 0.5 秒采样，不是逐 tick 连续位置；保留死亡和观战等源状态，由使用方判断是否显示。缺失帧不插值。道具轨迹保留解析器提供的所有点，不能补出 Demo 或解析器缺失的投掷者。烟火持续区间、闪光受影响者／时长、物品交易、道具伤害位于 global_items 的对应源记录中。

## 后端接入要求

现有后端仅接受 schema 1.1.0，且 ZIP 展开上限为 50 MiB，不能直接接收本版文件。需由后端维护者扩展版本校验、字段存储／读取及大小限制。本地展开上限改为 256 MiB，超过时明确失败，不静默删减。压缩包上传限制、解压防护及资源预算由后端另行评估。前端当前仍显示单人字段，本次不接入全员可视化。

验证命令（项目根目录）：

```powershell
backend_service/parser/.venv/Scripts/python.exe -m unittest discover -s local_parser -p 'test_*.py' -v
backend_service/parser/.venv/Scripts/python.exe local_parser/verify_export.py <新版ZIP路径>
```
