// SureCast hero: an animated side view of the beach for the selected hour.
// Land on the left, sea on the right. Wind streaks, waves (same ft scale as the
// 6 ft surfcaster), tide = where the water reaches between the H/L flags,
// fish count = fishing score band, plus a strip of every hour's score.
(function(){
"use strict";
const W=360, H=262, PX_FT=5, SHORE_TOP=158, SLOPE=0.58, SAND_X0=86, LOW_Y=226, HIGH_Y=176;
const {compass, fishLabel, fishHex:fishColor} = window.SC;   // util.js
const fishCount = s => s>=80?5:s>=70?4:s>=60?3:s>=40?2:s>=20?1:0;   // absolute score, not ranked within the day
const windColor = k => k<6?"#7fb8d8":k<10?"#5fd0a0":k<14?"#a8d05a":k<18?"#e8c24a":k<23?"#f0904a":k<30?"#f06a4a":"#e04a5a";
const rad = d => d*Math.PI/180, frac = x => x-Math.floor(x), lerp=(a,b,f)=>a+(b-a)*f;
const mix = (a,b,f) => { const p=c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16)); const x=p(a),y=p(b); return "#"+x.map((v,i)=>Math.round(v+(y[i]-v)*f).toString(16).padStart(2,"0")).join(""); };
const edgeX = y => SAND_X0 + (y-SHORE_TOP)/SLOPE;                  // where water at level y meets the sand

function arrow(x0,y0,x1,y1,w,color,op=1){
  const a=Math.atan2(y1-y0,x1-x0), hl=w*2.2, hw=w*1.6, bx=x1-hl*Math.cos(a), by=y1-hl*Math.sin(a), nx=-Math.sin(a), ny=Math.cos(a);
  return `<path opacity="${op.toFixed(2)}" d="M${(x0+nx*w/2).toFixed(1)} ${(y0+ny*w/2).toFixed(1)} L${(bx+nx*w/2).toFixed(1)} ${(by+ny*w/2).toFixed(1)} L${(bx+nx*hw).toFixed(1)} ${(by+ny*hw).toFixed(1)} L${x1.toFixed(1)} ${y1.toFixed(1)} L${(bx-nx*hw).toFixed(1)} ${(by-ny*hw).toFixed(1)} L${(bx-nx*w/2).toFixed(1)} ${(by-ny*w/2).toFixed(1)} L${(x0-nx*w/2).toFixed(1)} ${(y0-ny*w/2).toFixed(1)} Z" fill="${color}"/>`;
}
// surfcaster silhouette, designed 60 units tall (6 ft) facing the sea, feet at (0,0)
function surfcaster(lineTo, C="#152131"){
  return `<g fill="${C}">
    <path d="M-1 -1 L-9 0 L-8 -3 L-3 -4 Z"/><path d="M12 -1 L4 0 L5 -3 L10 -4 Z"/>
    <path d="M-7 -2 L-3 -2 L1 -27 L-6 -28 Z"/><path d="M6 -2 L10 -2 L4 -28 L-2 -27 Z"/>
    <path d="M-7 -26 Q-8 -40 -4 -47 L5 -48 Q9 -40 7 -26 Z"/>
    <circle cx="2" cy="-53" r="5.2"/><ellipse cx="2" cy="-56.5" rx="9" ry="2"/><path d="M-3 -57 Q-3 -63 2 -63 Q7 -63 7 -57 Z"/></g>
  <g stroke="${C}" stroke-width="3.6" stroke-linecap="round" fill="none"><path d="M3 -45 Q9 -40 15 -42"/><path d="M-1 -44 Q6 -34 10 -33"/></g>
  <path d="M6 -30 Q46 -82 74 -110" stroke="${C}" stroke-width="2.2" fill="none" stroke-linecap="round"/><circle cx="10" cy="-35" r="2.6" fill="${C}"/>
  <path d="M74 -110 Q${(lineTo[0]*0.55).toFixed(1)} -118 ${lineTo[0].toFixed(1)} ${lineTo[1].toFixed(1)}" stroke="${C}" stroke-width=".9" fill="none" opacity=".75"/>
  <g fill="${C}"><path d="M-46 1 L-45.6 -13 L-42.4 -13 L-42 1 Z"/><path d="M-46.6 -12 L-41.4 -12 L-41.8 -15 L-46.2 -15 Z"/>
    <path d="M-44 -10 L-43.2 -42" stroke="${C}" stroke-width="2.8" stroke-linecap="round"/>
    <path d="M-43.2 -42 Q-41.5 -95 -33 -127" stroke="${C}" stroke-width="1.3" fill="none" stroke-linecap="round"/>
    <path d="M-43.4 -28 L-40 -28" stroke="${C}" stroke-width="1.6"/><ellipse cx="-38.6" cy="-28" rx="2.4" ry="3.4"/>
    <rect x="-37" y="-14" width="24" height="14" rx="1.6"/><rect x="-38" y="-17" width="26" height="4" rx="1.4"/>
    <rect x="-40" y="-11" width="3.5" height="2.4" rx="1"/><rect x="-13.5" y="-11" width="3.5" height="2.4" rx="1"/></g>`;
}
const FISH = `<path d="M7 0 Q2 -4.5 -5 -2.2 L-10 -5 L-8.5 0 L-10 5 L-5 2.2 Q2 4.5 7 0 Z"/>`;
const fishAt = (x,y,dir,color) => `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${dir*1.05} 1.05)" fill="${color}" opacity=".92">${FISH}<circle cx="3.6" cy="-0.8" r="0.9" fill="#0b1724"/></g>`;

