const test=require('node:test'),assert=require('node:assert/strict');
const {normalize}=require('../src/services/demoAnalysis');
const {build,TARGET}=require('./fixtures/demo-parse-sample');
test('cloud AI facts retain effective flash policy and distinguish TK',()=>{
 const p=build();p.kills.push({...p.kills[0],event_id:'tk_policy',attacker_steamid:p.target_player_id,victim_steamid:'76561198000000002',attacker_side:'terrorist',victim_side:'terrorist'});
 p.blinds.push({...p.blinds[0],event_id:'micro_policy',attacker_steamid:p.target_player_id,victim_steamid:'76561198000000002',attacker_side:'terrorist',victim_side:'terrorist',duration:0.1});
 const r=normalize(p,{analysisId:'compatibility-test'}).details;
 assert.ok(r.findings.some(f=>f.rule_id==='team_kill' && f.evidence_ids.includes('tk_policy')));
 assert.ok(!r.findings.some(f=>f.evidence_ids.includes('micro_policy')));
 assert.equal(r.statistics.modules.utility.metrics.team_flashes,r.statistics.modules.utility.metrics.teammates_blinded);
 assert.equal(r.statistics.modules.basic_stats.metrics.team_kills,1);
 assert.ok(r.rounds.every(row=>Object.hasOwn(row,'freeze_end_tick')));
});
test('perspective choices exclude accounts with no player statistics',()=>{
 const p=build();p.players.push({steamid:'76561198099999999',name:'Spectator'});
 const r=normalize(p,{analysisId:'roster-test'}).details;
 assert.ok(!r.players.some(player=>player.name==='Spectator'));
});
