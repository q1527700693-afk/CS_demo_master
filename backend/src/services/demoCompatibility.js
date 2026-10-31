 'use strict';
const {applyCombatFacts, relation, MIN_BLIND_SECONDS} = require('./combatFacts');
function upgradeDemoAnalysis(details, payload, events) {
  const target = details.target_player_id;
  const records = events.map(e => ({...e, data: {record: e.data}}));
  const sourceRounds = new Map(payload.rounds.map(r => [r.round_num,r]));
  for (const e of events) { const r = sourceRounds.get(e.round_num); e.live_elapsed_seconds = r?.freeze_end_tick != null && Number.isFinite(e.tick) ? (e.tick-r.freeze_end_tick)/(payload.tick_rate || 64) : null }
  records.forEach((e,i) => e.live_elapsed_seconds = events[i].live_elapsed_seconds);
  const perRound = details.rounds.map(r => ({round_num:r.round_num, kills:r.target.kills, deaths:r.target.deaths, raw_health_damage_dealt:r.target.damage}));
  const weapons = new Map();
  for (const e of records) {
    const r = e.data.record, weapon = String(r.weapon || '').replace(/^weapon_/, '');
    if (!weapon || ![r.attacker_steamid,r.victim_steamid].includes(target)) continue;
    if (!weapons.has(weapon)) weapons.set(weapon,{weapon,kills:0,deaths:0,raw_health_damage_dealt:0,raw_health_damage_received:0});
    const row = weapons.get(weapon);
    if (e.type === 'kill' && r.victim_steamid === target) row.deaths++;
    if (e.type === 'damage') {
      if (r.attacker_steamid === target) row.raw_health_damage_dealt += Math.max(0,Number(r.dmg_health)||0);
      if (r.victim_steamid === target) row.raw_health_damage_received += Math.max(0,Number(r.dmg_health)||0);
    }
  }
  details.statistics.tables = {per_round:perRound,by_weapon:[...weapons.values()]};
  for (const r of details.rounds) {
    const source = sourceRounds.get(r.round_num);
    r.start_tick = source?.start_tick ?? null; r.freeze_end_tick = source?.freeze_end_tick ?? null; r.end_tick = source?.end_tick ?? null;
    const sample = payload.target_samples.find(s => s.round_num === r.round_num && s.side);
    const combat = records.find(e => e.round_num === r.round_num && e.data.record.attacker_steamid === target && e.data.record.attacker_side || e.round_num === r.round_num && e.data.record.victim_steamid === target && e.data.record.victim_side);
    const rec = combat?.data.record;
    r.target_side = sample?.side || (rec?.attacker_steamid === target ? rec.attacker_side : rec?.victim_side) || null;
    r.target_summary = perRound.find(s => s.round_num === r.round_num);
  }
  applyCombatFacts(details.statistics,details.rounds,records,target);
  const basic = details.statistics.modules.basic_stats?.metrics;
  if (basic) { basic.kd_ratio = basic.kills / Math.max(1,basic.deaths || 0); basic.headshot_kills = records.filter(e=>e.type==='kill' && e.data.record.attacker_steamid===target && relation(e.data.record)==='enemy' && e.data.record.headshot===true).length; }
  const utility = details.statistics.modules.utility?.metrics;
  if (utility) { utility.enemies_flashed = utility.enemies_blinded ?? null; utility.flash_duration_dealt = utility.enemy_blind_seconds ?? null; utility.self_flashes = utility.self_blinds ?? null; utility.team_flashes = utility.teammates_blinded ?? null; }

  const byId = new Map(events.map(e => [e.event_id,e]));
  details.findings = details.findings.filter(f => !['team_flash','self_flash'].includes(f.rule_id) || f.evidence_ids.some(id => Number(byId.get(id)?.data.duration) >= MIN_BLIND_SECONDS));
  for (const e of records) if (e.type === 'kill' && relation(e.data.record) === 'team' && [e.data.record.attacker_steamid,e.data.record.victim_steamid].includes(target)) details.findings.push({finding_id:`team_kill:${e.event_id}`,rule_id:'team_kill',rule_version:'demo-rules-1.1.0',round_num:e.round_num,tick:e.tick,live_elapsed_seconds:e.live_elapsed_seconds,evidence_ids:[e.event_id],observation:`${e.data.record.attacker_name || '队友'} 误杀 ${e.data.record.victim_name || '队友'}`,review_prompt:'回看交火路线、队友位置与开火时机。',classification:'review_candidate'});
  const known = new Set(payload.stats.map(s => s.steamid));
  details.players = payload.players.filter(p => known.has(p.steamid));
  details.map = {counts:{player_samples:payload.target_samples.length, all_player_samples:payload.all_player_samples?.length || 0, trajectories:payload.grenades.length}};
  details.replay_version = '1.2.1';
}
module.exports = {upgradeDemoAnalysis};