let S = null, raf = 0, lastDraw = 0, onScreen = true, watched = null;
// Stop animating while the scene is scrolled out of view.
const io = window.IntersectionObserver ? new IntersectionObserver(es => { onScreen = es[es.length-1].isIntersecting;
  if (onScreen && S && !reduceMotion && !raf) raf = requestAnimationFrame(loop); }) : null;
const reduceMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

/* d: {hour, sunrise, sunset (decimal hours), wind, gust, windFrom, wave, period, sst, air, feels (°F), tide:{v,low:{v,t},high:{v,t},rising}|null,
       cloud (0-100), rain (mm/h), pop (% chance of rain), storm (bool), starOk[] (hours eligible for the best star), moon:{ill, waxing}, shore (bearing the beach faces), scores[], cur, curLabel, isNow, hourLabels[]} */
function render(svg, d, onPick){
  const id="hero";
  const tide=d.tide, tFrac = tide ? Math.max(0,Math.min(1,(tide.v-tide.low.v)/((tide.high.v-tide.low.v)||1))) : 0.5;
  const waterY=LOW_Y-(LOW_Y-HIGH_Y)*tFrac, wx=edgeX(waterY);
  const wave=d.wave||0, hpx=Math.min(78,wave*PX_FT), lam=Math.max(50,(d.period||6)*11);
  const eastFacing = Math.sin(rad(d.shore))>=0;   // sun rises over the sea on east-facing beaches
  let dayF=(d.hour-d.sunrise)/(d.sunset-d.sunrise); const isDay=dayF>0&&dayF<1, golden=isDay&&(dayF<.12||dayF>.85);
  const cover=Math.max(0,Math.min(1,(d.cloud||0)/100));
  let sky = !isDay?["#081428","#22385a"]: golden?["#3a5f8f","#f2a865"]:["#3d7cc0","#9fd0f0"];
  sky = sky.map(c=>mix(c, isDay?"#6b7684":"#1c2430", cover*0.6));
  const cross=Math.cos(rad(d.windFrom-d.shore)), onshore=cross>0.15, offshore=cross<-0.15, wdir=offshore?1:-1;
  const score=d.scores[d.cur], nFish=fishCount(score);

  // ---- static layers
  let skyL=`<rect width="${W}" height="${H}" fill="url(#${id}Sky)"/>`, glowL="";
  const overcast = cover>=0.85;
  if (isDay){ const f=eastFacing?dayF:1-dayF, x=W-20-(W-40)*f, y=150-118*Math.sin(Math.PI*dayF), c=golden?"#ffcf70":"#fff1b0";
    if (overcast) glowL=`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="30" fill="url(#${id}Glow)"/>`;
    else skyL+=`<circle cx="${x}" cy="${y}" r="${golden?24:18}" fill="${c}" opacity=".18"/><circle cx="${x}" cy="${y}" r="${golden?15:12}" fill="${c}" opacity="${(1-cover*0.5).toFixed(2)}"/>`; }
  else {
    const r=11, cx=78, cy=64, ill=d.moon.ill, k=1-2*ill, lit=d.moon.waxing?1:0;   // lit limb on the right when waxing
    skyL+=`<circle cx="${cx}" cy="${cy}" r="${r+9}" fill="#f4f1e6" opacity=".08"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="#2a3446"/>
      <path d="M${cx} ${cy-r} A${r} ${r} 0 0 ${lit} ${cx} ${cy+r} A${(Math.abs(k)*r).toFixed(2)} ${r} 0 0 ${(k>0)===!!lit?0:1} ${cx} ${cy-r} Z" fill="#f4f1e6"/>`;
    for(let i=0;i<22;i++) skyL+=`<circle cx="${(frac(i*0.618)*W).toFixed(1)}" cy="${(frac(i*0.371)*120+6).toFixed(1)}" r="${i%4?0.7:1.1}" fill="#fff" opacity="${(0.35+frac(i*0.29)*0.5).toFixed(2)}"/>`;
  }
  let sand=`<path d="M-2 ${SHORE_TOP} L${SAND_X0} ${SHORE_TOP} L${edgeX(H)} ${H} L-2 ${H} Z" fill="${isDay?"#dcc89a":"#7d7360"}"/>
    <path d="M${edgeX(HIGH_Y)} ${HIGH_Y} L${edgeX(H)} ${H}" stroke="${isDay?"#b9a271":"#615843"}" stroke-width="8" opacity=".5"/>`;
  if (tide) [[HIGH_Y,"H",tide.high.t,"#7fd3ff"],[LOW_Y,"L",tide.low.t,"#cfd8e3"]].forEach(([y,l,t,c])=>{ const x=edgeX(y)-2;
    sand+=`<line x1="${x}" y1="${y}" x2="${x}" y2="${y-22}" stroke="#4a3c22" stroke-width="1.5"/><path d="M${x} ${y-22} l-15 4 l15 4 Z" fill="${c}"/>
      <text x="${x-6}" y="${y+14}" text-anchor="end" font-size="9.5" font-weight="700" fill="${isDay?"#5b4a2a":"#e8dcc0"}">${l} ${t}</text>`; });
  const ax=edgeX(HIGH_Y)-46, ay=SHORE_TOP+Math.max(0,ax-SAND_X0)*SLOPE, sc=6*PX_FT/60, lineEnd=[(wx+70-ax)/sc,(waterY+4-ay)/sc];
  sand+=`<g transform="translate(${ax.toFixed(1)} ${ay.toFixed(1)}) scale(${sc})">${!isDay?`<path d="M6 -55 L88 -33.2 L88 -7.6 Z" fill="url(#${id}Beam)"/><circle cx="6" cy="-55" r="5" fill="#fff6c8" opacity=".35"/>`:""}
    <g ${!isDay?'style="filter:drop-shadow(0 0 1.4px #e2ecff) drop-shadow(0 0 1.4px #c9dbf5) drop-shadow(0 0 9px rgba(150,185,230,.55))"':""}>${surfcaster(lineEnd, isDay?"#152131":"#000")}</g>${!isDay?`<circle cx="6" cy="-55" r="1.8" fill="#fffbe0"/>`:""}</g>`;

  let labels=`<text x="12" y="28" font-size="22" font-weight="800" fill="#fff">${Math.round(d.wind)}<tspan font-size="12" font-weight="600"> kts</tspan><tspan font-size="10" font-weight="500" opacity=".8"> ${Math.round(d.wind*1.15078)} mph</tspan></text>
    <text x="12" y="44" font-size="11" fill="#fff" opacity=".92">${compass(d.windFrom)} · gust ${Math.round(d.gust)} · ${onshore?"onshore":offshore?"offshore":"along shore"}</text>`;
  if (isDay && d.uv!=null && d.uv>=0.5){ const u=Math.round(d.uv), b=u>=11?["#9b5de5","extreme","#fff"]:u>=8?["#e0504a","very high","#fff"]:u>=6?["#f0904a","high","#1d1a14"]:u>=3?["#e8c24a","moderate","#1d1a14"]:["#4cc27a","low","#0b1f14"];
    const txt=`UV ${u} · ${b[1]}`, w=txt.length*5.6+14;
    labels+=`<rect x="${W-10-w}" y="60" width="${w.toFixed(1)}" height="17" rx="8.5" fill="${b[0]}"/><text x="${(W-10-w/2).toFixed(1)}" y="72" text-anchor="middle" font-size="10" font-weight="800" fill="${b[2]}">${txt}</text>`; }
  { const bits=[];
    if (d.air!=null) bits.push(`<tspan font-size="12" font-weight="800">${Math.round(d.air)}°F</tspan> air`+(d.feels!=null&&Math.abs(d.feels-d.air)>=3?` · feels ${Math.round(d.feels)}°`:""));
    if (d.pop!=null && d.pop>=20) bits.push(`${Math.round(d.pop)}% rain`); else if (d.rain>=0.1) bits.push(`rain ${d.rain.toFixed(1)} mm/h`);
    if (bits.length) labels+=`<text x="12" y="61" font-size="10.5" fill="#fff" opacity=".95">${bits.join(" · ")}</text>`; }
  if (d.storm){ const y=(isDay && d.uv!=null && d.uv>=0.5)?81:60, w=76;
    labels+=`<rect x="${W-10-w}" y="${y}" width="${w}" height="17" rx="8.5" fill="#e0504a"/><text x="${W-10-w/2}" y="${y+12}" text-anchor="middle" font-size="10" font-weight="800" fill="#fff">⚡ STORMS</text>`; }
  { const cx=W-30, cy=30, r=20, a=rad(d.windFrom), x0=cx+r*Math.sin(a), y0=cy-r*Math.cos(a), x1=cx-r*0.8*Math.sin(a), y1=cy+r*0.8*Math.cos(a);
    const sa=rad(d.shore+90), lx=-3*Math.sin(rad(d.shore)), ly=3*Math.cos(rad(d.shore));   // shoreline, nudged toward land
    labels+=`<circle cx="${cx}" cy="${cy}" r="${r+3}" fill="rgba(11,23,36,.55)"/>
      <line x1="${(cx+lx+r*Math.sin(sa)).toFixed(1)}" y1="${(cy+ly-r*Math.cos(sa)).toFixed(1)}" x2="${(cx+lx-r*Math.sin(sa)).toFixed(1)}" y2="${(cy+ly+r*Math.cos(sa)).toFixed(1)}" stroke="#dcc89a" stroke-width="2"/>
      <text x="${cx}" y="${cy-r+9}" text-anchor="middle" font-size="7.5" font-weight="700" fill="#ff8f8f">N</text>${arrow(x0,y0,x1,y1,4,windColor(d.wind))}`; }
  const waveTxt = d.wave==null ? "waves —" : `${d.wave.toFixed(1)}<tspan font-size="12" font-weight="600"> ft</tspan><tspan font-size="10.5" font-weight="500"> waves · ${Math.round(d.period||0)}s${d.sst!=null?` · ${Math.round(d.sst)}°F`:""}</tspan>`;
  labels+=`<text x="${W-12}" y="${(waterY-hpx-14).toFixed(1)}" text-anchor="end" font-size="22" font-weight="800" fill="#fff">${waveTxt}</text>`;
  if (tide) labels+=`<text x="12" y="${H-28}" font-size="10" font-weight="700" letter-spacing=".06em" fill="${isDay?"#7a6538":"#d9cba8"}">TIDE</text>
    <text x="12" y="${H-11}" font-size="16" font-weight="800" fill="${isDay?"#3d321c":"#f4ead2"}">${tide.v.toFixed(1)}′ ${tide.rising?"↑ rising":"↓ falling"}</text>`;

  // fishing strip: every hour of the selected day; tap a bar to jump to that hour
  const n=d.scores.length, sy=H+20, gx=94, bw=(W-gx-8)/n, maxH=46, now=d.cur;
  let best=-1; d.scores.forEach((v,k)=>{ if ((!d.starOk||d.starOk[k]) && (best<0||v>d.scores[best])) best=k; });   // best hour still ahead, within fishing hours
  let strip=`<text x="12" y="${sy+26}" font-size="30" font-weight="800" fill="${fishColor(score)}">${score}</text>
    <text x="12" y="${sy+44}" font-size="11" font-weight="700" fill="${fishColor(score)}">${fishLabel(score).toUpperCase()} ${d.isNow?"NOW":"AT "+d.curLabel.toUpperCase()}</text>
    <text x="12" y="${sy+59}" font-size="10" fill="#8aa4bf">fishing score</text>`;
  d.scores.forEach((v,k)=>{ const x=gx+k*bw, bh=Math.max(2,v/100*maxH);
    strip+=`<rect x="${x.toFixed(1)}" y="${(sy+maxH-bh).toFixed(1)}" width="${(bw-2.5).toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${fishColor(v)}" opacity="${k===now?1:.75}"/>`; });
  const cxOf=k=>gx+k*bw+(bw-2.5)/2, nx=cxOf(now), bx=cxOf(best), sty = best===now ? sy-8 : sy+maxH-d.scores[best]/100*maxH-4;
  strip+=`<rect x="${(gx+now*bw-2).toFixed(1)}" y="${sy-4}" width="${(bw+1.5).toFixed(1)}" height="${maxH+8}" rx="3" fill="none" stroke="#fff" stroke-width="1.5"/>`;
  if (best>=0) strip+=`<text x="${bx.toFixed(1)}" y="${sty.toFixed(1)}" text-anchor="middle" font-size="10" fill="#ffe08a">★</text>
    <text x="${(best>=now? bx+(best===now?9:7) : bx-7).toFixed(1)}" y="${sty.toFixed(1)}" text-anchor="${best>=now?"start":"end"}" font-size="9.5" font-weight="700" fill="#ffe08a">best ${d.hourLabels[best]}</text>`;
  [[0,"start"],[Math.round(n/2),"middle"],[n,"end"]].forEach(([k,anc])=>{ if (Math.abs(k-now)>2.5 && Math.abs(k-1-now)>1.5)
    strip+=`<text x="${(k===n?gx+n*bw-2:gx+k*bw).toFixed(1)}" y="${sy+maxH+13}" text-anchor="${anc}" font-size="9" fill="#8aa4bf">${k===Math.round(n/2)?"12p":"12a"}</text>`; });
  strip+=`<text x="${nx.toFixed(1)}" y="${sy+maxH+13}" text-anchor="middle" font-size="9" font-weight="700" fill="#fff">${d.isNow?"now":d.curLabel}</text>`;
  for (let k=0;k<n;k++) strip+=`<rect data-k="${k}" x="${(gx+k*bw).toFixed(1)}" y="${sy-10}" width="${bw.toFixed(1)}" height="${maxH+28}" fill="transparent"/>`;

  svg.setAttribute("viewBox", `0 0 ${W} 348`);
  svg.innerHTML = `<defs>
      <linearGradient id="${id}Sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset="1" stop-color="${sky[1]}"/></linearGradient>
      <linearGradient id="${id}SeaG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${isDay?"#2f8fc8":"#1d5a86"}"/><stop offset="1" stop-color="#0b2a48"/></linearGradient>
      <linearGradient id="${id}Beam" gradientUnits="userSpaceOnUse" x1="6" y1="-55" x2="88" y2="-26"><stop offset="0" stop-color="#fff6c8" stop-opacity=".3"/><stop offset=".4" stop-color="#fff6c8" stop-opacity=".14"/><stop offset="1" stop-color="#fff6c8" stop-opacity="0"/></linearGradient>
      <radialGradient id="${id}Glow"><stop offset="0" stop-color="#fff6dc" stop-opacity=".55"/><stop offset="1" stop-color="#fff6dc" stop-opacity="0"/></radialGradient>
      <linearGradient id="${id}Deck" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${isDay?"#8d97a3":"#1a222d"}"/><stop offset="1" stop-color="${isDay?"#a7b0ba":"#232c38"}"/></linearGradient>
      <clipPath id="${id}Clip"><rect width="${W}" height="${H}" rx="12"/></clipPath>
      <clipPath id="${id}Water"><path id="${id}WaterPath" d=""/></clipPath></defs>
    <g class="scene" clip-path="url(#${id}Clip)">${skyL}<g id="${id}Clouds"></g>${glowL}<g id="${id}Wind"></g><g id="${id}Sea"></g>
    <g clip-path="url(#${id}Water)"><g id="${id}Fish"></g></g><g id="${id}Jump"></g>${sand}<g id="${id}Rain"></g>${labels}</g>${strip}`;
  svg.onclick = e => { const r=e.target.closest("[data-k]"); if (r && onPick) onPick(+r.dataset.k); };

  const fishSpots=[...Array(5)].map((_,i)=>{ const fy=lerp(waterY+Math.max(14,hpx*0.25), H-16, frac(i*0.382+0.21));
    return {fx:lerp(edgeX(fy)+22, W-18, frac(i*0.618+0.13)), fy, ph:i*1.7}; });
  const clouds=[...Array(overcast?3:Math.round(cover*6))].map((_,i)=>({x:frac(i*0.47+0.1)*W, y:22+frac(i*0.33)*60, s:0.8+frac(i*0.71)*0.6}));
  S = { svg, d, isDay, overcast, waterY, wx, hpx, lam, wdir, score, nFish, fishSpots, clouds,
        cloudFill: isDay? mix("#ffffff","#8e98a5",cover) : "#2c3646",
        g: k => svg.querySelector("#"+id+k), wp: svg.querySelector("#"+id+"WaterPath") };
  draw(0);
  if (io && watched!==svg){ io.disconnect(); io.observe(svg); watched = svg; }
  if (!reduceMotion && !raf) raf = requestAnimationFrame(loop);
}

