import fs from 'node:fs/promises';

const SOURCES={
  beatport:'https://www.beatport.com/label/spacedisco-records/58874',
  traxsource:'https://www.traxsource.com/label/28751/spacedisco-records'
};
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141 Safari/537.36';

async function get(url){
  const r=await fetch(url,{headers:{'user-agent':UA,'accept':'text/html,application/xhtml+xml'}});
  if(!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.text();
}
const decode=s=>(s||'').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').trim();
const clean=s=>decode((s||'').replace(/<[^>]+>/g,'')).replace(/\s+/g,' ').trim();
const abs=(u,base)=>{try{return new URL(decode(u),base).href}catch{return ''}};
const slug=s=>s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');

function meta(html,name){
  const a=new RegExp('<meta[^>]+(?:property|name)=["\\\']'+name+'["\\\'][^>]+content=["\\\']([^"\\\']+)["\\\']','i').exec(html);
  const b=new RegExp('<meta[^>]+content=["\\\']([^"\\\']+)["\\\'][^>]+(?:property|name)=["\\\']'+name+'["\\\']','i').exec(html);
  return decode((a||b||[])[1]||'');
}
function jsonLdImages(html){
  const found=[];
  for(const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
    try{
      const walk=x=>{
        if(!x)return;
        if(Array.isArray(x))return x.forEach(walk);
        if(typeof x!=='object')return;
        if(typeof x.image==='string')found.push(x.image);
        else if(Array.isArray(x.image))x.image.forEach(v=>typeof v==='string'&&found.push(v));
        else if(x.image?.url)found.push(x.image.url);
        Object.values(x).forEach(walk);
      };
      walk(JSON.parse(m[1]));
    }catch{}
  }
  return found;
}
function extractArtwork(html,url){
  const candidates=[
    meta(html,'og:image:secure_url'),meta(html,'og:image'),meta(html,'twitter:image'),
    ...jsonLdImages(html)
  ].filter(Boolean).map(x=>abs(x,url));
  const embedded=[...html.matchAll(/https?:\\?\/\\?\/[^"'<> ]+\.(?:jpg|jpeg|png|webp)(?:\?[^"'<> ]*)?/gi)]
    .map(m=>m[0].replace(/\\\//g,'/'));
  const all=[...candidates,...embedded].filter(u=>/image|cover|artwork|beatport|traxsource|cloudfront|cdn/i.test(u));
  return all.find(u=>!/(logo|avatar|icon|favicon)/i.test(u))||'';
}
function links(html,base,kind){
  const out=[];
  const re=/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for(const m of html.matchAll(re)){
    const href=abs(m[1],base);
    if(kind==='beatport'&&!/\/release\/[^/]+\/\d+/.test(href))continue;
    if(kind==='traxsource'&&!/\/title\/\d+\//.test(href))continue;
    const title=clean(m[2]); if(!title||title.length>160)continue;
    out.push({title,url:href});
  }
  return [...new Map(out.map(x=>[x.url,x])).values()];
}
async function enrich(release,previous){
  const urls=[release.beatport,release.traxsource].filter(Boolean);
  for(const url of urls){
    try{
      const html=await get(url);
      const artwork=extractArtwork(html,url);
      if(artwork)return {...release,artwork};
    }catch(e){console.warn('Artwork metadata failed:',url,String(e))}
  }
  return {...release,artwork:release.artwork||previous?.artwork||''};
}
async function main(){
  const previous=JSON.parse(await fs.readFile('src/data/releases.json','utf8').catch(()=> '[]'));
  const found=[];
  for(const [kind,labelUrl] of Object.entries(SOURCES)){
    try{
      const html=await get(labelUrl);
      for(const x of links(html,labelUrl,kind)){
        const existing=found.find(r=>r.title.toLowerCase()===x.title.toLowerCase());
        if(existing)existing[kind]=x.url;
        else found.push({title:x.title,slug:slug(x.title),label:'Spacedisco Records',[kind]:x.url});
      }
    }catch(e){console.warn('Catalogue fetch failed:',kind,String(e))}
  }
  const base=found.length?found:previous;
  const output=[];
  for(const r of base){
    const old=previous.find(p=>(r.catalog&&p.catalog===r.catalog)||(p.title?.toLowerCase()===r.title?.toLowerCase()));
    output.push(await enrich({...old,...r},old));
  }
  if(!output.length)throw new Error('Refusing to write an empty catalogue');
  await fs.writeFile('src/data/releases.json',JSON.stringify(output,null,2)+'\n');
  console.log(`Synced ${output.length} releases; ${output.filter(x=>x.artwork).length} with artwork`);
}
main().catch(e=>{console.error(e);process.exit(1)});
