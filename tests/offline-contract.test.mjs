import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {OFFLINE_ASSETS} from '../js/readiness.mjs';
test('offline diagnostics, service worker and distribution include the same application dependencies',async()=>{const root=new URL('../',import.meta.url);const sw=await fs.readFile(new URL('sw.js',root),'utf8');const build=await fs.readFile(new URL('build.mjs',root),'utf8');const server=await fs.readFile(new URL('sync-server.mjs',root),'utf8');const files=JSON.parse(sw.match(/const FILES=(\[[^\]]+\])/)[1].replaceAll("'",'"'));assert.deepEqual([...files].sort(),[...OFFLINE_ASSETS].sort());for(const asset of files.filter(x=>x!=='./')){const name=asset.slice(2);assert.ok(build.includes(`'${name}'`),`distribution lacks ${name}`);assert.ok(server.includes(`'${name}'`),`sync hosting lacks ${name}`);await fs.access(new URL(name,root));}});
