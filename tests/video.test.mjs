import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYouTubeId, mapClockToVideo, mapVideoToClock, clipRange, matchesTags, attachableTactic, allowedText,fetchYouTubeMetadata,gestureAction,memoTimestamp,floatingMemoBottom } from '../js/video.mjs';
import { defaultFrame } from '../js/tactics.mjs';

test('YouTube parser accepts supported URLs and rejects hostile src values', () => {
  const id = 'dQw4w9WgXcQ';
  for (const url of [id, `https://youtu.be/${id}?t=4`, `https://www.youtube.com/watch?v=${id}`, `https://youtube.com/embed/${id}`, `https://m.youtube.com/shorts/${id}`]) assert.equal(parseYouTubeId(url), id);
  for (const url of ['javascript:alert(1)', 'https://youtube.com.evil.org/watch?v=dQw4w9WgXcQ', 'https://evil.org/embed/dQw4w9WgXcQ', '<iframe src=x>', 'https://youtube.com/watch?v=short', 'file:///watch?v=dQw4w9WgXcQ']) assert.equal(parseYouTubeId(url), null);
});
test('periods map independently and stopped clock resumes from the later anchor', () => {
  const anchors = [{ period: 1, clockMs: 0, videoSeconds: 10 }, { period: 1, clockMs: 60000, videoSeconds: 70 }, { period: 1, clockMs: 60000, videoSeconds: 130 }, { period: 2, clockMs: 0, videoSeconds: 1800 }];
  assert.equal(mapClockToVideo(anchors, 1, 30000), 40);
  assert.equal(mapClockToVideo(anchors, 1, 60000), 130);
  assert.equal(mapClockToVideo(anchors, 1, 90000), 160);
  assert.equal(mapClockToVideo(anchors, 2, 30000), 1830);
  assert.equal(mapVideoToClock(anchors, 1, 160), 90000);
  assert.equal(mapVideoToClock(anchors, 1, 100), 60000, 'clock stays stopped during a timeout');
  assert.equal(mapClockToVideo(anchors, 3, 0), null);
  assert.equal(mapClockToVideo([{ period: 1, clockMs: 60000, videoSeconds: 5 }], 1, 0), 0);
});
test('tag filtering requires every requested tag and content checks use configured words', () => {
  assert.equal(matchesTags({ tags: ['攻撃', '速攻'] }, '攻撃,速攻'), true);
  assert.equal(matchesTags({ tags: ['攻撃'] }, '攻撃、速攻'), false);
  assert.equal(matchesTags({}, ''), true);
  assert.equal(allowedText('Good play', ['bad']), true);
  assert.equal(allowedText('BAD word', ['bad']), false);
});
test('only valid tactical animations at most thirty seconds can be attached', () => {
  const first = defaultFrame(); first.duration = 30000;
  assert.equal(attachableTactic({ name: '作戦', frames: [first, defaultFrame()] }), true);
  assert.equal(attachableTactic({ name: '作戦', frames: [first, defaultFrame(), defaultFrame()] }), false);
  assert.equal(attachableTactic({ name: '作戦', frames: [{ duration: 1, players: [], ball: {} }] }), false);
});
test('clips use five seconds of context or an explicit interval', () => {
  assert.deepEqual(clipRange({ videoSeconds: 2 }), { start: 0, end: 7 });
  assert.deepEqual(clipRange({ videoSeconds: 20, startSeconds: 10, endSeconds: 40 }), { start: 10, end: 40 });
  assert.deepEqual(clipRange({ videoSeconds: 20, startSeconds: null, endSeconds: null }), { start: 15, end: 25 });
});
test('video metadata only requests the fixed YouTube oEmbed endpoint for a parsed id',async()=>{
  let called=0;
  const result=await fetchYouTubeMetadata('https://youtu.be/dQw4w9WgXcQ?t=3',{fetcher:async(url,options)=>{called++;const endpoint=new URL(url);assert.equal(endpoint.origin,'https://www.youtube.com');assert.equal(endpoint.pathname,'/oembed');assert.equal(endpoint.searchParams.get('url'),'https://www.youtube.com/watch?v=dQw4w9WgXcQ');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');return {ok:true,json:async()=>({title:'<img src=x>',author_name:'テスト'})};}});
  assert.deepEqual(result,{id:'dQw4w9WgXcQ',title:'<img src=x>',channel:'テスト'});assert.equal(called,1);
  await assert.rejects(fetchYouTubeMetadata('https://evil.test/watch?v=dQw4w9WgXcQ',{fetcher:()=>{called++;}}));assert.equal(called,1);
});
test('metadata failures and stalled requests produce explicit errors',async()=>{
  await assert.rejects(fetchYouTubeMetadata('dQw4w9WgXcQ',{fetcher:async()=>({ok:false,status:404})}),/404/);
  await assert.rejects(fetchYouTubeMetadata('dQw4w9WgXcQ',{fetcher:async()=>({ok:true,json:async()=>({title:[],author_name:'x'})})}),/形式/);
  await assert.rejects(fetchYouTubeMetadata('dQw4w9WgXcQ',{fetcher:()=>new Promise(()=>{}),timeoutMs:10}),/タイムアウト/);
});
test('gesture actions distinguish normal and clip seeks, swipes and long presses',()=>{
  assert.deepEqual(gestureAction({ratio:.1,doubleTap:true}),{type:'seek',seconds:-10});assert.deepEqual(gestureAction({ratio:.9,doubleTap:true,clipMode:true}),{type:'seek',seconds:5});
  assert.deepEqual(gestureAction({dy:-80,dx:5,clipMode:true}),{type:'next'});assert.deepEqual(gestureAction({dy:90,clipMode:true}),{type:'previous'});assert.deepEqual(gestureAction({dy:90}),{type:'none'});
  assert.deepEqual(gestureAction({durationMs:600,ratio:.1}),{type:'hold-seek',seconds:-2});assert.deepEqual(gestureAction({durationMs:600,ratio:.5}),{type:'speed',rate:2});assert.deepEqual(gestureAction(),{type:'toggle'});
});
test('floating memo captures synchronized video time and falls back to the match clock explicitly',()=>{
  const anchors=[{period:1,clockMs:600000,videoSeconds:100}];
  assert.deepEqual(memoTimestamp({anchors,period:1,videoSeconds:112.5,matchClockMs:0}),{videoSeconds:112.5,clockMs:612500,synchronized:true});
  assert.deepEqual(memoTimestamp({anchors,period:2,videoSeconds:12,matchClockMs:45000}),{videoSeconds:12,clockMs:45000,synchronized:false});
  assert.deepEqual(memoTimestamp({anchors,period:1,videoSeconds:null,matchClockMs:6000}),{videoSeconds:null,clockMs:6000,synchronized:false});
});
test('floating memo clears virtual keyboard and mobile navigation space without negative offsets',()=>{
  assert.equal(floatingMemoBottom({innerHeight:1024,viewportHeight:700,offsetTop:0}),346);
  assert.equal(floatingMemoBottom({innerHeight:1024,viewportHeight:700,offsetTop:20,mobile:true}),396);
  assert.equal(floatingMemoBottom({innerHeight:700,viewportHeight:1024}),22);
  assert.equal(floatingMemoBottom({mobile:true}),92);
});
