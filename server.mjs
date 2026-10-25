import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.PORT||4173);
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};
const server=http.createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');let rel=decodeURIComponent(u.pathname).replace(/^\/+/, '')||'index.html';if(rel.includes('\0')||rel.split(/[\\/]/).some(x=>x==='..'||x.startsWith('.'))||!['GET','HEAD'].includes(req.method)){res.writeHead(403);res.end();return;}const file=path.resolve(root,rel);if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}const stat=await fs.stat(file);if(!stat.isFile())throw new Error('not file');res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'});res.end(req.method==='HEAD'?undefined:await fs.readFile(file));}catch{res.writeHead(404);res.end('Not found');}});
server.listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`Handball Studio: http://${process.env.HOST||'127.0.0.1'}:${port}`));
