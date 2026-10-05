import fs from 'node:fs/promises';

const DEFAULT_BASE='https://spacediscorecords.squarespace.com';
const BASE=(process.env.SQUARESPACE_SOURCE_BASE||DEFAULT_BASE).replace(/\/$/,'');
const PAGES=['/','/music','/albums','/artists','/events','/mixes','/demos','/playlist'];
const REQUIRED=['/','/music','/artists','/events','/mixes','/demos'];
const UA='Mozilla/5.0 (compatible; SpacediscoSquarespaceSync/3.0)';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(path){
  const url=new URL(path,BASE).href;
  let last;
  for(let attempt=1;attempt<=4;attempt++){
    try{
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),20000);
      const r=await fetch(url,{redirect:'follow',signal:controller.signal,headers:{'user-agent':UA,'accept':'text/html,application/xhtml+xml'}});
      clearTimeout(timer);
      if(!r.ok) throw new Error('HTTP '+r.status);
      const html=await r.text();
      if(html.length<1000) throw new Error('response unexpectedly small');
      return {url:r.url||url,html};
    }catch(e){
      last=e;
      if(attempt<4) await sleep(attempt*1500);
    }
  }
  throw new Error(url+' -> '+String(last));
}
const decode=s=>(s||'').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&nbsp;/g,' ').replace(/&#x2F;/g,'/');
const clean=s=>decode((s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
const slug=s=>s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const absolute=(u,base)=>{try{return new URL(decode(u),base).href}catch{return ''}};
function images(html,base){
  const out=[];
  for(const m of html.matchAll(/(?:src|data-src|data-image)=["']([^"']+)["']/gi)){
    const url=absolute(m[1],base);
    if(url&&/squarespace-cdn\.com|spacediscorecords\.com/i.test(url)&&!/(favicon|icon)/i.test(url)) out.push(url);
  }
  return [...new Set(out)];
}
function links(html,base){
  const out=[];
  for(const m of html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
    const href=absolute(m[1],base),label=clean(m[2]);
    if(!href||/javascript:/i.test(href)) continue;
    out.push({label,href});
  }
  return [...new Map(out.map(x=>[x.href+'|'+x.label,x])).values()];
}
function headings(html){
  return [...html.matchAll(/<h([1-4])[^>]*>([\s\S]*?)<\/h\1>/gi)]
    .map(m=>({level:Number(m[1]),text:clean(m[2]),index:m.index})).filter(x=>x.text);
}
function pageData(path,url,html){
  const hs=headings(html);
  return {
    path,url,
    title:clean((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)||[])[1]||''),
    description:decode((/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)["']/i.exec(html)||[])[1]||''),
    headings:hs.map(({level,text})=>({level,text})),
    images:images(html,url),links:links(html,url),text:clean(html)
  };
}
function artistData(html,url){
  const hs=headings(html).filter(x=>x.level===2&&!/join spacedisco/i.test(x.text));
  const allImages=images(html,url);
  return hs.map((h,i)=>{
    const next=hs[i+1]?.index??html.length;
    const before=html.slice(i?hs[i-1].index:0,h.index);
    const block=html.slice(h.index,next);
    const blockImages=images(before,url);
    const email=(block.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)||[])[0]||'SpacediscoRecords@gmail.com';
    return {name:h.text,slug:slug(h.text),image:blockImages.at(-1)||allImages[i]||'',email,links:links(block,url).filter(x=>!x.href.startsWith('mailto:'))};
  }).filter(x=>x.name&&x.image);
}
const readJSON=async(file,fallback)=>{try{return JSON.parse(await fs.readFile(file,'utf8'))}catch{return fallback}};
const stable=x=>JSON.stringify(x);
const normalizeUrl=u=>{try{return decodeURIComponent(String(u||'').replace(/\+/g,' '))}catch{return String(u||'').replace(/\+/g,' ')}};
function artworkFor(release,musicImages){
  if(release.catalog==='SDR544'){
    return musicImages.find(u=>/132c0795-e17d-425a-9997-e5f5d554b8b7/i.test(u))||release.artwork||'';
  }
  if(/10 year part 2/i.test(release.title||'')){
    return musicImages.find(u=>/10\s*year\s*(?:pt|part)\s*2/i.test(normalizeUrl(u)))||release.artwork||'';
  }
  const number=String(release.catalog||'').match(/SDR\s*0*(\d+)/i)?.[1];
  if(number){
    const wanted='SDR'+Number(number);
    const hit=musicImages.find(u=>normalizeUrl(u).toUpperCase().replace(/[^A-Z0-9]/g,'').includes(wanted));
    if(hit) return hit;
  }
  return release.artwork||'';
}
function sanePage(path,next,prev){
  if(!next||!next.text||next.text.length<100) return false;
  if(path==='/music'){
    const n=next.images?.length||0,p=prev?.images?.length||0;
    return n>=6 && (!p||n>=Math.floor(p*.65));
  }
  if(path==='/artists'){
    const n=next.images?.length||0,p=prev?.images?.length||0;
    return n>=20 && (!p||n>=Math.floor(p*.65));
  }
  return true;
}

async function main(){
  const oldPayload=await readJSON('src/data/squarespace.json',{source:BASE,pages:{},artists:[]});
  const currentReleases=await readJSON('src/data/releases.json',[]);
  const pages={...oldPayload.pages};
  let freshArtists=null;
  const failures=[];

  for(const path of PAGES){
    try{
      const {url,html}=await get(path);
      const next=pageData(path,url,html);
      if(!sanePage(path,next,oldPayload.pages?.[path])) throw new Error('validation rejected suspicious page payload');
      pages[path]=next;
      if(path==='/artists'){
        const parsed=artistData(html,url);
        const previous=oldPayload.artists?.length||0;
        if(parsed.length<20||(previous&&parsed.length<Math.floor(previous*.7))) throw new Error('artist roster shrank suspiciously');
        freshArtists=parsed;
      }
    }catch(e){
      failures.push(path+': '+String(e));
      console.warn('Preserving last-known-good data for',path,String(e));
    }
  }

  for(const path of REQUIRED){
    if(!pages[path]) throw new Error('No last-known-good data exists for required page '+path);
  }
  const artists=freshArtists||oldPayload.artists||[];
  if(artists.length<20) throw new Error('Artist data unavailable or incomplete; refusing write');

  const musicImages=pages['/music'].images||[];
  const releases=currentReleases.map(r=>({...r,artwork:artworkFor(r,musicImages)}));
  const comparableOld={source:oldPayload.source||DEFAULT_BASE,pages:oldPayload.pages||{},artists:oldPayload.artists||[]};
  const comparableNew={source:BASE,pages,artists};
  const pageChanged=stable(comparableOld)!==stable(comparableNew);
  const releaseChanged=stable(currentReleases)!==stable(releases);

  if(!pageChanged&&!releaseChanged){
    console.log('Squarespace sync healthy; no content changes. Failures:',failures.length?failures.join(' | '):'none');
    return;
  }

  const payload={source:BASE,syncedAt:new Date().toISOString(),pages,artists};
  const artistFile=artists.map(a=>({...a,name:a.name.toUpperCase(),location:'',bio:''}));
  await fs.writeFile('src/data/squarespace.json',JSON.stringify(payload,null,2)+'\n');
  await fs.writeFile('src/data/artists.json',JSON.stringify(artistFile,null,2)+'\n');
  await fs.writeFile('src/data/releases.json',JSON.stringify(releases,null,2)+'\n');
  console.log('Squarespace sync wrote validated changes.',{pageChanged,releaseChanged,failures});
}
main().catch(e=>{console.error(e);process.exit(1)});
