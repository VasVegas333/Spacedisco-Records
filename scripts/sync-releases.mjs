import fs from 'node:fs/promises';

const LABEL='Spacedisco Records';
const SOURCES={
  beatport:'https://www.beatport.com/label/spacedisco-records/58874',
  traxsource:'https://www.traxsource.com/label/28751/spacedisco-records'
};
const UA='Mozilla/5.0 (compatible; SpacediscoRecordsCatalogSync/1.0)';

async function get(url){
  const r=await fetch(url,{headers:{'user-agent':UA,'accept':'text/html,application/xhtml+xml'}});
  if(!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.text();
}
const clean=s=>s?.replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/<[^>]+>/g,'').trim();
const uniq=a=>[...new Map(a.filter(x=>x.title&&x.artist).map(x=>[(x.catalog||'')+'|'+x.artist+'|'+x.title,x])).values()];

function beatport(html){
  const out=[];
  const ld=[...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for(const m of ld){try{const j=JSON.parse(m[1]);const walk=x=>{if(!x||typeof x!=='object')return;if(Array.isArray(x))return x.forEach(walk);const name=x.name||'';if((x['@type']==='MusicAlbum'||x['@type']==='MusicRecording'||x['@type']==='Product')&&name){const by=x.byArtist?.name||x.brand?.name||x.author?.name||'';const img=typeof x.image==='string'?x.image:x.image?.url;out.push({title:clean(name),artist:clean(by),date:x.datePublished||x.releaseDate||'',artwork:img||'',beatport:x.url||''});}Object.values(x).forEach(walk)};walk(j)}catch{}}
  return out;
}
function traxsource(html){
  const out=[];
  for(const m of html.matchAll(/<a[^>]+href=["']([^"']*\/title\/\d+\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
    const title=clean(m[2]); if(!title||title.length>120) continue;
    const around=html.slice(Math.max(0,m.index-1200),m.index+1200);
    const cat=(around.match(/\bSDR\d+\b/i)||[])[0]?.toUpperCase()||'';
    const img=(around.match(/<img[^>]+(?:src|data-src)=["']([^"']+)["']/i)||[])[1]||'';
    const artist=clean((around.match(/class=["'][^"']*artist[^"']*["'][^>]*>([\s\S]*?)<\//i)||[])[1]||'');
    out.push({catalog:cat,title,artist,artwork:img,traxsource:new URL(m[1],SOURCES.traxsource).href});
  }
  return out;
}
const slug=s=>s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');

async function main(){
  const errors=[];let bp=[],tx=[];
  try{bp=beatport(await get(SOURCES.beatport))}catch(e){errors.push(String(e))}
  try{tx=traxsource(await get(SOURCES.traxsource))}catch(e){errors.push(String(e))}
  const existing=JSON.parse(await fs.readFile('src/data/releases.json','utf8').catch(()=> '[]'));
  const all=uniq([...tx,...bp]);
  const merged=all.map(x=>{
    const other=[...tx,...bp].find(y=>(x.catalog&&y.catalog===x.catalog)||(y.title?.toLowerCase()===x.title?.toLowerCase()&&y.artist?.toLowerCase()===x.artist?.toLowerCase()))||{};
    return {...other,...x,label:LABEL,slug:slug(x.title)};
  }).filter(x=>x.catalog||x.traxsource||x.beatport);
  const output=merged.length?merged:existing;
  if(!output.length) throw new Error('No releases parsed and no previous catalogue exists. '+errors.join('; '));
  await fs.mkdir('src/data',{recursive:true});
  await fs.writeFile('src/data/releases.json',JSON.stringify(output,null,2)+'\n');
  console.log(`Synced ${output.length} releases`,errors.length?'Warnings: '+errors.join('; '):'');
}
main().catch(e=>{console.error(e);process.exit(1)});
