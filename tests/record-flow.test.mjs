import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecordFlowDraft,answerRecordFlow,prepareRecordFlowEvent,missDirectionAnswer,isRecordPositionTap,changeRecordFlowParticipant} from '../js/record-flow.mjs';

const event=()=>({id:'event-fixed',matchId:'match',teamId:'home',playerId:'p7',goalkeeperId:'away-gk',period:2,clockMs:800000,type:'shot',result:'goal',sevenMeter:false,phase:'set',zone:9,position:{x:.9,y:.9},shotType:'wing',ballType:'old',emptyNet:true,rebound:true});

test('a new flow clears previous optional answers while freezing the original event identity and clock',()=>{
  const original=event(),copy=structuredClone(original),draft=createRecordFlowDraft(original);assert.deepEqual(original,copy);assert.equal(draft.event.phase,null);assert.equal(draft.event.zone,null);assert.equal(draft.event.position,null);assert.equal(draft.event.shotType,null);assert.equal(draft.event.ballType,'');assert.equal(draft.event.emptyNet,false);assert.equal(draft.event.rebound,false);
  const updated=answerRecordFlow(draft,{phase:'fast',shotType:'unmarked',ballType:'spin',zone:4,rebound:true});assert.equal(updated.event.clockMs,800000);assert.equal(updated.event.period,2);assert.equal(updated.event.id,'event-fixed');assert.equal(updated.event.playerId,'p7');assert.equal(draft.event.phase,null);assert.throws(()=>answerRecordFlow(draft,{clockMs:0}));assert.throws(()=>answerRecordFlow(draft,{id:'new'}));
});
test('a failure must have a result before commit and all miss locations map to one shot event',()=>{
  const draft=createRecordFlowDraft({...event(),result:null});assert.throws(()=>prepareRecordFlowEvent(draft),/結果/);
  for(const direction of ['left','high','right','left_post','bar','right_post']){const answered=answerRecordFlow(draft,missDirectionAnswer(direction));const result=prepareRecordFlowEvent(answered,{withoutPosition:true});assert.equal(result.type,'shot');assert.equal(result.id,'event-fixed');assert.equal(result.result,['left_post','bar','right_post'].includes(direction)?'post':'miss');assert.equal(result.missLocation,direction);assert.equal(result.zone,null);assert.equal(result.position,null);}
});
test('optional details never advance or mutate the source and seven meter is preserved',()=>{
  const draft=createRecordFlowDraft({...event(),sevenMeter:true,result:'goal'});const selected=answerRecordFlow(draft,{phase:'quick',emptyNet:true,rebound:true,ballType:'オリジナル球種',position:{x:.3,y:.4},zone:2});assert.equal(selected.step,1);const prepared=prepareRecordFlowEvent(selected);assert.equal(prepared.sevenMeter,true);assert.equal(prepared.goalkeeperId,null);assert.equal(prepared.rebound,true);assert.equal(selected.event.goalkeeperId,'away-gk');assert.deepEqual(prepared.position,{x:.3,y:.4});const fast=prepareRecordFlowEvent(selected,{withoutCourse:true,withoutPosition:true});assert.equal(fast.zone,null);assert.equal(fast.position,null);assert.equal(fast.phase,'quick');
});
test('invalid option values and updates during commit are rejected',()=>{
  const draft=createRecordFlowDraft(event());for(const patch of [{phase:'invalid'},{shotType:'invalid'},{ballType:'x'.repeat(101)},{zone:10},{position:{x:-.1,y:.3}},{emptyNet:'yes'},{missLocation:'unknown'}])assert.throws(()=>answerRecordFlow(draft,patch));assert.throws(()=>answerRecordFlow({...draft,status:'committing'},{zone:1}));assert.throws(()=>prepareRecordFlowEvent({...draft,status:'cancelled'}));
});
test('court commits require a matching pointer and no more than ten pixels of movement',()=>{
  const start={pointerId:1,x:100,y:100};assert.equal(isRecordPositionTap(start,{pointerId:1,x:106,y:108}),true);assert.equal(isRecordPositionTap(start,{pointerId:1,x:111,y:100}),false);assert.equal(isRecordPositionTap(start,{pointerId:2,x:100,y:100}),false);assert.equal(isRecordPositionTap(null,start),false);
});
test('editing retains existing optional answers, independent coordinates and frozen identity',()=>{
  const source={...event(),missLocation:'bar'},before=structuredClone(source),draft=createRecordFlowDraft(source,{editing:true});
  for(const key of ['phase','shotType','ballType','zone','position','missLocation','emptyNet','rebound'])assert.deepEqual(draft.event[key],source[key]);
  const changed=answerRecordFlow(draft,{position:{x:.2,y:.3}}),prepared=prepareRecordFlowEvent(changed);assert.equal(prepared.id,source.id);assert.equal(prepared.clockMs,source.clockMs);assert.equal(prepared.goalkeeperId,source.goalkeeperId);assert.deepEqual(prepared.position,{x:.2,y:.3});assert.deepEqual(source,before);assert.deepEqual(draft.event.position,source.position);
});
test('editing accepts both legacy shot types and preserves them through unrelated changes',()=>{
  for(const type of ['fast','other']){const draft=createRecordFlowDraft({...event(),shotType:type,phase:''},{editing:true});const changed=answerRecordFlow(draft,{zone:4});assert.equal(prepareRecordFlowEvent(changed).shotType,type);assert.equal(changed.event.phase,'');}
});
test('editing only clears existing course and position when the explicit skip options request it',()=>{
  const draft=createRecordFlowDraft({...event(),emptyNet:false},{editing:true}),same=prepareRecordFlowEvent(draft);assert.equal(same.zone,9);assert.deepEqual(same.position,{x:.9,y:.9});
  const noPosition=prepareRecordFlowEvent(draft,{withoutPosition:true});assert.equal(noPosition.position,null);assert.equal(noPosition.zone,9);
  const noCourse=prepareRecordFlowEvent(draft,{withoutCourse:true});assert.equal(noCourse.zone,null);assert.equal(noCourse.missLocation,null);assert.deepEqual(noCourse.position,{x:.9,y:.9});assert.equal(draft.event.zone,9);
});
test('participant changes use the correct roster and preserve clock, team and original draft',()=>{
  const participants={shooters:[{id:'p7',label:'#7 山田'},{id:'p8',label:'#8 田中'}],goalkeepers:[{id:'away-gk',label:'#1'},{id:'g2',label:'#12'}]};
  const draft=answerRecordFlow(createRecordFlowDraft(event()),{emptyNet:true}),before=structuredClone(draft);const shooter=changeRecordFlowParticipant(draft,'playerId','p8',participants);assert.equal(shooter.event.playerId,'p8');assert.equal(shooter.event.goalkeeperId,'away-gk');assert.equal(shooter.event.emptyNet,true);assert.equal(shooter.event.id,'event-fixed');assert.equal(shooter.event.teamId,'home');assert.equal(shooter.event.period,2);assert.equal(shooter.event.clockMs,800000);assert.deepEqual(draft,before);
  const keeper=changeRecordFlowParticipant(shooter,'goalkeeperId','g2',participants);assert.equal(keeper.event.goalkeeperId,'g2');assert.equal(keeper.event.emptyNet,false);assert.equal(changeRecordFlowParticipant(keeper,'goalkeeperId',null,participants).event.goalkeeperId,null);assert.equal(changeRecordFlowParticipant(keeper,'playerId','',participants).event.playerId,null);
});
test('participants cannot be assigned from the wrong side or changed during save',()=>{
  const participants={shooters:[{id:'p7',label:'選手'}],goalkeepers:[{id:'g',label:'GK'}]},draft=createRecordFlowDraft(event());
  assert.throws(()=>changeRecordFlowParticipant(draft,'playerId','g',participants));assert.throws(()=>changeRecordFlowParticipant(draft,'goalkeeperId','p7',participants));assert.throws(()=>changeRecordFlowParticipant(draft,'teamId','x',participants));assert.throws(()=>changeRecordFlowParticipant({...draft,status:'committing'},'playerId',null,participants));
});
test('new saves reject empty goals while unknown goalkeeper and unrelated legacy edits remain possible',()=>{
  const saved=createRecordFlowDraft({...event(),result:'saved'});assert.throws(()=>answerRecordFlow(saved,{emptyNet:true}),/エンプティー/);assert.throws(()=>prepareRecordFlowEvent({...saved,event:{...saved.event,emptyNet:true}}),/エンプティー/);
  const normalized=answerRecordFlow(answerRecordFlow(createRecordFlowDraft(event()),{emptyNet:true}),{result:'saved'});assert.equal(normalized.event.emptyNet,false);assert.equal(prepareRecordFlowEvent({...normalized,event:{...normalized.event,goalkeeperId:null}}).result,'saved');
  const legacy=createRecordFlowDraft({...event(),result:'saved',emptyNet:true},{editing:true});assert.equal(answerRecordFlow(legacy,{zone:5}).event.emptyNet,true);assert.equal(answerRecordFlow(legacy,{result:'saved'}).event.emptyNet,false);assert.equal(changeRecordFlowParticipant(legacy,'goalkeeperId',null,{goalkeepers:[]}).event.emptyNet,false);
});
test('editing cannot introduce a saved-empty contradiction and normalized legacy data cannot reintroduce it',()=>{
  const normal=createRecordFlowDraft({...event(),result:'saved',emptyNet:false},{editing:true});assert.equal(normal.initialSavedEmpty,false);assert.throws(()=>answerRecordFlow(normal,{emptyNet:true}),/エンプティー/);assert.throws(()=>prepareRecordFlowEvent({...normal,event:{...normal.event,emptyNet:true}}),/エンプティー/);
  const legacy=createRecordFlowDraft({...event(),result:'saved',emptyNet:true},{editing:true});assert.equal(legacy.initialSavedEmpty,true);assert.equal(prepareRecordFlowEvent(answerRecordFlow(legacy,{zone:3})).emptyNet,true);const cleared=answerRecordFlow(legacy,{emptyNet:false});assert.throws(()=>answerRecordFlow(cleared,{emptyNet:true}),/エンプティー/);
});
