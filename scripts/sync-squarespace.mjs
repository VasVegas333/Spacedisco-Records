import fs from 'node:fs/promises';

const PAGES={
  artists:'https://spacediscorecords.com/artists',
  albums:'https://spacediscorecords.com/albums'
};
const UA='Mozilla/5.0 (compatible; SpacediscoSquarespaceSync/1.0)';
async function get(url){const r=await fetch(url,{headers:{'user-agent':UA,'accept':'text/html'}});if(!r.ok)throw new Error(url+' -> '+r.status);return r.text()}
const decode=s=>(s||'').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&nbsp;/g,' ');
const clean=s=>decode((s||'').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
const slug=s=>s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');

function imageUrls(html){
  const out=[];
  const re=/(?:src|data-src|data-image)=["'](https:\/\/images\.squarespace-cdn\.com\/[^"']+)["']/gi;
  for(const m of html.matchAll(re))out.push(decode(m[1]));
  return [...new Set(out)];
}
function artists(html){
  const imgs=imageUrls(html);
  const headings=[...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)]
    .map(m=>({name:clean(m[1]),index:m.index}))
    .filter(x=>x.name&&!/join spacedisco/i.test(x.name));
  return headings.map((h,i)=>{
    const prev=i?headings[i-1].index:0;
    const nearby=html.slice(prev,h.index);
    const local=imageUrls(nearby);
    return {name:h.name.toUpperCase(),slug:slug(h.name),image:local.at(-1)||imgs[i]||'',location:'',bio:''};
  }).filter(x=>x.image);
}
async function main(){
  const oldArtists=JSON.parse(await fs.readFile('src/data/artists.json','utf8').catch(()=> '[]'));
  let nextArtists=[];
  try{nextArtists=artists(await get(PAGES.artists))}catch(e){console.warn('Artists sync failed',String(e))}
  if(nextArtists.length<3){console.warn('Preserving existing artist data');nextArtists=oldArtists}
  if(!nextArtists.length)throw new Error('Refusing to write empty artist data');
  await fs.writeFile('src/data/artists.json',JSON.stringify(nextArtists,null,2)+'\n');
  console.log('Squarespace sync:',nextArtists.length,'artists');
}
main().catch(e=>{console.error(e);process.exit(1)});
