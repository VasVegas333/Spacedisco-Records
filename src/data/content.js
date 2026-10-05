import artistsData from './artists.json';
import releasesData from './releases.json';
import squarespaceData from './squarespace.json';

export const releases=releasesData;
export const artists=artistsData;
export const squarespace=squarespaceData;

const musicPage=squarespaceData.pages?.['/music']||{images:[],links:[]};
const musicImages=musicPage.images.filter(src=>!/spacedisco[+%20].*logo/i.test(src));
const musicLinks=musicPage.links.filter(x=>/^listen$/i.test((x.label||'').trim()));
export const musicCatalogue=musicImages.map((artwork,i)=>({artwork,listen:musicLinks[i]?.href||'',number:i+1}));

const page=(path)=>squarespaceData.pages?.[path]||{headings:[],images:[],links:[],text:''};
const cards=(path)=>page(path).headings
  .filter(h=>h.level>=2)
  .map((h,i)=>({title:h.text,image:page(path).images[i]||'',link:page(path).links[i]?.href||''}));

// These are sourced from Squarespace only. No invented event or mix records.
const eventPage=page('/events');
const eventImages=eventPage.images.filter(src=>!/spacedisco[+%20].*logo/i.test(src));
const ticketLinks=eventPage.links.filter(x=>/ticket/i.test(x.label)||/tickettailor/i.test(x.href));
export const events=eventImages.map((image,i)=>({
  image,
  link:ticketLinks[i]?.href||'',
  source:'Squarespace',
  number:String(i+1).padStart(2,'0')
}));

const mixesPage=page('/mixes');
const mixImages=mixesPage.images.filter(src=>!/spacedisco[+%20].*logo/i.test(src));
const mixLinks=mixesPage.links.filter(x=>/^listen$/i.test((x.label||'').trim()));
export const mixes=mixImages.map((image,i)=>({
  number:String(i+1).padStart(3,'0'),
  image,
  link:mixLinks[i]?.href||'',
  source:'Squarespace'
}));
