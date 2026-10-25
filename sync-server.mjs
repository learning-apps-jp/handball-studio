import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomInt,randomUUID} from 'node:crypto';
const ROOT=path.dirname(fileURLToPath(import.meta.url));
const TTL=180*86400000, MAX=5*1024*1024;
const ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};
const PUBLIC=new Set(['index.html','styles.css','icon.svg','icon-180.png','icon-192.png','icon-512.png','manifest.webmanifest','sw.js','js/app.mjs','js/core.mjs','js/storage.mjs','js/tactics.mjs','js/video.mjs','js/export.mjs','js/sync.mjs','js/advanced-analysis.mjs','js/dashboard.mjs','js/readiness.mjs','js/personal-report.mjs','js/record-flow.mjs','docs/official-feature-audit.md','docs/implementation-status.md','docs/ipad-guide.md','docs/soq-comparison.md']);
function error(status,message){return Object.assign(new Error(message),{status});}
export async function createSyncServer({dataDir=path.join(ROOT,'.local-data'),now=()=>Date.now(),rateLimit=120}={}) {
  await fs.mkdir(dataDir,{recursive:true});const filename=path.join(dataDir,'rooms.json');let rooms={};
  try {rooms=JSON.parse(await fs.readFile(filename,'utf8'));if(!rooms||Array.isArray(rooms)||typeof rooms!=='object')throw new Error('invalid store');} catch(e){if(e.code!=='ENOENT')throw new Error('共有データの読み込みに失敗しました。保存ファイルを確認してください');}
  let chain=Promise.resolve();const rates=new Map();
  async function persist(){const temp=filename+'.'+randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify(rooms),{mode:0o600});await fs.rename(temp,filename);}
  function code(){let value;do {value=Array.from({length:8},()=>ALPHABET[randomInt(ALPHABET.length)]).join('');}while(rooms[value]);return value;}
  function find(key){const room=rooms[key];if(!room||room.expiresAt<=now())throw error(404,'共有コードが見つからないか期限切れです');return room;}
  function output(room,key){return {code:key,scope:room.scope,payload:room.payload,rev:room.rev,expiresAt:room.expiresAt};}
  const server=http.createServer(async(req,res)=> {
    const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
    try {
      const url=new URL(req.url,'http://localhost');
      if(!url.pathname.startsWith('/api/')) {
        if(!['GET','HEAD'].includes(req.method))throw error(405,'許可されていません');
        const rel=decodeURIComponent(url.pathname).replace(/^\//,'')||'index.html';if(!PUBLIC.has(rel))throw error(404,'Not found');
        const bytes=await fs.readFile(path.join(ROOT,rel));res.writeHead(200,{'Content-Type':MIME[path.extname(rel)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(req.method==='HEAD'?undefined:bytes);return;
      }
      const origin=req.headers.origin;if(origin){let parsed;try{parsed=new URL(origin);}catch{throw error(403,'別サイトからのアクセスは許可されていません');}if(parsed.host!==req.headers.host||!['http:','https:'].includes(parsed.protocol))throw error(403,'別サイトからのアクセスは許可されていません');}
      if(req.headers['sec-fetch-site']==='cross-site')throw error(403,'別サイトからのアクセスは許可されていません');
      const ip=req.socket.remoteAddress;let rate=rates.get(ip);if(!rate||rate.until<=now()){rate={count:0,until:now()+60000};rates.set(ip,rate);}if(++rate.count>rateLimit)throw error(429,'リクエストが多すぎます。少し待ってください');
      if(rates.size>10000)for(const [k,v] of rates)if(v.until<=now())rates.delete(k);
      let body={};if(['POST','PUT'].includes(req.method)) {
        if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))throw error(415,'application/jsonが必要です');
        if(Number(req.headers['content-length'])>MAX)throw error(413,'共有データは5MBまでです');
        const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>MAX)throw error(413,'共有データは5MBまでです');chunks.push(chunk);}try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw error(400,'JSONが不正です');}
        if(!body||typeof body!=='object'||Array.isArray(body))throw error(400,'データが不正です');
      }
      const route=url.pathname.match(/^\/api\/rooms(?:\/([A-Z2-9]{8})(\/rotate)?)?$/);if(!route)throw error(404,'Not found');const key=route[1];
      const operation=async()=> {
        if(!key&&req.method==='POST') {
          if(!['match','roster','inventory'].includes(body.scope)||!Object.hasOwn(body,'payload'))throw error(400,'共有対象が不正です');
          for(const [k,v] of Object.entries(rooms))if(v.expiresAt<=now())delete rooms[k];
          const next=code();rooms[next]={scope:body.scope,payload:body.payload,rev:1,expiresAt:now()+TTL};await persist();return [201,output(rooms[next],next)];
        }
        if(!key)throw error(405,'許可されていません');const room=find(key);
        if(req.method==='GET'&&!route[2])return [200,output(room,key)];
        const expected=Number(String(req.headers['if-match']||'').replace(/^"|"$/g,''));if(!Number.isInteger(expected)||expected!==room.rev)throw error(409,'他の端末で変更されています。先に最新データを確認してください');
        if(req.method==='PUT'&&!route[2]){if(!Object.hasOwn(body,'payload'))throw error(400,'payloadが必要です');room.payload=body.payload;room.rev++;room.expiresAt=now()+TTL;await persist();return [200,output(room,key)];}
        if(req.method==='POST'&&route[2]){const next=code();delete rooms[key];room.rev++;room.expiresAt=now()+TTL;rooms[next]=room;await persist();return [200,output(room,next)];}
        if(req.method==='DELETE'&&!route[2]){delete rooms[key];await persist();return [200,{deleted:true}];}
        throw error(405,'許可されていません');
      };
      const result=chain.then(async()=>{const before=structuredClone(rooms);try{return await operation();}catch(e){rooms=before;throw e;}});chain=result.catch(()=>{});const [status,value]=await result;send(status,value);
    }catch(e){send(e.status||500,{error:e.status?e.message:'サーバーの保存処理に失敗しました'});}
  });
  return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const server=await createSyncServer();server.listen(Number(process.env.PORT||4174),process.env.HOST||'127.0.0.1',()=>console.log('Handball Studio sync server started (local-only by default).'));
}


