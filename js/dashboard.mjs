import {activeEvents,summarize} from './core.mjs';

export function matchesForTeam(matches,teamId){return matches.filter(m=>m.homeTeamId===teamId||m.awayTeamId===teamId);}

export function dashboardModel(state,teamId){
  const matches=matchesForTeam(state.matches,teamId);
  const recent=[...matches].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,4);
  const totals=summarize(matches,teamId);
  const wins=matches.filter(m=>m.finished&&summarize([m],teamId).goals>summarize([m],m.homeTeamId===teamId?m.awayTeamId:m.homeTeamId).goals).length;
  return {matches,recent,totals,wins};
}

export function attackPhaseModel(matches,teamId){
  const selected=matchesForTeam(matches,teamId);
  const complete=selected.length>0&&selected.every(m=>m.coverage.shots);
  const shots=selected.flatMap(activeEvents).filter(e=>e.teamId===teamId&&e.type==='shot'&&!e.sevenMeter);
  return ['set','fast','quick'].map(phase=>{const events=shots.filter(e=>e.phase===phase),goals=events.filter(e=>e.result==='goal').length;return {phase,shots:events.length,goals,rate:complete&&events.length?goals/events.length*100:null};});
}
