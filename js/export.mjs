const UTF8 = new TextEncoder();
const MAX_SHARE_BYTES = 100_000;
export const SHARE_LIMIT_BYTES = MAX_SHARE_BYTES;
function xml(value) { return String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])); }
function column(index) { let s = ''; for (index++; index; index = Math.floor((index - 1) / 26)) s = String.fromCharCode(65 + (index - 1) % 26) + s; return s; }
const CRC_TABLE = Array.from({length:256}, (_, n) => { for (let i=0;i<8;i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
export function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function header(size) { const bytes = new Uint8Array(size); return [bytes, new DataView(bytes.buffer)]; }
function zip(files) {
  const local = [], central = []; let offset=0, centralSize=0;
  for (const [path, content] of files) {
    const name=UTF8.encode(path), data=UTF8.encode(content), crc=crc32(data);
    const [lh,l]=header(30); l.setUint32(0,0x04034b50,true); l.setUint16(4,20,true); l.setUint16(6,0x800,true); l.setUint16(12,33,true); l.setUint32(14,crc,true); l.setUint32(18,data.length,true); l.setUint32(22,data.length,true); l.setUint16(26,name.length,true);
    local.push(lh,name,data);
    const [ch,c]=header(46); c.setUint32(0,0x02014b50,true); c.setUint16(4,20,true); c.setUint16(6,20,true); c.setUint16(8,0x800,true); c.setUint16(14,33,true); c.setUint32(16,crc,true); c.setUint32(20,data.length,true); c.setUint32(24,data.length,true); c.setUint16(28,name.length,true); c.setUint32(42,offset,true);
    central.push(ch,name); offset += lh.length+name.length+data.length; centralSize += ch.length+name.length;
  }
  const [end,e]=header(22); e.setUint32(0,0x06054b50,true); e.setUint16(8,files.length,true); e.setUint16(10,files.length,true); e.setUint32(12,centralSize,true); e.setUint32(16,offset,true);
  return new Blob([...local,...central,end],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
/** OOXML workbook. Strings are inline strings, never formulas. No dependencies/network. */
export function workbookBlob(sheets) {
  if (!Array.isArray(sheets) || !sheets.length || sheets.length > 255) throw new Error('シートを1〜255枚指定してください');
  const seen=new Set();
  const names=sheets.map((s,i)=> { let base=String(s.name || `Sheet${i+1}`).replace(/[\\/?*\[\]:]/g,'_').replace(/^'+|'+$/g,'').slice(0,31) || 'Sheet'; let n=base,j=1; while(seen.has(n.toLowerCase())) {const suffix=` (${++j})`;n=base.slice(0,31-suffix.length)+suffix;} seen.add(n.toLowerCase()); return n; });
  const prolog='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const files=[['[Content_Types].xml',prolog+`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],['_rels/.rels',prolog+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],['xl/workbook.xml',prolog+`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n,i)=>`<sheet name="${xml(n)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`],['xl/_rels/workbook.xml.rels',prolog+`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}</Relationships>`]];
  sheets.forEach((s,si)=> {
    if (!Array.isArray(s.rows) || s.rows.length>1048576) throw new Error('行数が不正です');
    const rows=s.rows.map((row,ri)=> {
      if (!Array.isArray(row) || row.length>16384) throw new Error('列数が不正です');
      return `<row r="${ri+1}">${row.map((v,ci)=> {const ref=`${column(ci)}${ri+1}`; if(v==null)return ''; if(typeof v==='number'&&Number.isFinite(v))return `<c r="${ref}"><v>${v}</v></c>`; if(typeof v==='boolean')return `<c r="${ref}" t="b"><v>${v?1:0}</v></c>`; const text=String(v); if(text.length>32767)throw new Error('セル文字数がExcelの上限を超えています'); return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(text)}</t></is></c>`;}).join('')}</row>`;
    }).join('');
    files.push([`xl/worksheets/sheet${si+1}.xml`,prolog+`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`]);
  });
  return zip(files);
}
function pick(source, keys) { return Object.fromEntries(keys.filter(k=>source[k]!==undefined).map(k=>[k,structuredClone(source[k])])); }
/** Allowlist projection: never includes videos, comments, revisions, inventory or unrelated records. */
export function shareSnapshot(state, {matchId,playerId,teamId}={}) {
  const matches=state.matches || [];
  if (playerId && !teamId) teamId=state.teams?.find(t=>t.players?.some(p=>p.id===playerId))?.id;
  const chosen=matchId ? matches.filter(m=>m.id===matchId) : playerId ? matches.filter(m=>m.events.some(e=>!e.deleted&&(e.playerId===playerId||e.goalkeeperId===playerId))) : matches.slice(0,1);
  if (!chosen.length) throw new Error('共有する試合がありません');
  const projected=chosen.map(m=> {
    const metadata=pick(m,['id','name','opponent','date','tournament','homeTeamId','awayTeamId','periodMinutes','coverage','finished']);
    const events=(m.events||[]).filter(e=>!e.deleted&&(!playerId||e.playerId===playerId||e.goalkeeperId===playerId)).map(e=> {
      const item=pick(e,['id','period','clockMs','teamId','playerId','goalkeeperId','type','result','sevenMeter','zone','position','shotType','ballType','rebound','phase','emptyNet','missLocation','missType','subtype','defense','pattern','delta']);
      if(playerId) { if(item.playerId!==playerId)delete item.playerId; if(item.goalkeeperId!==playerId)delete item.goalkeeperId; }
      return item;
    });
    return {...metadata,period:1,clock:{elapsed:0,runningSince:null},events,revisions:[],video:{url:'',anchors:[],comments:[]}};
  });
  const ids=new Set(projected.flatMap(m=>m.events.flatMap(e=>[e.playerId,e.goalkeeperId])).filter(Boolean)); if(playerId)ids.add(playerId);
  const teamIds=new Set(projected.flatMap(m=>[m.homeTeamId,m.awayTeamId,...m.events.map(e=>e.teamId)]).filter(Boolean));
  const teams=(state.teams||[]).filter(t=>teamIds.has(t.id)).map(t=>({...pick(t,['id','name']),players:(t.players||[]).filter(p=>ids.has(p.id)&&(!playerId||p.id===playerId)).map(p=>pick(p,['id','name','number','position','isGK','gk']))}));
  return {schemaVersion:1,readOnly:true,shareVersion:1,sharedPlayerId:playerId||null,sharedTeamId:teamId||null,teams,matches:projected,tactics:[],inventory:[]};
}
/** Fragment payload, not a server upload. Maximum JSON size 100 KB; URL can be long. */
export function encodeShare(snapshot) {
  const bytes=UTF8.encode(JSON.stringify(snapshot)); if(bytes.length>MAX_SHARE_BYTES)throw new Error('共有リンクは100KBまでです。試合や選手を絞ってください');
  let raw=''; for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return '#view='+btoa(raw).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export function decodeShare(fragment) {
  const encoded=String(fragment).replace(/^.*?#view=/,'').replace(/^#?view=/,'');
  if(!encoded||encoded.length>Math.ceil(MAX_SHARE_BYTES*4/3)+4||!/^[\w-]+$/.test(encoded))throw new Error('共有リンクが不正または大きすぎます');
  let decoded; try {const raw=atob(encoded.replace(/-/g,'+').replace(/_/g,'/')); const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)); if(bytes.length>MAX_SHARE_BYTES)throw new Error(); decoded=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));} catch {throw new Error('共有リンクを読み込めません');}
  if(decoded?.shareVersion!==1||decoded?.readOnly!==true||!Array.isArray(decoded.matches)||!Array.isArray(decoded.teams)||!decoded.matches.length)throw new Error('未対応の共有データです');
  const safe=shareSnapshot(decoded,{matchId:decoded.sharedPlayerId?undefined:decoded.matches[0].id,playerId:decoded.sharedPlayerId||undefined,teamId:decoded.sharedTeamId||undefined});
  return safe;
}
