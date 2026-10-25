import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultFrame,validateTactic,interpolateFrames,timelineFrame,durationOf,followBall,resizeRoster,motionSamplesToFrames} from './tactics.mjs';

test('all defensive presets have seven attackers and six defenders with valid normalized coordinates',()=>{
  for(const defense of ['6-0','5-1','3-2-1']){
    const frame=defaultFrame(defense);assert.equal(frame.players.filter(p=>p.team==='home').length,7);assert.equal(frame.players.filter(p=>p.team==='away').length,6);assert.doesNotThrow(()=>validateTactic({name:defense,frames:[frame]}));
  }
});
test('roster resizing changes every frame, preserves existing positions and clears missing ball owners',()=>{
  const a=defaultFrame(),b=defaultFrame();a.ball.ownerId='home-7';b.players[0].x=.3;
  const frames=resizeRoster([a,b],'home',4);assert.equal(frames[0].players.length,10);assert.equal(frames[0].ball.ownerId,null);assert.equal(frames[1].players.find(p=>p.id==='home-1').x,.3);assert.equal(a.players.length,13);assert.doesNotThrow(()=>validateTactic({name:'4 vs 6',frames}));assert.throws(()=>resizeRoster([a],'away',7));
});
test('ball follows its designated owner and annotations reject unsafe or excessive coordinates',()=>{
  const f=defaultFrame();f.ball.ownerId='home-1';followBall(f);assert.equal(f.ball.x,.145);assert.equal(f.ball.y,.505);f.lines=[{kind:'pass',points:[{x:0,y:0},{x:1,y:1}]}];assert.doesNotThrow(()=>validateTactic({name:'pass',frames:[f]}));f.lines[0].points[1].x=Infinity;assert.throws(()=>validateTactic({name:'pass',frames:[f]}));
});
test('realtime motion samples preserve elapsed time, positions and the 30 second boundary',()=>{
  const a=defaultFrame(),b=defaultFrame(),c=defaultFrame();b.players[0].x=.4;c.players[0].x=.7;
  const frames=motionSamplesToFrames([{at:0,frame:a},{at:300,frame:b},{at:750,frame:c}]);assert.equal(durationOf(frames),750);assert.equal(frames[0].duration,300);assert.equal(frames[1].duration,450);assert.equal(frames.at(-1).players[0].x,.7);assert.equal(a.duration,1000);assert.doesNotThrow(()=>validateTactic({name:'recorded',court:'full',showOpponent:false,frames}));assert.throws(()=>motionSamplesToFrames([{at:0,frame:a},{at:30001,frame:b}]));assert.throws(()=>validateTactic({name:'bad',court:'unknown',frames}));
});
test('interpolation follows player ids even when array order differs and does not mutate sources',()=>{
  const a=defaultFrame(),b=structuredClone(a);b.players.reverse();b.players.find(p=>p.id==='home-1').x=.8;b.ball.y=.2;const before=structuredClone(a);const midpoint=interpolateFrames(a,b,.5);
  assert.equal(midpoint.players.find(p=>p.id==='home-1').x,.46);assert.equal(midpoint.ball.y,.48);assert.deepEqual(a,before);assert.deepEqual(interpolateFrames(a,b,-1),a);
});
test('timeline uses each source frame duration and reaches the exact final frame',()=>{
  const a=defaultFrame(),b=structuredClone(a),c=structuredClone(a);a.duration=2000;b.duration=500;b.ball.x=.7;c.ball.x=.9;
  assert.equal(durationOf([a,b,c]),2500);assert.equal(timelineFrame([a,b,c],1000).ball.x,.605);assert.equal(timelineFrame([a,b,c],2250).ball.x,.8);assert.deepEqual(timelineFrame([a,b,c],99999),c);assert.deepEqual(timelineFrame([a],1000),a);
});
test('import validation rejects invalid coordinates, inconsistent identity, duration and team counts',()=>{
  const good={name:'cross',frames:[defaultFrame(),defaultFrame()]};
  for(const mutate of [v=>v.frames[0].ball.x=2,v=>v.frames[1].players[0].id='changed',v=>v.frames[0].duration=0,v=>v.frames[0].players[0].team='away',v=>v.frames[0].players[0].number='<script>']){const bad=structuredClone(good);mutate(bad);assert.throws(()=>validateTactic(bad));}
});
