import fs from 'node:fs/promises';

const BASE='https://spacediscorecords.com';
const PAGES=['/','/music','/albums','/artists','/events','/mixes','/demos','/playlist'];
const UA='Mozilla/5.0 (compatible; SpacediscoSquarespaceSync/2.0; +https://spacediscorecords.com)';

async function get(path){
  const url=new URL(path,BASE).href;
  const r=await fetch(url,{headers:{'user-agent':UA,'accept':'text/html,application/xhtml+xml'}});
  if(!r.ok) throw new Error(url+' -> '+r.status);
  return {url,html:await r.text()};
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
    if(!href||/javascript:/i.test(href))continue;
    out.push({label,href});
  }
  return [...new Map(out.map(x=>[x.href+'|'+x.label,x])).values()];
}
function headings(html){
  return [...html.matchAll(/<h([1-4])[^>]*>([\s\S]*?)<\/h\1>/gi)]
    .map(m=>({level:Number(m[1]),text:clean(m[2]),index:m.index}))
    .filter(x=>x.text);
}
function pageData(path,url,html){
  const hs=headings(html),imgs=images(html,url),ls=links(html,url);
  const title=clean((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)||[])[1]||'');
  const description=decode((/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)["']/i.exec(html)||[])[1]||'');
  return {path,url,title,description,headings:hs.map(({level,text})=>({level,text})),images:imgs,links:ls,text:clean(html)};
}
function artistData(page){
  const hs=headings(page.__html).filter(x=>x.level===2&&!/join spacedisco/i.test(x.text));
  const allImages=images(page.__html,page.url);
  return hs.map((h,i)=>{
    const next=hs[i+1]?.index??page.__html.length;
    const before=page.__html.slice(i?hs[i-1].index:0,h.index);
    const block=page.__html.slice(h.index,next);
    const blockImages=images(before,page.url);
    const email=(block.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)||[])[0]||'SpacediscoRecords@gmail.com';
    const blockLinks=links(block,page.url).filter(x=>!x.href.startsWith('mailto:'));
    return {name:h.text,slug:slug(h.text),image:blockImages.at(-1)||allImages[i]||'',email,links:blockLinks};
  }).filter(x=>x.name&&x.image);
}
async function main(){
  const pages={};
  let artists=[];
  for(const path of PAGES){
    try{
      const {url,html}=await get(path);
      const data=pageData(path,url,html);
      data.__html=html;
      if(path==='/artists') artists=artistData(data);
      delete data.__html;
      pages[path]=data;
    }catch(e){
      console.warn('Squarespace page sync failed:',path,String(e));
    }
  }
  if(!pages['/']||!pages['/music']||artists.length<20) throw new Error('Squarespace sync incomplete; refusing to overwrite good content');
  const releaseFile='src/data/releases.json';
  const currentReleases=JSON.parse(await fs.readFile(releaseFile,'utf8').catch(()=> '[]'));
  const musicImages=pages['/music'].images||[];
  const normalized=u=>{try{return decodeURIComponent(u).replace(/\\+/g,' ')}catch{return u.replace(/\\+/g,' ')}};
  const artworkFor=release=>{
    const number=String(release.catalog||'').match(/SDR\\s*0*(\\d+)/i)?.[1];
    if(number){
      const re=new RegExp('(?:^|[^0-9])SDR\\\\s*0*'+Number(number)+'(?:[^0-9]|$)','i');
      const hit=musicImages.find(u=>re.test(normalized(u)));
      if(hit)return hit;
    }
    if(/10 year part 2/i.test(release.title||''))return musicImages.find(u=>/10 Year Pt 2/i.test(normalized(u)))||'';
    return '';
  };
  const releases=currentReleases.map(r=>({...r,artwork:artworkFor(r)}));
  const payload={source:BASE,syncedAt:new Date().toISOString(),pages,artists};
  await fs.writeFile('src/data/squarespace.json',JSON.stringify(payload,null,2)+'\n');
  await fs.writeFile('src/data/artists.json',JSON.stringify(artists.map(a=>({...a,name:a.name.toUpperCase(),location:'',bio:''})),null,2)+'\\n');
  await fs.writeFile(releaseFile,JSON.stringify(releases,null,2)+'\\n');
  console.log('Squarespace sync complete:',Object.keys(pages).length,'pages,',artists.length,'artists');
}
main().catch(e=>{console.error(e);process.exit(1)});
