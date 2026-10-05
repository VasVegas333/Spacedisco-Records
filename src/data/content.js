import artistsData from './artists.json';
import releasesData from './releases.json';
import squarespaceData from './squarespace.json';

export const releases=releasesData;
export const artists=artistsData;
export const squarespace=squarespaceData;

const page=(path)=>squarespaceData.pages?.[path]||{headings:[],images:[],links:[],text:''};
const cards=(path)=>page(path).headings
  .filter(h=>h.level>=2)
  .map((h,i)=>({title:h.text,image:page(path).images[i]||'',link:page(path).links[i]?.href||''}));

// These are sourced from Squarespace only. No invented event or mix records.
export const events=cards('/events').map((x,i)=>({
  date:'',
  city:x.title,
  venue:'',
  detail:'',
  image:x.image,
  link:x.link,
  source:'Squarespace',
  number:String(i+1).padStart(2,'0')
}));

export const mixes=cards('/mixes').map((x,i)=>({
  number:String(i+1).padStart(3,'0'),
  title:x.title,
  artist:'',
  length:'',
  image:x.image,
  link:x.link,
  source:'Squarespace'
}));
