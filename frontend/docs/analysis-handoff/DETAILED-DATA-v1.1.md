# 选定玩家的基础数据协议 1.1.0

当前本机工具版本 0.2.0；五个文件仍为 manifest.json、metrics.json、rounds.json、events.json、map.json。新增详情采用 **schema_version=1.1.0**，契约见 package-v1.1.schema.json。旧 package.schema.json 和旧模拟样例保留为 1.0.0；后端不能拿旧版严格 Schema 直接接收新版。

## 明确分析对象

前端输入昵称或 SteamID → 读取真实名单 → 匹配候选 → 显示昵称及 SteamID → 用户勾选确认 → 开始详细提取。昵称使用 NFKC、去首尾空白和大小写折叠查找；SteamID 为固定对象，重名不自动选择第一人。选中了名单中的玩家不等于验证了该 Steam 账号所有权。

manifest.analysis_scope 包含 target_player_id、target_player_name、nickname_query、identity_confirmation=user_confirmed_roster_selection、identity_verified=false、scope=target_player_and_related_context。

只保留目标玩家的完整时序、交火关键状态和基础统计。相关受害者/攻击者/助攻者/物品原拥有者的身份、位置和状态会保留；全局击杀与炸弹事件作为低数量回合上下文保留。其他人的全部开火、伤害、物品流水和完整时序不会导出。

awpy 仍需底层扫描 Demo，部分数据集和内置统计暂不支持按 SteamID 解码；本次优化发生在扫描后的过滤、Python 对象转换、采样和导出，不承诺总解析耗时降低十倍。缓存按源文件摘要、适配器版本和目标 SteamID 分开。

## manifest.json：身份、版本和质量

除原有比赛、玩家名单、文件 SHA-256 和大小外，新增 analysis_scope、units、data_quality。

data_quality.dataset_coverage 逐个数据集记录 status=available/empty、source_rows（awpy 原数据集行数）、retained_source_rows（过滤后用于导出的源行数）。轨迹会再次采样，最终点数请读取 map；这个计数不等于事件总数。空数据集不证明游戏内没有发生过对应行为。

data_quality.sampling 记录周期、交火偏移、附近人物的距离/数量限制和 visibility=not_evaluated。warnings 记录缺失、归属未知和尚未计算的项目。

SteamID 一律为字符串，包括嵌套的原始 record/state；entity_id、entity_serial 和 tick 保持整数。null 表示未知，不补零。比赛真实开始时间未知时仍为 null；已记录比分不自动代表确认了完整比赛。

## metrics.json：基础统计及可核对的表格

- modules：基础表现、闪光效果、死亡状态等已有模块，保留版本、有效样本、状态和证据引用。
- source_player_stats：只保存目标玩家的 awpy 内置数值统计，包括闪光助攻、爆头击杀、被补枪死亡、双杀到五杀、残局参与/获胜、1v1–1v5 获胜、道具伤害、闪光等可获得字段。定义随 awpy 3.1.1 记录。
- tables.per_round：每回合 K/D/A、开火事件数、造成/受到伤害事件数及原始健康伤害和、观察到的购买次数和费用。
- tables.by_weapon：按去掉 weapon_ 前缀的武器名聚合开火事件、击杀/死亡、造成/受到伤害事件及原始伤害总量。事件保留未改动的原武器名。
- definitions：说明这些数量的计算口径。开火事件可能包括刀或道具，不能直接当作子弹数计算命中率；dmg_health 是源数据，不是另造 ADR 公式；购买来自重建事件，不保证等于净支出。

未提供虚构的综合 Rating、道具正确率或人类反应时间。

## rounds.json：回合上下文

每回合保留原回合号、start_tick、freeze_end_tick、end_tick、official_end_tick、winner_team_id、winner_side、end_reason。

target_start_state 是冻结结束时目标玩家快照，target_end_state 是结束前一个 tick 快照；如果玩家已死亡或状态缺失，保留 null，不推断成存活。team_economy 保留双方阵营的装备价值、购买档位和人数。target_summary 对应该回合的目标玩家统计。

固定队伍身份与 T/CT 阵营分开，换边后不交换比赛队伍编号。分段录制、掉线或重组造成的归属不确定仍应显示未知。

## events.json：基础事件与关联对象

每条事件包含 event_id、type、tick、time_seconds、round_num、round_elapsed_seconds、live_elapsed_seconds、data。

time_seconds 从 Demo tick 0 开始；round_elapsed_seconds 从回合 start_tick 开始；live_elapsed_seconds 从 freeze_end_tick 开始，在冻结期可为负。它们不是现实钟表时间。