function loop(ms){
  raf = 0;
  if (!S || !onScreen || !document.body.contains(S.svg)) return;
  if (ms-lastDraw > 33){ lastDraw = ms; draw(ms/1000); }   // ~30 fps is plenty and easier on the battery
  raf = requestAnimationFrame(loop);
}

function draw(t){
  const {d, waterY, wx, hpx, lam, wdir, score, nFish, isDay} = S, period=d.period||6, phase=t/period;
  // sea surface: crests roll toward shore at the real wave period
  let top=`M${wx.toFixed(1)} ${waterY.toFixed(1)}`;
  for(let x=wx;x<=W+2;x+=3){ const k=(x-wx)/lam+phase, sh=Math.min(1,(x-wx)/40);
    top+=` L${x.toFixed(1)} ${(waterY - hpx*sh*Math.pow(0.5+0.5*Math.cos(2*Math.PI*(k-0.75)),1.5)).toFixed(1)}`; }
  const body=`${top} L${W+2} ${H} L${wx.toFixed(1)} ${H} Z`;
  let sea=`<path d="${body}" fill="url(#heroSeaG)"/><path d="${top}" fill="none" stroke="#d8f0ff" stroke-width="2"/>`;
  if (d.wind>=15 && hpx>8) for(let n=-1;n<6;n++){ const x=wx+lam*(0.75+n-frac(phase)); if(x>wx+30&&x<W-6) sea+=`<path d="M${(x-8).toFixed(1)} ${(waterY-hpx*0.82+3).toFixed(1)} q8 -7 16 0" stroke="#fff" stroke-width="2.5" fill="none" opacity=".9"/>`; }
  const sw=3*Math.sin(t*2*Math.PI/period); sea+=`<path d="M${(wx-4+sw).toFixed(1)} ${waterY.toFixed(1)} q10 -5 22 0 t22 0" stroke="#fff" stroke-width="2.5" fill="none" opacity=".85"/>`;
  S.g("Sea").innerHTML=sea; S.wp.setAttribute("d", body);
  // fish drift and turn to face the way they swim
  let f=""; for(let i=0;i<nFish;i++){ const p=S.fishSpots[i], u=t/2.6+p.ph; f+=fishAt(p.fx+12*Math.sin(u), p.fy+2*Math.sin(t/1.3+i*2), Math.cos(u)>=0?1:-1, fishColor(score)); }
  S.g("Fish").innerHTML=f;
  // a fish jumps every few seconds when it's Great
  let j=""; if (score>=80){ const c=t%4.2, jx0=Math.min(W-60, wx+lam*1.6), base=waterY-hpx*0.2;
    if (c<1.1){ const q=c/1.1; j=`<g transform="translate(${(jx0+q*34).toFixed(1)} ${(base-Math.sin(Math.PI*q)*34).toFixed(1)}) rotate(${(-60+120*q).toFixed(0)}) scale(1.2)" fill="${fishColor(score)}">${FISH}</g>`; }
    else if (c<1.8){ const r=(c-1.1)*22; j=`<ellipse cx="${jx0+34}" cy="${base+2}" rx="${r.toFixed(1)}" ry="${(r*0.3).toFixed(1)}" fill="none" stroke="#fff" stroke-width="1.5" opacity="${(1-(c-1.1)/0.7).toFixed(2)}"/>`; } }
  S.g("Jump").innerHTML=j;
  // wind streaks flow with the wind; more and faster when stronger
  const n=Math.max(1,Math.min(5,Math.round(d.wind/6))), len=34+d.wind*2.6, spd=18+d.wind*4.5, span=W+len;
  let w=""; for(let i=0;i<n;i++){ const y=90+i*13, pos=frac((t*spd+i*97)/span)*span, x0= wdir<0 ? W+len/2-pos : -len/2+pos;
    w+=arrow(x0,y,x0+wdir*len,y,3+d.wind/9,windColor(d.wind),Math.max(0,Math.min(1,pos/60,(span-pos)/60))); }
  S.g("Wind").innerHTML=w;
  let cl="";
  if (S.overcast){ const off=frac(wdir*t*(1.5+d.wind*0.2)/60)*60;
    cl+=`<rect x="0" y="0" width="${W}" height="92" fill="url(#heroDeck)"/><g fill="url(#heroDeck)">`;
    for(let x=-60+off;x<W+60;x+=30) cl+=`<ellipse cx="${x.toFixed(1)}" cy="${(92+6*Math.sin(x*0.13)).toFixed(1)}" rx="24" ry="${(12+5*frac(x*0.071)).toFixed(1)}"/>`;
    cl+=`</g>`; }
  S.clouds.forEach(c=>{ const x=frac((c.x+wdir*t*(2+d.wind*0.3))/(W+80))*(W+80)-40;
    cl+=`<g transform="translate(${x.toFixed(1)} ${c.y.toFixed(1)}) scale(${c.s.toFixed(2)})" fill="${S.cloudFill}" opacity="${isDay?.92:.8}"><ellipse cx="0" cy="0" rx="22" ry="9"/><circle cx="-8" cy="-6" r="9"/><circle cx="6" cy="-9" r="11"/></g>`; });
  S.g("Clouds").innerHTML=cl;
  let r=""; if (d.rain>=0.1){ const drops=Math.min(70, Math.round(d.rain*80)), slant=wdir*d.wind*0.35;
    for(let i=0;i<drops;i++){ const x=frac(i*0.618)*(W+40)-20, y=frac(t*1.4+i*0.137)*(H+20)-10; r+=`<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x+slant*0.4).toFixed(1)}" y2="${(y+9).toFixed(1)}" stroke="#dbe9f7" stroke-width="1" opacity=".55"/>`; } }
  S.g("Rain").innerHTML=r;
}

window.Hero = { render };
})();
