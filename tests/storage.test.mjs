import test from 'node:test';
import assert from 'node:assert/strict';
import {backupEnvelope,parseBackup,csv} from '../js/storage.mjs';
import {createState,createMatch} from '../js/core.mjs';
test('backup freezes a running clock at export time without mutating the live match',()=>{const state=createState();state.teams=[{id:'a',name:'A',players:[]},{id:'b',name:'B',players:[]}];const m=createMatch({homeTeamId:'a',awayTeamId:'b'});m.clock={elapsed:12000,runningSince:Date.now()-3000};state.matches.push(m);const before=Date.now(),out=backupEnvelope(state),after=Date.now();assert.equal(out.data.matches[0].clock.runningSince,null);assert.ok(out.data.matches[0].clock.elapsed>=15000&&out.data.matches[0].clock.elapsed<=15000+after-before+5);assert.notEqual(state.matches[0].clock.runningSince,null);assert.equal(parseBackup(JSON.stringify(out)).matches.length,1);});
test('backup import rejects wrong formats and CSV guards formula prefixes and quotes',()=>{assert.throws(()=>parseBackup('{"application":"other","version":1}'));assert.throws(()=>parseBackup('{broken'));assert.match(csv([['=HYPERLINK("x")','+5','@SUM(A1)','normal']]),/"'=HYPERLINK/);assert.match(csv([['a"b']]),/a""b/);});
