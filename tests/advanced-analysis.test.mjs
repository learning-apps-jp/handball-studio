import test from 'node:test';
import assert from 'node:assert/strict';
import {filterAdvancedEvents,summarizeAdvanced,selectAnalysisMatches,combinePlayerIds,setTournamentForMatches} from '../js/advanced-analysis.mjs';

const event=(id,teamId,type,extra={})=>({id,teamId,type,period:1,playerId:teamId==='a'?'p1':'q1',...extra});
function fixture(){return [{id:'m1',homeTeamId:'a',awayTeamId:'b',tournament:'cup',coverage:{shots:true,goalkeeping:true},events:[
  event('1','a','shot',{result:'goal',shotType:'wing',zone:1,goalkeeperId:'qg'}),
  event('2','a','shot',{result:'miss',period:2,playerId:'p2',sevenMeter:true}),
  event('3','a','turnover',{missType:'パスミス'}),event('4','a','seven_meter_awarded'),
  event('5','a','score_adjustment',{delta:5}),event('6','a','shot',{result:'goal',deleted:true}),
  event('7','b','shot',{result:'saved',zone:1,goalkeeperId:'pg'}),
  event('8','b','shot',{result:'goal',zone:1,goalkeeperId:'pg',sevenMeter:true}),
  event('9','b','shot',{result:'goal',zone:2,emptyNet:true}),
  event('10','b','shot',{result:'post',zone:1,goalkeeperId:'pg'}),
  event('11','b','shot',{result:'goal',goalkeeperId:'pg',period:3})
]},{id:'m2',homeTeamId:'a',awayTeamId:'c',tournament:'league',coverage:{shots:false,goalkeeping:false},events:[event('12','a','shot',{result:'goal',playerId:'p2'})]}];}

test('match selection honors target side, arbitrary empty selection and tournament',()=>{
  const matches=fixture();assert.equal(selectAnalysisMatches(matches,'a').length,2);assert.equal(selectAnalysisMatches(matches,'a',{matchIds:[]}).length,0);assert.equal(selectAnalysisMatches(matches,'b').length,1);assert.deepEqual(selectAnalysisMatches(matches,'a',{tournament:'cup'}).map(m=>m.id),['m1']);
});
test('score adjustments and tombstones never enter efficiency or shots',()=>{
  const r=summarizeAdvanced(fixture(),'a',{matchIds:['m1']});assert.equal(r.goals,1);assert.equal(r.shots,2);assert.equal(r.turnovers,1);assert.equal(r.sevenMeterAwarded,1);assert.equal(r.shotRate,50);assert.ok(Math.abs(r.estimatedEfficiency-100/3)<1e-10);assert.deepEqual(r.missTypes,[{name:'パスミス',count:1}]);
});
test('GK normal and 7m zones exclude empty goals and off-target shots from save denominator',()=>{
  const r=summarizeAdvanced(fixture(),'a',{matchIds:['m1']});assert.equal(r.saves,1);assert.equal(r.conceded,2);assert.equal(r.emptyNetShots,1);assert.equal(r.gkZones[0].cells[0].rate,100);assert.equal(r.gkZones[0].cells[0].shots,2);assert.equal(r.gkZones[0].unknownZone,1);assert.equal(r.gkZones[1].cells[0].rate,0);
});
test('incomplete match hides rates without dropping observed counts',()=>{
  const r=summarizeAdvanced(fixture(),'a');assert.equal(r.goals,2);assert.equal(r.shotRate,null);assert.equal(r.saveRate,null);assert.equal(r.estimatedEfficiency,null);assert.equal(r.gkZones[0].cells[0].rate,null);
});
test('period, player aliases, shot type, GK, 7m and empty-net filters use explicit event semantics',()=>{
  const m=fixture();assert.equal(summarizeAdvanced(m,'a',{period:'2'}).shots,1);assert.equal(summarizeAdvanced(m,'a',{period:'extra'}).conceded,1);
  assert.equal(summarizeAdvanced(m,'a',{playerIds:['p1','p2']}).shots,3);assert.equal(summarizeAdvanced(m,'a',{playerIds:['pg']}).saves,1);assert.equal(summarizeAdvanced(m,'a',{shotType:'wing'}).shots,1);
  const seven=filterAdvancedEvents(m,'a',{sevenMeter:'only'});assert.equal(seven.own.length,1);assert.equal(seven.opponent.length,1);
  assert.equal(summarizeAdvanced(m,'a',{goalkeeperId:'pg'}).conceded,2);assert.equal(summarizeAdvanced(m,'a',{emptyNet:'only'}).conceded,0);assert.equal(summarizeAdvanced(m,'a',{emptyNet:'only'}).emptyNetShots,1);
});
test('group unions deduplicate ids and tournament assignment is immutable and selected only',()=>{
  assert.deepEqual(combinePlayerIds([{id:'g1',playerIds:['p1','p2']},{id:'g2',playerIds:['p2','p3']}],['g1','g2']),['p1','p2','p3']);
  const m=fixture(),copy=structuredClone(m),changed=setTournamentForMatches(m,['m1'],' new cup ');assert.equal(changed[0].tournament,'new cup');assert.strictEqual(changed[1],m[1]);assert.deepEqual(m,copy);assert.equal(setTournamentForMatches(m,['m1'],'')[0].tournament,'');assert.throws(()=>setTournamentForMatches(m,['m1'],'x'.repeat(101)));
});

test('unmarked filter computes the observed nomark shot rate without altering other types',()=>{const matches=fixture();matches[0].events.push(event('u1','a','shot',{result:'goal',shotType:'unmarked',ballType:'バウンド',rebound:true}),event('u2','a','shot',{result:'saved',shotType:'unmarked',ballType:'通常',rebound:false}));const result=summarizeAdvanced(matches,'a',{matchIds:['m1'],shotType:'unmarked'});assert.equal(result.shots,2);assert.equal(result.goals,1);assert.equal(result.shotRate,50);assert.equal(summarizeAdvanced(matches,'a',{matchIds:['m1'],shotType:'wing'}).shotRate,100);});