data.record 保留 awpy 源字段；data.source_dataset 标明来源；target_roles 可为 actor、attacker、victim、assister、original_owner、thrower；scope 标明 target_related、round_context 或 unattributed_context。

| type | 保留范围与基础字段 |
| --- | --- |
| kill | 全局低数量回合上下文；双方及助攻者 SteamID、昵称、阵营、坐标，武器、爆头、穿烟、穿透、不开镜、交易击杀标记等 |
| damage | 目标造成或受到的伤害；双方身份/坐标、武器、命中部位、健康和护甲伤害、命中前后生命/护甲 |
| weapon_fire | 仅目标玩家；tick、武器、坐标、pitch/yaw、开镜、inaccuracy、剩余弹药等源字段 |
| blind | 目标闪别人或被别人闪；攻击者和受闪者身份/阵营/坐标、致盲秒数；保留队友、自闪和敌人 |
| item_transaction | 目标的购买/捡起/丢弃，或物品原拥有者为目标；物品名、费用、原拥有者、位置、是否接近购买区等 |
| bomb_action | 全局炸弹拾取、丢弃、下包、拆包等；操作者、点位、tick、坐标 |
| smoke_cloud / fire_area | 目标或未知归属烟火的存续时间和位置；不把未知投掷者猜成目标 |
| grenade / grenade_context | 已知归属或未知归属的轨迹索引；对应 map 中的轨迹 |
| death_context / flash_effect | 旧模块的精简依据，便于沿用 evidence_ids；可能与原始记录描述同一件事，统计时不可跨 type 简单相加 |

每条原始记录只在对应数据集中导出一次。一个子弹可能造成多条伤害记录，不能把 damage 条数视为命中子弹数。源字段缺失不补造。

## map.json：状态和轨迹，供后端继续分析

| 字段 | 内容 |
| --- | --- |
| player_samples | 目标玩家每 0.5 秒一帧，实际周期 tick 数写入 sampling；仅包含记录中可取得的活动玩家状态 |
| target_keyframes | 与目标有关的击杀/伤害/开火 tick 的 -1、0、+1，以及冻结结束和回合结束前一 tick 的状态 |
| combat_participant_states | 上述交火时间点的关联攻击者/受害者/助攻者状态，非其他人的完整时序 |
| nearby_context | 定时帧中距离目标 800 世界单位以内，最多最近 6 人的身份、阵营、坐标、生命和距离 |
| trajectories | 可确认投掷者为目标的轨迹，包含 entity_id/serial、起止 tick、points、point_ticks、sample_stride_rows |
| unattributed_trajectories | 无法归属玩家的轨迹，同样保留点和时间，thrower_player_id=null，仅作上下文 |

state 保留 awpy 快照字段：位置、三轴速度/速度、pitch/yaw、生命、护甲、头盔、拆弹器、炸弹、主副武器/当前武器、道具数量、完整 inventory、装备价值、回合开始装备价值、金钱、蹲/静步/跳跃、开镜、换弹、受闪、拆包、炸弹区、flash_duration 等。inventory 是 awpy 原始逗号分隔物品字符串，未静默改成其他数据类型。

每条轨迹最多约 200 个点，保留真实 point_ticks，不假设相邻点间隔固定。坐标为 Source 世界坐标，Z 向上；角度为度；时间为秒；伤害为源事件生命/护甲点。

**附近或同帧出现不等于玩家看到了对方。** 没有 FOV、静态/动态遮挡和烟雾验证，不能据这些 0.5 秒样本声称测出了真实反应时间。不存在快照的 tick 不补插值，不拿死亡前状态冒充回合结束状态。

## 本机接口变化

1. POST /local/jobs：原始 Demo 字节。只读取名单/回合，不做所有玩家的详细分析。
2. GET /local/jobs/{job_id}：名单、地图、回合和进度；初次返回 stats=[]。
3. **POST /local/jobs/{job_id}/exports**：JSON `{target_player_id,nickname_query,identity_confirmed:true}`。服务器核对 SteamID 在当前名单中，拒绝未确认请求。返回 202 `{job_id}`。
4. 继续 GET 同一 job 查询提取、采样、算法和打包阶段；完成时 stage=exported，active_target_player_id 必须与确认对象相同，并返回 summary。
5. GET /local/jobs/{job_id}/package?target_player_id=…：仅下载已完成的 ZIP；GET 不再启动耗时计算。

新的源字段需要升级 adapter_version，使旧目标缓存失效。每次重新导出创建新的 package_id；match_id 随源文件稳定。旧 1.0.0 模拟流程和云端报告协议保持原样，后端组应先实现 1.1.0 ZIP 的导入与基础事实分析，再设计评分。
