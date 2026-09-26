// Minimal Tumblr theme renderer for local preview.
// Fills a small, representative subset of Tumblr template tags/blocks with sample data.
const fs = require('fs');
const path = require('path');

const themePath = process.argv[2];
const outPath = process.argv[3];
const page = process.argv[4] || 'index'; // 'index' | 'permalink'

let html = fs.readFileSync(themePath, 'utf8');

// ---- theme option defaults (from meta tags) ----
const opts = {};
html.replace(/<meta name="color:([^"]+)" content="([^"]*)"/g, (m,k,v)=>{opts['color:'+k]=v;});
html.replace(/<meta name="text:([^"]+)" content="([^"]*)"/g, (m,k,v)=>{opts['text:'+k]=v;});
html.replace(/<meta name="image:([^"]+)" content="([^"]*)"/g, (m,k,v)=>{opts['image:'+k]=v;});
// first select value = default
const selects = {};
html.replace(/<meta name="select:([^"]+)" content="([^"]*)"/g, (m,k,v)=>{ if(!(('select:'+k) in selects)) selects['select:'+k]=v; });
// allow overrides: LAYOUT=grid COLUMNS=4 TYPEFACE=sans
if(process.env.LAYOUT) selects['select:Layout']=process.env.LAYOUT;
if(process.env.COLUMNS) selects['select:Columns']=process.env.COLUMNS;
if(process.env.GUTTER) selects['select:Gutter']=process.env.GUTTER;
if(process.env.TYPEFACE) selects['select:Typeface']=process.env.TYPEFACE;
if(process.env.PAGINATION) selects['select:Pagination']=process.env.PAGINATION;
// if: toggles — set desired ones
const toggles = {
  'Use Lightbox':1,'Show Captions On Hover':1,'Show Camera Info':1,
  'Hide Non Photo Posts':0,'Show Description':1,'Protect Images':0
};

// sample photos (picsum, fixed seeds for stable dims)
const photos = [
  [800,1200],[1200,800],[900,900],[1200,1500],[1500,1000],
  [1000,1400],[1400,930],[800,1000],[1100,1100],[1600,1067],
  [900,1350],[1300,867]
];
function img(w,h,seed){
  const hues=[24,200,150,340,45,275,15,190];
  const hue=hues[seed%hues.length];
  const svg=`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>`+
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>`+
    `<stop offset='0' stop-color='hsl(${hue},45%,62%)'/><stop offset='1' stop-color='hsl(${(hue+40)%360},40%,38%)'/></linearGradient></defs>`+
    `<rect width='100%' height='100%' fill='url(#g)'/>`+
    `<text x='50%' y='50%' fill='rgba(255,255,255,.85)' font-family='sans-serif' font-size='${Math.round(Math.min(w,h)/8)}' text-anchor='middle' dominant-baseline='middle'>${w}×${h}</text></svg>`;
  return 'data:image/svg+xml;utf8,'+encodeURIComponent(svg);
}

const globals = {
  Title:'Field Notes', RSS:'#', Favicon:'', 'PortraitURL-128':'',
  MetaDescription:'Photography by A. Nedimyer',
  Description:'<p>Light, landscape and the occasional stranger. Available for commissions.</p>',
  CopyrightYears:'2026', SearchQuery:'', CustomCSS:'',
  Tag:'landscape', SearchResultCount:'8', PostSummary:'',
  CurrentPage:'1', TotalPages:'4', PreviousPage:'#', NextPage:'/page/2',
};

// ---- resolve if: blocks ----
function resolveIf(str){
  Object.keys(toggles).forEach(name=>{
    const on = toggles[name] === 1;
    const id = name.replace(/\s+/g,'');
    // IfNot
    str = str.replace(new RegExp('\\{block:IfNot'+id+'\\}([\\s\\S]*?)\\{\\/block:IfNot'+id+'\\}','g'), on?'':'$1');
    str = str.replace(new RegExp('\\{block:If'+id+'\\}([\\s\\S]*?)\\{\\/block:If'+id+'\\}','g'), on?'$1':'');
  });
  // text/website/etc "If<Option>" for text options with values
  ['InstagramUsername','EmailAddress','WebsiteURL','FooterText','LogoImage'].forEach(k=>{
    const has = k==='LogoImage' ? !!opts['image:Logo'] : false;
    str = str.replace(new RegExp('\\{block:If'+k+'\\}([\\s\\S]*?)\\{\\/block:If'+k+'\\}','g'), has?'$1':'');
    str = str.replace(new RegExp('\\{block:IfNot'+k+'\\}([\\s\\S]*?)\\{\\/block:IfNot'+k+'\\}','g'), has?'':'$1');
  });
  return str;
}

// Build one photo tile
function photoTile(i){
  const [w,h]=photos[i%photos.length];
  const url=img(w,h,i);
  return `<figure class="tile tile--photo" id="post-${i}">
  <a class="tile-link" href="/post/${i}" data-lightbox-item data-src="${url}" data-width="${w}" data-height="${h}" data-alt="Photo ${i}" data-permalink="/post/${i}">
    <span class="tile-media"><img src="${url}" alt="Photo ${i}" width="${w}" height="${h}" loading="lazy" decoding="async"></span>
    <figcaption class="tile-caption"><p>Untitled no. ${i} — morning light.</p></figcaption>
  </a>
  <template class="lightbox-caption-source"><p>Untitled no. ${i} — morning light on the ridge.</p></template>
</figure>`;
}
function photosetTile(i){
  const imgs=[0,1,2].map(k=>{const [w,h]=photos[(i+k)%photos.length];const u=img(w,h,i*10+k);
    return `<img src="${u}" alt="set ${k}" width="${w}" height="${h}" loading="lazy" data-lightbox-item data-src="${u}" data-width="${w}" data-height="${h}" data-alt="set ${k}">`;}).join('');
  const [w,h]=photos[i%photos.length];
  return `<figure class="tile tile--photoset" id="post-${i}">
  <a class="tile-link" href="/post/${i}" data-permalink="/post/${i}">
    <span class="tile-media">${imgs}</span>
    <span class="tile-count" aria-hidden="true"></span>
    <figcaption class="tile-caption"><p>A short series, ${i}.</p></figcaption>
  </a>
  <template class="lightbox-caption-source"><p>A short series from the coast, ${i}.</p></template>
</figure>`;
}
function textTile(i){
  return `<article class="tile tile--text" id="post-${i}">
  <a class="tile-link" href="/post/${i}"><h3>On patience</h3>
  <div class="tile-body"><p>Notes from a slow week of shooting. The best frames come when you stop chasing them and let the scene arrive.</p></div>
  <span class="tile-type">Read</span></a>
</article>`;
}

function buildIndexPosts(){
  let out='';
  for(let i=1;i<=12;i++){
    if(i%7===0) out+=textTile(i)+'\n';
    else if(i%5===0) out+=photosetTile(i)+'\n';
    else out+=photoTile(i)+'\n';
  }
  return out;
}

// ---- page block selection ----
function stripBlock(str,name,keep){
  return str.replace(new RegExp('\\{block:'+name+'\\}([\\s\\S]*?)\\{\\/block:'+name+'\\}','g'), keep?'$1':'');
}

let out = html;

// page-level blocks
out = stripBlock(out,'IndexPage', page==='index');
out = stripBlock(out,'PermalinkPage', page==='permalink');
out = stripBlock(out,'SearchPage', false);
out = stripBlock(out,'TagPage', false);
out = stripBlock(out,'PostSummary', false);
out = stripBlock(out,'HasPages', false);
out = stripBlock(out,'Pagination', page==='index');
out = stripBlock(out,'PreviousPage', false);
out = stripBlock(out,'NextPage', page==='index');

// Description
out = stripBlock(out,'Description', true);

if(page==='index'){
  // Replace the whole {block:Posts}...{/block:Posts} with generated markup
  out = out.replace(/\{block:Posts\}[\s\S]*?\{\/block:Posts\}/, buildIndexPosts());
} else {
  // permalink: one photo post
  const [w,h]=photos[0]; const url=img(w,h,101);
  const single = `<article class="entry" id="post-1">
  <div class="entry-photos"><figure class="entry-photo"><img src="${url}" alt="lead" width="${w}" height="${h}" data-lightbox-item data-src="${url}" data-width="${w}" data-height="${h}" data-alt="lead"></figure></div>
  <div class="entry-meta">
    <div class="entry-body"><p>Shot at first light near the north ridge. A long wait for the fog to lift just enough.</p></div>
    <ul class="exif"><li data-label="Camera">Leica M11</li><li data-label="Focal">35mm</li><li data-label="Aperture">f/2.8</li><li data-label="Shutter">1/250s</li></ul>
    <footer class="entry-footer">
      <div><time>September 20, 2026</time> · 214 notes</div>
      <div class="entry-tags"><a href="#">#landscape</a><a href="#">#fog</a><a href="#">#leica</a></div>
      <div class="entry-actions"></div>
    </footer>
  </div>
</article>`;
  out = out.replace(/\{block:Posts\}[\s\S]*?\{\/block:Posts\}/, single);
}

// resolve if: toggles
out = resolveIf(out);

// remaining generic blocks that might survive -> drop their wrappers, keep inner
['Date','HasTags','NoteCount','IfShowCameraInfo','Exif','Camera','FocalLength','Aperture','Exposure','PermalinkPagination','NextPost','PreviousPost','PostNotes','RebloggedFrom','Caption','Title','Source','Photos','Photo','Photoset','Text','Quote','Link','Video','Audio','Chat','Answer','Lines','Label','Tags','NoSearchResults','SearchPage','TagPage'].forEach(b=>{
  out = out.replace(new RegExp('\\{block:'+b+'\\}','g'),'').replace(new RegExp('\\{\\/block:'+b+'\\}','g'),'');
});

// substitute {color:*},{text:*},{image:*},{select:*}
out = out.replace(/\{(color|text|image|select):([^}]+)\}/g,(m,type,name)=>{
  const key=type+':'+name;
  return (key in opts)?opts[key]:(key in selects)?selects[key]:'';
});

// substitute simple globals {Foo}
out = out.replace(/\{([A-Za-z][A-Za-z0-9-]*)\}/g,(m,k)=> (k in globals)?globals[k]:'');

fs.writeFileSync(outPath,out);
console.log('wrote',outPath);
