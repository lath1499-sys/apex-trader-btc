import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";

// ── API endpoints ──────────────────────────────────────────
const B_SPOT  = "https://api.binance.com";
const B_FUT   = "https://fapi.binance.com";
const FG_API  = "https://api.alternative.me/fng/";
const CLAUDE  = "https://api.anthropic.com/v1/messages";
const MEMPOOL = "https://mempool.space/api";
const BLOCKCHAIR = "https://api.blockchair.com/bitcoin/stats";
const BYBIT   = "https://api.bybit.com";
const KRAKEN  = "https://api.kraken.com/0/public";

const NEWS_SOURCES = [
  {name:"CoinTelegraph", url:"https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fcointelegraph.com%2Frss&count=12"},
  {name:"CoinDesk",      url:"https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Ffeeds.feedburner.com%2FCoinDesk&count=10"},
  {name:"BTC Magazine",  url:"https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fbitcoinmagazine.com%2Ffeed&count=8"},
  {name:"Decrypt",       url:"https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fdecrypt.co%2Ffeed&count=8"},
  {name:"The Block",     url:"https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fwww.theblock.co%2Frss.xml&count=8"},
  {name:"Blockworks",    url:"https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fblockworks.co%2Ffeed&count=6"},
  {name:"NewsBTC",       url:"https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fwww.newsbtc.com%2Ffeed&count=6"},
];

// ── Themes ─────────────────────────────────────────────────
const THEMES = {
  terminal:    { bg:"#030703", card:"#070d07", border:"#0f1f0f", text:"#b0c8b0", textSec:"#5a8a5a", accent:"#00d084", danger:"#ff4757", warn:"#ffd700", price:"#f7931a", muted:"#1e4a1e", bull:"#00d084", bear:"#ff4757" },
  white:       { bg:"#f0f4f8", card:"#ffffff", border:"#e2e8f0", text:"#1e293b", textSec:"#64748b", accent:"#16a34a", danger:"#ef4444", warn:"#d97706", price:"#ea580c", muted:"#94a3b8", bull:"#16a34a", bear:"#ef4444" },
  midnight:    { bg:"#07071a", card:"#0f0f2e", border:"#1a1a45", text:"#c8d8ff", textSec:"#5a6a9a", accent:"#7b9fff", danger:"#ff6b9d", warn:"#fbbf24", price:"#f7931a", muted:"#2a3a7a", bull:"#7b9fff", bear:"#ff6b9d" },
  amber:       { bg:"#0d0800", card:"#1a1200", border:"#2a2000", text:"#fde68a", textSec:"#a16207", accent:"#f7931a", danger:"#ef4444", warn:"#ffd700", price:"#ffd700", muted:"#78350f", bull:"#f7931a", bear:"#ef4444" },
  tradingview: { bg:"#131722", card:"#1e222d", border:"#2a2e39", text:"#d1d4dc", textSec:"#787b86", accent:"#2962ff", danger:"#f23645", warn:"#ff9800", price:"#f7931a", muted:"#363c4e", bull:"#26a69a", bear:"#ef5350" },
  white:       { bg:"#f0f2f5", card:"#ffffff", border:"#e2e8f0", text:"#1e293b", textSec:"#64748b", accent:"#16a34a", danger:"#ef4444", warn:"#f59e0b", price:"#ea580c", muted:"#94a3b8", bull:"#16a34a", bear:"#ef4444" },
  midnight:    { bg:"#070714", card:"#0f0f28", border:"#1a1a42", text:"#c8d8ff", textSec:"#5a6a9a", accent:"#7b9fff", danger:"#ff6b9d", warn:"#fbbf24", price:"#f7931a", muted:"#2a3a6a", bull:"#7b9fff", bear:"#ff6b9d" },
  amber:       { bg:"#0d0800", card:"#1a1200", border:"#2a2000", text:"#fde68a", textSec:"#a16207", accent:"#f7931a", danger:"#ef4444", warn:"#ffd700", price:"#ffd700", muted:"#78350f", bull:"#f7931a", bear:"#ef4444" },
  tradingview: { bg:"#131722", card:"#1e222d", border:"#2a2e39", text:"#d1d4dc", textSec:"#787b86", accent:"#2962ff", danger:"#f23645", warn:"#ff9800", price:"#f7931a", muted:"#363c4e", bull:"#26a69a", bear:"#ef5350" },
};

// ── Indicator Engine ───────────────────────────────────────
const ema = (d,p) => { const k=2/(p+1),r=[d[0]]; for(let i=1;i<d.length;i++) r.push(d[i]*k+r[i-1]*(1-k)); return r; };
const sma = (d,p) => d.map((_,i) => i<p-1?null:d.slice(i-p+1,i+1).reduce((a,b)=>a+b,0)/p);

function calcRSI(c,p=14) {
  const r=new Array(c.length).fill(null); let ag=0,al=0;
  for(let i=1;i<=p;i++){const d=c[i]-c[i-1];d>0?ag+=d:al-=d;}
  ag/=p;al/=p; r[p]=al===0?100:100-100/(1+ag/al);
  for(let i=p+1;i<c.length;i++){const d=c[i]-c[i-1];ag=(ag*(p-1)+Math.max(d,0))/p;al=(al*(p-1)+Math.max(-d,0))/p;r[i]=al===0?100:100-100/(1+ag/al);}
  return r;
}
function calcMACD(c,f=12,s=26,sg=9){const ef=ema(c,f),es=ema(c,s),ml=ef.map((v,i)=>v-es[i]),sl=ema(ml,sg);return{macd:ml,signal:sl,hist:ml.map((v,i)=>v-sl[i])};}
function calcBB(c,p=20,m=2){const sm=sma(c,p);return c.map((_,i)=>{if(i<p-1)return{upper:null,mid:null,lower:null,width:null};const sl=c.slice(i-p+1,i+1),mn=sm[i],std=Math.sqrt(sl.reduce((a,v)=>a+(v-mn)**2,0)/p);return{upper:mn+m*std,mid:mn,lower:mn-m*std,width:(m*2*std/mn)*100};});}
function calcATR(h,l,c,p=14){const tr=h.map((hh,i)=>i===0?hh-l[i]:Math.max(hh-l[i],Math.abs(hh-c[i-1]),Math.abs(l[i]-c[i-1])));return ema(tr,p);}
function calcStoch(c,rp=14,sp=14,kp=3,dp=3){const rv=calcRSI(c,rp);const st=rv.map((_,i)=>{if(i<rp+sp-1)return null;const w=rv.slice(i-sp+1,i+1).filter(v=>v!=null);const mn=Math.min(...w),mx=Math.max(...w);return mx===mn?50:((rv[i]-mn)/(mx-mn))*100;});const kr=st.map((_,i)=>{if(i<kp-1)return null;const w=st.slice(i-kp+1,i+1).filter(v=>v!=null);return w.length?w.reduce((a,b)=>a+b,0)/w.length:null;});const dr=kr.map((_,i)=>{if(i<dp-1)return null;const w=kr.slice(i-dp+1,i+1).filter(v=>v!=null);return w.length?w.reduce((a,b)=>a+b,0)/w.length:null;});return{k:kr,d:dr};}
function calcFib(h,l,c){const n=Math.min(60,h.length),sh=Math.max(...h.slice(-n)),sl=Math.min(...l.slice(-n)),rng=sh-sl,price=c[c.length-1],up=price>(sh+sl)/2;return[0,0.236,0.382,0.5,0.618,0.786,1.0,1.272,1.414,1.618].map(lv=>({level:lv,price:up?sh-rng*lv:sl+rng*lv,label:lv===0?"SwingH":lv===1.0?"SwingL":`${(lv*100).toFixed(1)}%`,isExt:lv>1.0,active:Math.abs(price-(up?sh-rng*lv:sl+rng*lv))/price<0.015}));}

function runInds(klines) {
  if (!klines||klines.length<30) return null;
  const c=klines.map(k=>k.c),h=klines.map(k=>k.h),l=klines.map(k=>k.l),v=klines.map(k=>k.v),last=c[c.length-1];
  const e9=ema(c,9),e21=ema(c,21),e50=ema(c,50),e100=ema(c,100),e200=ema(c,200);
  const rA=calcRSI(c),mR=calcMACD(c),bA=calcBB(c),aA=calcATR(h,l,c),sR=calcStoch(c);
  const bb=bA[bA.length-1],mh=mR.hist[mR.hist.length-1],mp=mR.hist[mR.hist.length-2];
  const rV=rA[rA.length-1],sk=sR.k[sR.k.length-1];
  const bbp=bb.upper&&bb.lower?((last-bb.lower)/(bb.upper-bb.lower))*100:null;
  let sc=0;
  if(last>e9[e9.length-1])sc++;else sc--;if(last>e21[e21.length-1])sc++;else sc--;
  if(last>e50[e50.length-1])sc++;else sc--;if(last>e200[e200.length-1])sc++;else sc--;
  if(rV>50)sc++;else sc--;if(mh>0)sc++;else sc--;if(mh>mp)sc++;else sc--;
  if(bbp>50)sc++;else sc--;if(sk>50)sc++;else sc--;
  const avgV=v.slice(-20).reduce((a,b)=>a+b,0)/20;
  return{
    close:last,rsi:rV,
    macd:{line:mR.macd[mR.macd.length-1],signal:mR.signal[mR.signal.length-1],hist:mh,prev:mp},
    bb:{...bb,pct:bbp},atr:aA[aA.length-1],stoch:{k:sk,d:sR.d[sR.d.length-1]},
    ema:{e9:e9[e9.length-1],e21:e21[e21.length-1],e50:e50[e50.length-1],e100:e100[e100.length-1],e200:e200[e200.length-1]},
    fib:calcFib(h,l,c),vol:{avg:avgV,last:v[v.length-1],ratio:v[v.length-1]/avgV,surge:v[v.length-1]>avgV*1.5},
    score:sc,bias:sc>=4?"ALCISTA":sc<=-4?"BAJISTA":"NEUTRAL",
    klines
  };
}

// ── BTC Cycle ──────────────────────────────────────────────
function getBTCCycle(price) {
  const now=new Date(), lastH=new Date("2024-04-19"), nextH=new Date("2028-04-15");
  const days=Math.floor((now-lastH)/864e5), toNext=Math.floor((nextH-now)/864e5);
  const pct=Math.min(100,(days/1460)*100);
  const phase=pct<10?"Acumulación Post-Halving":pct<35?"Impulso Temprano":pct<55?"Bull Market Principal":pct<70?"Euforia / Techo":pct<85?"Corrección Mayor":"Bear / Pre-Halving";
  const col=pct<10?"#8ab0aa":pct<35?"#7bed9f":pct<55?"#00d084":pct<70?"#ffd700":pct<85?"#ff8c00":"#ff4757";
  const dsg=Math.floor((now-new Date("2009-01-03"))/864e5);
  const lFV=Math.pow(10,-17.01+5.84*Math.log10(dsg)), mvrv=price/lFV;
  return{phase,col,pct,days,toNext,mvrv};
}

// ── Sessions ───────────────────────────────────────────────
const SESS=[{n:"ASIA",s:0,e:9,c:"#4a8aaa"},{n:"FRANKFURT",s:7,e:10,c:"#8a6aaa"},{n:"LONDON",s:8,e:17,c:"#4aaa6a"},{n:"NY OPEN",s:13,e:17,c:"#aaa44a"},{n:"NY",s:17,e:22,c:"#aa6a4a"},{n:"CIERRE",s:22,e:24,c:"#5a5a6a"}];
const getSession=()=>{const h=new Date().getUTCHours()+new Date().getUTCMinutes()/60;return SESS.find(s=>h>=s.s&&h<s.e)||SESS[5];};

// ── Helpers ────────────────────────────────────────────────
const fmt=(n,d=2)=>n!=null?Number(n).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d}):"—";
const fmtB=n=>{if(!n)return"—";if(n>=1e9)return`$${(n/1e9).toFixed(2)}B`;if(n>=1e6)return`$${(n/1e6).toFixed(2)}M`;return`$${fmt(n)}`;};
const safe=async fn=>{try{return await fn();}catch{return null;}};
const pct=(a,b)=>a&&b?((a-b)/b*100).toFixed(2):null;
const bCol=(b,T)=>b==="ALCISTA"?T.bull:b==="BAJISTA"?T.bear:T.warn;
const rCol=(r,T)=>{if(r==null)return T.muted;if(r>=70)return T.danger;if(r>=60)return T.warn;if(r<=30)return T.bull;if(r<=40)return"#7bed9f";return T.warn;};
const TFS=["1d","4h","1h","15m"],TFLBL={"1d":"1D","4h":"4H","1h":"1H","15m":"15M"},TFLIM={"1d":300,"4h":300,"1h":150,"15m":150};

// ── Image compression ──────────────────────────────────────
const compressImg=(b64)=>new Promise(resolve=>{
  const img=new Image();
  img.onload=()=>{
    const MAX=700,ratio=Math.min(MAX/img.width,MAX/img.height,1);
    const cv=document.createElement("canvas");
    cv.width=Math.round(img.width*ratio); cv.height=Math.round(img.height*ratio);
    cv.getContext("2d").drawImage(img,0,0,cv.width,cv.height);
    resolve(cv.toDataURL("image/jpeg",0.55).split(",")[1]);
  };
  img.onerror=()=>resolve(b64);
  img.src="data:image/png;base64,"+b64;
});

// ── Build compact context ──────────────────────────────────
function buildCtx(mkt,inds,onchain,cycle,news) {
  const I=inds,i4=I["4h"],i1=I["1h"],i1d=I["1d"];
  const fi=(i)=>i?`${i.bias}(${i.score}/9)RSI:${fmt(i.rsi,0)}MACD:${i.macd.hist>0?"↑":"↓"}BB%B:${fmt(i.bb.pct,0)}${i.bb.width<1.5?"SQZ":""}SK:${fmt(i.stoch.k,0)}EMA50:${mkt.price>i.ema.e50?"↑":"↓"}EMA200:${mkt.price>i.ema.e200?"↑":"↓"}`:"N/A";
  const nf=i4?.fib?.find(f=>f.active);
  const lines=[
    `BTC:$${fmt(mkt.price,0)} ${mkt.change>=0?"+":""}${fmt(mkt.change)}% Sesión:${getSession().n}`,
    `Funding:${mkt.funding!=null?(mkt.funding>0?"+":"")+fmt(mkt.funding,4)+"%":"N/A"} OI:${mkt.oi?fmtB(mkt.oi*mkt.price):"N/A"} L/S:${mkt.lsr?fmt(mkt.lsr,2):"N/A"} F&G:${mkt.fg??"-"}/100`,
    `1D:${fi(i1d)} 4H:${fi(i4)} 1H:${fi(i1)}`,
    `FibActivo:${nf?nf.label+"$"+fmt(nf.price,0):"ninguno"}`,
    `OnChain:HR:${onchain?.hr?onchain.hr+"EH":"N/A"} Mem:${onchain?.mempool??"-"}tx Fee:${onchain?.fee??"-"}sat`,
    `Ciclo:${cycle?.phase??"N/A"} ${cycle?.pct?.toFixed(0)??"-"}% MVRV:${cycle?.mvrv?.toFixed(1)??"-"}`,
  ];
  if(news?.length){
    const bull=(news||[]).filter(n=>n.tag==="bullish").length;
    const bear=(news||[]).filter(n=>n.tag==="bearish").length;
    const macro=(news||[]).filter(n=>n.tag==="macro").length;
    const top3=(news||[]).slice(0,3).map(n=>n.title?.slice(0,60)).join(" | ");
    lines.push(`News:Bull:${bull} Bear:${bear} Macro:${macro} | ${top3}`);
  }
  return lines.join("\n");
}

// ── Auto alerts ────────────────────────────────────────────
function getAlerts(mkt,inds) {
  const a=[];
  const p=(lvl,icon,msg,tf)=>a.push({lvl,icon,msg,tf});
  if(mkt.funding>0.05) p("danger","🔴",`Funding +${fmt(mkt.funding,4)}% — Longs sobreextendidos`,"DERIV");
  if(mkt.funding<-0.02) p("good","🟢",`Funding ${fmt(mkt.funding,4)}% — Favorable longs`,"DERIV");
  if(mkt.lsr>1.7) p("danger","⚠️",`L/S ${fmt(mkt.lsr,2)} — Exceso longs`,"DERIV");
  if(mkt.lsr<0.6) p("good","⚠️",`L/S ${fmt(mkt.lsr,2)} — Posible squeeze`,"DERIV");
  if(mkt.fg<20) p("good","😱",`Miedo Extremo ${mkt.fg}/100`,"SENT");
  if(mkt.fg>80) p("danger","🤑",`Codicia Extrema ${mkt.fg}/100`,"SENT");
  for(const tf of TFS){const i=inds[tf];if(!i)continue;const L=TFLBL[tf];
    if(i.rsi>=72) p("danger","📊",`RSI ${fmt(i.rsi,0)} Sobrecompra ${L}`,L);
    if(i.rsi<=28) p("good","📊",`RSI ${fmt(i.rsi,0)} Sobreventa ${L}`,L);
    if(i.bb.width<1.3) p("warn","⚡",`BB Squeeze ${L} — Breakout próximo`,L);
    if(i.macd.hist>0&&i.macd.prev<=0) p("good","📈",`MACD cruzó alcista ${L}`,L);
    if(i.macd.hist<0&&i.macd.prev>=0) p("danger","📉",`MACD cruzó bajista ${L}`,L);
    if(i.stoch.k>85) p("danger","⚡",`StochRSI K=${fmt(i.stoch.k,0)} OB ${L}`,L);
    if(i.stoch.k<15) p("good","⚡",`StochRSI K=${fmt(i.stoch.k,0)} OS ${L}`,L);
    if(i.vol.surge) p("warn","📊",`Vol spike ${fmt(i.vol.ratio,1)}x en ${L}`,L);
  }
  return a;
}

// ── Candlestick Chart (Canvas) ─────────────────────────────
function CandleChart({ klines, theme: T, tf, onTfChange }) {
  const ref=useRef();
  useEffect(()=>{
    const cv=ref.current; if(!cv||!klines?.length) return;
    const ctx=cv.getContext("2d");
    const W=cv.offsetWidth, H=220;
    cv.width=W; cv.height=H;
    const data=klines.slice(-80);
    const highs=data.map(k=>k.h),lows=data.map(k=>k.l);
    const mn=Math.min(...lows)*0.9985, mx=Math.max(...highs)*1.0015;
    const toY=p=>H-((p-mn)/(mx-mn))*H;
    const cW=Math.max(2,Math.floor(W/data.length)-1);
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle=T.card; ctx.fillRect(0,0,W,H);
    // Grid
    [0.25,0.5,0.75].forEach(p=>{
      const y=H*p; ctx.strokeStyle=T.border+"88"; ctx.lineWidth=0.5;
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke();
      const price=mx-(mx-mn)*p;
      ctx.fillStyle=T.textSec; ctx.font="9px monospace"; ctx.fillText("$"+Math.round(price).toLocaleString(),4,y-2);
    });
    data.forEach((k,i)=>{
      const x=i*(cW+1)+1, bull=k.c>=k.o;
      const top=Math.min(k.o,k.c), bot=Math.max(k.o,k.c);
      ctx.strokeStyle=bull?T.bull:T.bear; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(x+cW/2,toY(k.h)); ctx.lineTo(x+cW/2,toY(k.l)); ctx.stroke();
      ctx.fillStyle=bull?T.bull:T.bear;
      const bH=Math.max(1,Math.abs(toY(top)-toY(bot)));
      ctx.fillRect(x,toY(bot),cW,bH);
    });
  },[klines,T]);
  return (
    <div style={{position:"relative"}}>
      <div style={{display:"flex",gap:4,marginBottom:6,flexWrap:"wrap"}}>
        {TFS.map(t=>(
          <button key={t} onClick={()=>onTfChange(t)} style={{
            background:tf===t?T.accent+"33":"transparent",border:`1px solid ${tf===t?T.accent:T.border}`,
            color:tf===t?T.accent:T.textSec,padding:"3px 10px",borderRadius:4,cursor:"pointer",
            fontFamily:"inherit",fontSize:9,letterSpacing:".1em"
          }}>{TFLBL[t]}</button>
        ))}
      </div>
      <canvas ref={ref} style={{width:"100%",display:"block",borderRadius:4}} />
    </div>
  );
}

// ── VPVR ───────────────────────────────────────────────────
function calcVPVR(klines,buckets=20) {
  if(!klines?.length) return null;
  const mn=Math.min(...klines.map(k=>k.l)),mx=Math.max(...klines.map(k=>k.h));
  const step=(mx-mn)/buckets;
  const prof=Array.from({length:buckets},(_,i)=>({pl:mn+(i+0.5)*step,ph:mn+(i+1)*step,vol:0}));
  for(const k of klines){const tp=(k.h+k.l+k.c)/3,idx=Math.min(Math.floor((tp-mn)/step),buckets-1);if(idx>=0)prof[idx].vol+=k.v;}
  const maxV=Math.max(...prof.map(p=>p.vol));
  const sorted=[...prof].sort((a,b)=>b.vol-a.vol);
  const poc=sorted[0];
  let cum=0,tot=prof.reduce((a,p)=>a+p.vol,0),vaSet=new Set();
  for(const p of sorted){vaSet.add(p.pl);cum+=p.vol;if(cum>=tot*0.7)break;}
  const va=prof.filter(p=>vaSet.has(p.pl));
  const vah=Math.max(...va.map(p=>p.ph)),val=Math.min(...va.map(p=>p.pl-step));
  return{prof,poc,vah,val,maxV,mn,mx};
}

// ── Heatmap ────────────────────────────────────────────────
function LiqHeatmap({ price, theme: T }) {
  const [cursorPrice, setCursorPrice] = useState(null);
  if(!price) return null;
  const levs=[2,3,5,10,15,20,25,50,100];
  const range=price*0.30;
  const mn=price-range,mx=price+range,steps=30;
  const step=(mx-mn)/steps;
  const bars=Array.from({length:steps},(_,i)=>{
    const lo=mn+i*step,hi=lo+step,mid=(lo+hi)/2;
    let longLiq=0,shortLiq=0;
    levs.forEach(lv=>{
      const lp=price*(1-1/lv),sp=price*(1+1/lv);
      const w=1/lv; // weight by leverage (higher lev = more likely)
      if(lp>=lo&&lp<hi) longLiq+=w*100;
      if(sp>=lo&&sp<hi) shortLiq+=w*100;
    });
    return{lo,hi,mid,longLiq,shortLiq,total:longLiq+shortLiq};
  });
  const maxT=Math.max(...bars.map(b=>b.total),1);
  const toY=(p)=>((p-mn)/(mx-mn))*100;
  return (
    <div>
      <div style={{position:"relative",height:360,background:T.card,borderRadius:8,overflow:"hidden",marginBottom:12,border:`1px solid ${T.border}`,cursor:"crosshair"}}
        onMouseMove={e=>{const r=e.currentTarget.getBoundingClientRect();setCursorPrice(mn+(1-(e.clientY-r.top)/r.height)*(mx-mn));}}
        onMouseLeave={()=>setCursorPrice(null)}>
        {bars.map((b,i)=>{
          const y=100-toY(b.hi),h=toY(b.hi)-toY(b.lo);
          const lW=(b.longLiq/maxT)*45, sW=(b.shortLiq/maxT)*45;
          const isPrice=price>=b.lo&&price<b.hi;
          return(
            <div key={i} style={{position:"absolute",left:0,right:0,top:`${y}%`,height:`${h}%`,display:"flex",alignItems:"center"}}>
              {isPrice&&<div style={{position:"absolute",left:0,right:0,height:2,background:T.text,zIndex:5,opacity:.9}}/>}
              {b.longLiq>0&&<div style={{position:"absolute",left:`${50-lW}%`,width:`${lW}%`,height:"80%",background:T.danger+"77",borderRadius:"2px 0 0 2px"}}/>}
              {b.shortLiq>0&&<div style={{position:"absolute",left:"50%",width:`${sW}%`,height:"80%",background:T.bull+"77",borderRadius:"0 2px 2px 0"}}/>}
              {isPrice&&<div style={{position:"absolute",right:4,fontSize:8,color:T.text,fontFamily:"monospace",zIndex:6,background:T.card,padding:"0 3px"}}>▶ ${fmt(price,0)}</div>}
              <div style={{position:"absolute",left:2,fontSize:7,color:T.textSec,fontFamily:"monospace"}}>${Math.round(b.mid).toLocaleString()}</div>
            </div>
          );
        })}
        <div style={{position:"absolute",left:"50%",top:0,bottom:0,width:1,background:T.border,opacity:.3}}/>
        {cursorPrice!=null&&<div style={{position:"absolute",left:0,right:0,top:`${((1-(cursorPrice-mn)/(mx-mn))*100).toFixed(1)}%`,height:1,background:T.warn,zIndex:10}}><div style={{position:"absolute",right:4,top:-13,background:T.warn,color:"#000",fontSize:9,fontFamily:"monospace",fontWeight:700,padding:"1px 6px",borderRadius:3,whiteSpace:"nowrap"}}>${Math.round(cursorPrice).toLocaleString()}</div></div>}
        <div style={{position:"absolute",bottom:2,left:0,right:0,display:"flex",justifyContent:"space-between",padding:"0 4px",fontSize:7,color:T.muted,fontFamily:"monospace"}}>
          <span>← LONGS LIQ</span><span>SHORTS LIQ →</span>
        </div>
      </div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
        {[5,10,20,50].map(lv=>(
          <div key={lv} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:5,padding:"6px 10px",flex:1,minWidth:110}}>
            <div style={{fontSize:7,color:T.textSec,letterSpacing:".1em",marginBottom:3}}>{lv}x LEVERAGE</div>
            <div style={{fontSize:10,color:T.danger}}>Long LIQ: ${fmt(price*(1-1/lv),0)}</div>
            <div style={{fontSize:10,color:T.bull}}>Short LIQ: ${fmt(price*(1+1/lv),0)}</div>
            <div style={{fontSize:8,color:T.muted}}>±{(1/lv*100).toFixed(1)}% desde precio</div>
          </div>
        ))}
      </div>
      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:6,padding:"10px 12px",fontSize:9,color:T.textSec,lineHeight:1.8}}>
        <span style={{color:T.danger}}>●</span> Zonas rojas = liquidaciones de LONGS (si precio baja a ese nivel)<br/>
        <span style={{color:T.bull}}>●</span> Zonas verdes = liquidaciones de SHORTS (si precio sube a ese nivel)<br/>
        La intensidad del color indica cuántas posiciones se liquidarían en esa zona.
      </div>
    </div>
  );
}

// ── On-Chain Panel ─────────────────────────────────────────
function OnChainPanel({ data, theme: T }) {
  const D=data;
  if(!D) return <div style={{color:T.textSec,textAlign:"center",padding:40,fontSize:11}}>Cargando datos on-chain de mempool.space...</div>;
  const metrics=[
    ["HASH RATE",D.hr?D.hr.toFixed(1)+" EH/s":"N/A",D.hr>500?"#00d084":D.hr>300?"#ffd700":"#ff4757","Poder de minería de la red"],
    ["PRÓX. DIFICULTAD",D.diffAdj!=null?(D.diffAdj>0?"+":"")+D.diffAdj.toFixed(2)+"%":"N/A",D.diffAdj>0?"#00d084":D.diffAdj<-5?"#ff4757":"#ffd700","Ajuste estimado"],
    ["BLOQUE",D.height?"#"+D.height.toLocaleString():"N/A","#8ab0aa","Altura actual de la cadena"],
    ["MEMPOOL",D.mempool?D.mempool.toLocaleString()+" tx":"N/A",D.mempool>50000?"#ff4757":D.mempool>20000?"#ffd700":"#00d084","Transacciones pendientes"],
    ["FEE LENTO",D.feeHour?D.feeHour+" sat/vB":"N/A","#5a9a5a","Confirmación ~1 hora"],
    ["FEE NORMAL",D.feeMid?D.feeMid+" sat/vB":"N/A","#ffd700","Confirmación ~30 min"],
    ["FEE RÁPIDO",D.fee?D.fee+" sat/vB":"N/A","#f7931a","Próximo bloque"],
    ["BLOCKS/24H",D.blocks24h?D.blocks24h+" bloques":"N/A","#8aaa9a","Bloques minados hoy"],
  ];
  const signals=[];
  if(D.hr>600) signals.push({c:"#00d084",t:"Hash rate en máximos → mineros confiados en precio alto. Señal alcista LT."});
  if(D.diffAdj>3) signals.push({c:"#00d084",t:"Dificultad subiendo → más mineros conectándose. Red creciendo."});
  if(D.diffAdj<-5) signals.push({c:"#ff4757",t:"Dificultad bajando → mineros apagando. Posible señal de capitulación."});
  if(D.mempool>50000) signals.push({c:"#ffd700",t:"Mempool congestionado → alta actividad on-chain. Evento significativo."});
  if(D.fee>80) signals.push({c:"#ff8c00",t:"Fees muy altos → gran demanda de transacciones. Movimiento institucional posible."});
  return (
    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:8}}>
        {metrics.map(([l,v,c,sub])=>(
          <div key={l} style={{background:T.card,border:`1px solid ${c}22`,borderRadius:7,padding:"12px 14px"}}>
            <div style={{fontSize:8,color:T.muted,letterSpacing:".14em",marginBottom:4}}>{l}</div>
            <div style={{fontSize:14,fontWeight:700,color:c}}>{v}</div>
            <div style={{fontSize:8,color:T.textSec,marginTop:3}}>{sub}</div>
          </div>
        ))}
      </div>
      {D.recentBlocks?.length>0&&(
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:7,padding:14}}>
          <div style={{fontSize:9,color:T.muted,letterSpacing:".14em",marginBottom:10}}>ÚLTIMOS BLOQUES</div>
          <div style={{display:"flex",flexDirection:"column",gap:3}}>
            {D.recentBlocks.slice(0,8).map((b,i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"5px 8px",background:T.bg,borderRadius:4,fontSize:9}}>
                <span style={{color:T.accent,fontFamily:"monospace"}}>#{(b.height||"?").toLocaleString()}</span>
                <span style={{color:T.textSec}}>{b.tx_count?.toLocaleString()||"?"} txs</span>
                <span style={{color:T.textSec}}>{b.size?Math.round(b.size/1024)+"KB":"?"}</span>
                <span style={{color:T.muted}}>{b.timestamp?new Date(b.timestamp*1000).toLocaleTimeString():""}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div style={{background:T.bg,border:`1px solid ${T.border}`,borderRadius:7,padding:14}}>
        <div style={{fontSize:9,color:T.muted,letterSpacing:".14em",marginBottom:8}}>SEÑALES ON-CHAIN → APEX</div>
        {signals.length===0
          ? <div style={{fontSize:9,color:T.textSec}}>Sin señales extremas — condiciones de red normales.</div>
          : signals.map((s,i)=><div key={i} style={{fontSize:9,color:s.c,lineHeight:1.7,marginBottom:3}}>● {s.t}</div>)
        }
        <div style={{fontSize:8,color:T.muted,marginTop:8}}>Fuente: mempool.space · Refresh cada 90s</div>
      </div>
    </div>
  );
}

// ── News Panel ─────────────────────────────────────────────
function NewsPanel({ news, session, theme: T }) {
  const [filt,setFilt]=useState("all");
  const KW={macro:["fed","rate","inflation","cpi","fomc","treasury","dollar","dxy","gdp","recession","etf","sec","regulation","powell","interest","fiscal","bonds"],bullish:["bullish","surge","rally","ath","adoption","institutional","approval","buy","accumulate","record","rise","soar","pump","inflows","breakout"],bearish:["bearish","crash","dump","sell","ban","hack","lawsuit","fear","correction","drop","fall","plunge","sink","loss","outflows"]};
  const tag=n=>{const t=((n.title||"")+" "+(n.body||"")).toLowerCase();if(KW.macro.some(k=>t.includes(k)))return"macro";if(KW.bullish.some(k=>t.includes(k)))return"bullish";if(KW.bearish.some(k=>t.includes(k)))return"bearish";return"neutral";};
  const tagged=(news||[]).map(n=>({...n,tag:tag(n)}));
  const filtered=filt==="all"?tagged:tagged.filter(n=>n.tag===filt);
  const tagC=t=>t==="macro"?T.warn:t==="bullish"?T.bull:t==="bearish"?T.danger:T.textSec;
  const ago=ts=>{if(!ts)return"";const m=Math.floor((Date.now()/1000-ts)/60);return m<60?m+"m":m<1440?Math.floor(m/60)+"h":Math.floor(m/1440)+"d";};
  const macroCount=tagged.filter(n=>n.tag==="macro").length;
  return (
    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      {macroCount>0&&(
        <div style={{background:T.warn+"11",border:`1px solid ${T.warn}33`,borderRadius:7,padding:"10px 14px"}}>
          <div style={{fontSize:9,color:T.warn,fontWeight:700,marginBottom:4}}>⚠️ {macroCount} EVENTOS MACRO ACTIVOS — SESIÓN {session?.n}</div>
          <div style={{fontSize:9,color:T.textSec,lineHeight:1.7}}>
            {session?.n==="NY OPEN"?"Máximo impacto — monitorear antes de entrar posiciones.":session?.n==="LONDON"?"Impacto alto — ajustar SLs en posiciones abiertas.":"Revisar contexto antes del próximo trade."}
          </div>
        </div>
      )}
      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
        {[["all","Todas"],["macro","🌍 Macro"],["bullish","📈 Alcista"],["bearish","📉 Bajista"],["neutral","📰 Neutral"]].map(([f,l])=>(
          <button key={f} onClick={()=>setFilt(f)} style={{
            background:filt===f?T.accent+"22":"transparent",
            border:`1px solid ${filt===f?T.accent:T.border}`,
            color:filt===f?T.accent:T.textSec,
            padding:"5px 12px",borderRadius:5,cursor:"pointer",fontFamily:"inherit",fontSize:9
          }}>{l} ({f==="all"?tagged.length:tagged.filter(n=>n.tag===f).length})</button>
        ))}
      </div>
      {filtered.length===0
        ? <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:7,padding:40,textAlign:"center",color:T.textSec,fontSize:11}}>
            {tagged.length===0?"📡 Cargando noticias de múltiples fuentes...":"Sin noticias en esta categoría"}
          </div>
        : <div style={{display:"flex",flexDirection:"column",gap:5,maxHeight:540,overflowY:"auto"}}>
            {filtered.slice(0,30).map((n,i)=>(
              <a key={i} href={n.url} target="_blank" rel="noopener noreferrer" style={{textDecoration:"none"}}>
                <div style={{padding:"10px 14px",background:T.card,border:`1px solid ${tagC(n.tag)}22`,borderRadius:7,cursor:"pointer",transition:"border-color .15s"}}>
                  <div style={{display:"flex",justifyContent:"space-between",gap:10,marginBottom:5}}>
                    <div style={{fontSize:11,color:tagC(n.tag),fontWeight:600,lineHeight:1.5,flex:1}}>{n.title}</div>
                    <span style={{fontSize:8,color:T.muted,flexShrink:0,marginTop:2}}>{ago(n.published_on)}</span>
                  </div>
                  <div style={{display:"flex",gap:6,alignItems:"center"}}>
                    <span style={{fontSize:7,padding:"2px 7px",borderRadius:3,background:tagC(n.tag)+"22",color:tagC(n.tag)}}>{n.tag.toUpperCase()}</span>
                    <span style={{fontSize:8,color:T.muted}}>{n.source_info?.name||"Crypto"}</span>
                    <span style={{fontSize:8,color:T.muted,marginLeft:"auto"}}>↗ leer</span>
                  </div>
                </div>
              </a>
            ))}
          </div>
      }
    </div>
  );
}

// ── Cycle Panel ─────────────────────────────────────────────
function CyclePanel({ cycle, theme: T }) {
  if(!cycle) return null;
  const phases=["Acumulación","Impulso","Bull","Euforia","Corrección","Bear"];
  const cols=["#8ab0aa","#7bed9f","#00d084","#ffd700","#ff8c00","#ff4757"];
  const idx=cycle.pct<10?0:cycle.pct<35?1:cycle.pct<55?2:cycle.pct<70?3:cycle.pct<85?4:5;
  const mvrvC=cycle.mvrv<1.5?T.bull:cycle.mvrv<3.5?T.warn:T.danger;
  const mvrvS=cycle.mvrv<0.8?"Subvalorado — zona acumulación":cycle.mvrv<1.5?"Precio justo — tendencia sana":cycle.mvrv<3.5?"Sobrevalorado — precaución":"Distribución histórica";
  return (
    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      <div style={{background:T.card,border:`2px solid ${cycle.col}`,borderRadius:8,padding:18}}>
        <div style={{fontSize:9,color:T.muted,letterSpacing:".14em",marginBottom:8}}>CICLO BTC — POST-HALVING #4 (ABR 2024)</div>
        <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:14}}>
          <div>
            <div style={{fontSize:20,fontWeight:800,color:cycle.col}}>{cycle.phase}</div>
            <div style={{fontSize:9,color:T.textSec,marginTop:3}}>{cycle.pct.toFixed(1)}% del ciclo completado</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:24,fontWeight:800,color:mvrvC}}>{cycle.mvrv.toFixed(2)}x</div>
            <div style={{fontSize:8,color:T.muted}}>MVRV aprox.</div>
          </div>
        </div>
        <div style={{display:"flex",height:20,borderRadius:6,overflow:"hidden",marginBottom:8}}>
          {phases.map((ph,i)=>(
            <div key={i} style={{flex:1,background:i<idx?cols[i]+"88":i===idx?cols[i]:"#0a140a",borderRight:"1px solid #060c06",display:"flex",alignItems:"center",justifyContent:"center"}}>
              <span style={{fontSize:5,color:i===idx?"#fff":"transparent",letterSpacing:".04em"}}>{ph.toUpperCase()}</span>
            </div>
          ))}
        </div>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:7,color:T.muted,marginBottom:14}}>
          <span>Halving #4 (Abr 2024)</span><span>Halving #5 (~2028)</span>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
          {[["DÍAS EN CICLO",cycle.days+" días","#8a9a8a"],["DÍAS PRÓX. H",cycle.toNext+" días","#7a9a6a"],["REWARD ACTUAL","3.125 BTC","#ffd700"],["MVRV SEÑAL",mvrvS.split(" — ")[0],mvrvC]].map(([l,v,c])=>(
            <div key={l} style={{background:T.bg,border:`1px solid ${T.border}`,borderRadius:5,padding:"8px 10px"}}>
              <div style={{fontSize:7,color:T.muted,marginBottom:3}}>{l}</div>
              <div style={{fontSize:10,color:c,fontWeight:700}}>{v}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:7,padding:14}}>
        <div style={{fontSize:9,color:T.muted,letterSpacing:".14em",marginBottom:8}}>SEÑAL DE CICLO → APEX</div>
        <div style={{fontSize:10,color:cycle.col,fontWeight:700,marginBottom:6}}>{cycle.phase}</div>
        <div style={{fontSize:9,color:T.textSec,lineHeight:1.8}}>
          {cycle.phase==="Bull Market Principal"&&"Fase más alcista. Momentum fuerte. Trend following alcista. ATHs esperados."}
          {cycle.phase==="Impulso Temprano"&&"Primeros impulsos significativos. Alta volatilidad. Longs en correcciones."}
          {cycle.phase==="Euforia / Techo"&&"Señales de distribución. Funding extremo. Reducir exposición, cautela máxima."}
          {cycle.phase==="Corrección Mayor"&&"Correcciones 40-80% históricas. Short en rebotes o cash."}
          {cycle.phase==="Acumulación Post-Halving"&&"Lateral/lento. Manos fuertes acumulando. Paciencia."}
          {cycle.phase==="Bear / Pre-Halving"&&"Capitulación. Acumulación gradual largo plazo."}
        </div>
        <div style={{marginTop:8,fontSize:8,color:T.muted}}>MVRV: {mvrvS}</div>
      </div>
    </div>
  );
}

// ── Analysis text renderer ─────────────────────────────────
function AnalysisText({ text, theme: T }) {
  if(!text) return <div style={{color:T.muted,fontSize:12,textAlign:"center",padding:32}}>Pulsa ⚡ ANALIZAR para recibir el setup completo</div>;
  return (
    <div style={{whiteSpace:"pre-wrap",lineHeight:1.9,fontSize:12}}>
      {text.split("\n").map((ln,i)=>{
        let color=T.textSec,fw=400,mt=0,fs=12;
        if(ln.includes("═")){color=T.border;fs=11;}
        else if(ln.startsWith("📊 SETUP:")){color=T.bull;fw=700;fs=14;mt=8;}
        else if(ln.startsWith("🎯")){color=T.accent;mt=4;}
        else if(/^(LECTURA|SMART|─── |CONFLUENCIAS|FIBONACCI|DIVERGENCIAS|ESTRUCTURA)/.test(ln)){color:T.muted;fw=700;mt=10;color=T.textSec;}
        else if(ln.startsWith("🔴")){color=T.danger;}
        else if(ln.startsWith("✅")){color=T.bull;}
        else if(ln.startsWith("⚡")||ln.startsWith("💼")){color=T.warn;}
        else if(ln.startsWith("⚠️")){color=T.warn;fw=700;}
        else if(ln.startsWith("✔")){color=T.accent;}
        else if(ln.startsWith("📊 CONFIANZA")||ln.startsWith("🚨")){color=T.bull;fw=700;mt=4;}
        else if(ln.startsWith("🟢")){color=T.bull;fw=700;}
        else if(ln.startsWith("📌")){color=T.textSec;}
        else if(ln.startsWith("•")){color=T.textSec;}
        else{color=T.text;}
        return <span key={i} style={{display:"block",color,fontWeight:fw,marginTop:mt,fontSize:fs}}>{ln}</span>;
      })}
    </div>
  );
}

// ── Score bar ──────────────────────────────────────────────
function ScoreBar({ score, theme: T }) {
  const max=9,p=((score+max)/(max*2))*100,col=score>=4?T.bull:score<=-4?T.danger:T.warn;
  return (
    <div style={{marginTop:6}}>
      <div style={{height:5,background:T.bg,borderRadius:3,position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",left:"50%",top:0,width:1,height:"100%",background:T.border}}/>
        <div style={{height:"100%",width:`${Math.abs(p-50)}%`,marginLeft:score>=0?"50%":`${p}%`,background:col,borderRadius:2,transition:"all .5s"}}/>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:7,color:T.muted,marginTop:2}}>
        <span>BAJISTA</span><span>NEUTRAL</span><span>ALCISTA</span>
      </div>
    </div>
  );
}

// ── Calculator ─────────────────────────────────────────────
function Calculator({ price, theme: T }) {
  const [cap,setCap]=useState("10000");
  const [risk,setRisk]=useState("1");
  const [entry,setEntry]=useState(price?String(Math.round(price)):"");
  const [sl,setSl]=useState("");
  const [tp,setTp]=useState("");
  const [side,setSide]=useState("long");
  useEffect(()=>{if(price&&!entry)setEntry(String(Math.round(price)));},[price]);
  const calc=()=>{
    const C=parseFloat(cap)||0,R=(parseFloat(risk)||0)/100,E=parseFloat(entry)||0,S=parseFloat(sl)||0,TP=parseFloat(tp)||0;
    if(!C||!E||!S)return null;
    const rA=C*R,sD=Math.abs(E-S),sP=(sD/E)*100,pos=rA/sD,posUSD=pos*E,lev=posUSD/C,sugLev=Math.min(Math.ceil(lev),20),margin=posUSD/sugLev,rr=TP?Math.abs(TP-E)/sD:null;
    return{rA,sD,sP,pos,posUSD,lev,sugLev,margin,rr,pnlSL:-rA,pnlTP:TP?Math.abs(TP-E)*pos:null};
  };
  const r=calc();
  const IS={background:T.bg,border:`1px solid ${T.border}`,color:T.text,fontFamily:"inherit",fontSize:11,padding:"8px 12px",borderRadius:5,outline:"none",width:"100%"};
  return (
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:7,padding:16}}>
        <div style={{fontSize:9,color:T.muted,letterSpacing:".14em",marginBottom:12}}>PARÁMETROS</div>
        <div style={{display:"flex",gap:5,marginBottom:12}}>
          {["long","short"].map(s=>(
            <button key={s} onClick={()=>setSide(s)} style={{flex:1,background:side===s?(s==="long"?T.bull+"22":T.danger+"22"):"transparent",border:`1px solid ${side===s?(s==="long"?T.bull:T.danger):T.border}`,color:side===s?(s==="long"?T.bull:T.danger):T.textSec,padding:"7px",borderRadius:5,cursor:"pointer",fontFamily:"inherit",fontSize:10,fontWeight:side===s?700:400}}>
              {s==="long"?"▲ LONG":"▼ SHORT"}
            </button>
          ))}
        </div>
        {[["Capital ($)",cap,setCap],["Riesgo (%)",risk,setRisk],["Entrada ($)",entry,setEntry],["Stop Loss ($)",sl,setSl],["Take Profit ($)",tp,setTp]].map(([l,v,set])=>(
          <div key={l} style={{marginBottom:10}}>
            <div style={{fontSize:9,color:T.textSec,marginBottom:4}}>{l}</div>
            <input style={IS} type="number" value={v} onChange={e=>set(e.target.value)}/>
          </div>
        ))}
      </div>
      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:7,padding:16}}>
        <div style={{fontSize:9,color:T.muted,letterSpacing:".14em",marginBottom:12}}>RESULTADO</div>
        {r?(
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {[["Riesgo $","$"+fmt(r.rA),T.warn],["Distancia SL","$"+fmt(r.sD)+" ("+fmt(r.sP,2)+"%)",T.textSec],["Tamaño pos.",fmt(r.pos,6)+" BTC",T.bull],["Valor pos.","$"+fmt(r.posUSD),T.bull],["Leverage real",fmt(r.lev,2)+"x",r.lev>20?T.danger:r.lev>10?T.warn:T.bull],["Leverage sug.",r.sugLev+"x",T.accent],["Margen req.","$"+fmt(r.margin),T.textSec],r.rr?["R:R",fmt(r.rr,2)+":1",r.rr>=2?T.bull:r.rr>=1.5?T.warn:T.danger]:null,["PnL si SL","-$"+fmt(Math.abs(r.pnlSL)),T.danger],r.pnlTP?["PnL si TP","+$"+fmt(r.pnlTP),T.bull]:null].filter(Boolean).map(([l,v,c])=>(
              <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:`1px solid ${T.border}`}}>
                <span style={{fontSize:9,color:T.textSec}}>{l}</span>
                <span style={{fontSize:11,color:c,fontWeight:700}}>{v}</span>
              </div>
            ))}
            {r.lev>20&&<div style={{background:T.danger+"11",border:`1px solid ${T.danger}33`,borderRadius:4,padding:"7px 10px",fontSize:9,color:T.danger}}>⚠️ Leverage {fmt(r.lev,1)}x — Reduce riesgo o ajusta SL</div>}
            {r.rr&&r.rr<1.5&&<div style={{background:T.warn+"11",border:`1px solid ${T.warn}33`,borderRadius:4,padding:"7px 10px",fontSize:9,color:T.warn}}>⚠️ R:R {fmt(r.rr,2)}:1 — APEX requiere mínimo 1.5:1</div>}
          </div>
        ):<div style={{color:T.muted,fontSize:11,textAlign:"center",padding:24}}>Completa Capital, Entrada y SL</div>}
      </div>
    </div>
  );
}


// ── VPVR Tab Component ─────────────────────────────────────
function VPVRTab({ rawK, mkt, theme: T }) {
  const vpvr = calcVPVR(rawK["4h"] || [], 24);
  if (!vpvr) return (
    <div style={{color:T.muted,textAlign:"center",padding:48,fontSize:14}}>Cargando VPVR...</div>
  );
  return (
    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      <div className="card">
        <div style={{fontSize:8,color:T.muted,letterSpacing:".14em",marginBottom:10}}>
          VOLUME PROFILE (VPVR) — 4H · {(rawK["4h"]||[]).length} VELAS
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:1}}>
          {[...vpvr.prof].reverse().map((p,i)=>{
            const isPOC=Math.abs(p.pl-vpvr.poc.pl)<(vpvr.mx-vpvr.mn)/vpvr.prof.length;
            const isNear=mkt.price&&Math.abs(p.pl-mkt.price)<(vpvr.mx-vpvr.mn)/vpvr.prof.length;
            const barW=(p.vol/vpvr.maxV)*100;
            return(
              <div key={i} style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{fontSize:8,color:isPOC?T.warn:isNear?T.text:T.muted,width:72,textAlign:"right",flexShrink:0,fontFamily:"monospace"}}>
                  ${Math.round(p.pl).toLocaleString()}
                </div>
                <div style={{flex:1,height:7,background:T.bg,borderRadius:2,overflow:"hidden",position:"relative"}}>
                  <div style={{height:"100%",width:`${barW}%`,background:isPOC?T.warn:isNear?T.accent:T.textSec+"44",borderRadius:2}}/>
                  {isNear&&<div style={{position:"absolute",top:0,right:0,bottom:0,width:2,background:T.text}}/>}
                </div>
                <div style={{width:32,fontSize:8,color:isPOC?T.warn:T.muted,flexShrink:0}}>
                  {isPOC?"POC":Math.abs(p.pl-vpvr.vah)<(vpvr.mx-vpvr.mn)/vpvr.prof.length?"VAH":Math.abs(p.pl-vpvr.val)<(vpvr.mx-vpvr.mn)/vpvr.prof.length?"VAL":""}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{display:"flex",gap:20,marginTop:12,paddingTop:12,borderTop:`1px solid ${T.border}`}}>
          {[["POC","$"+Math.round(vpvr.poc.pl).toLocaleString(),T.warn],["VAH","$"+Math.round(vpvr.vah).toLocaleString(),T.danger],["VAL","$"+Math.round(vpvr.val).toLocaleString(),T.bull]].map(([l,v,c])=>(
            <div key={l}><div style={{fontSize:8,color:T.muted}}>{l}</div><div style={{fontSize:13,color:c,fontWeight:700,marginTop:2}}>{v}</div></div>
          ))}
        </div>
      </div>
      <div className="card" style={{background:T.bg}}>
        <div style={{fontSize:9,color:T.muted,letterSpacing:".14em",marginBottom:8}}>INTERPRETACIÓN APEX</div>
        <div style={{fontSize:10,color:T.textSec,lineHeight:1.9}}>
          {mkt.price>vpvr.vah
            ? `⚡ Precio sobre VAH ($${Math.round(vpvr.vah).toLocaleString()}) — zona de baja liquidez. Movimientos rápidos.`
            : mkt.price<vpvr.val
            ? `⚡ Precio bajo VAL ($${Math.round(vpvr.val).toLocaleString()}) — fuera del value area.`
            : `✓ Precio dentro del Value Area ($${Math.round(vpvr.val).toLocaleString()} – $${Math.round(vpvr.vah).toLocaleString()}) — zona fair value.`
          }
          <br/>POC ${Math.round(vpvr.poc.pl).toLocaleString()}: mayor volumen — precio tiende a volver aquí.
        </div>
      </div>
    </div>
  );
}


// ── Auto S/R (swing point clustering) ─────────────────────
function calcAutoSR(h, l, c) {
  const lb = 3, res = [], sup = [];
  for (let i = lb; i < c.length - lb; i++) {
    if (h[i] === Math.max(...h.slice(i-lb, i+lb+1))) res.push(h[i]);
    if (l[i] === Math.min(...l.slice(i-lb, i+lb+1))) sup.push(l[i]);
  }
  const cluster = arr => {
    const s = [...arr].sort((a,b)=>a-b), out=[];let g=[s[0]];
    for(let i=1;i<s.length;i++){if(s[i]&&s[i-1]&&(s[i]-s[i-1])/s[i-1]<0.004)g.push(s[i]);else{if(g.length)out.push(g.reduce((a,b)=>a+b,0)/g.length);g=[s[i]];}}
    if(g.length)out.push(g.reduce((a,b)=>a+b,0)/g.length);return out;
  };
  const price = c[c.length-1];
  return {
    res: cluster(res.filter(Boolean)).filter(p=>p>price).slice(0,5),
    sup: cluster(sup.filter(Boolean)).filter(p=>p<price).slice(-5),
  };
}

// ── Trade scoring ──────────────────────────────────────────
function scoreTradeIdea(mkt, inds) {
  const i4=inds["4h"],i1=inds["1h"],i1d=inds["1d"],i15=inds["15m"];
  if(!i4||!i1)return null;
  let bull=0,bear=0;const reasons=[];
  const b=txt=>reasons.push({s:"bull",txt}),be=txt=>reasons.push({s:"bear",txt});
  if(i4.bias==="ALCISTA"&&i1.bias==="ALCISTA"){bull+=2;b("4H+1H alcistas");}
  if(i4.bias==="BAJISTA"&&i1.bias==="BAJISTA"){bear+=2;be("4H+1H bajistas");}
  if(i1d?.bias==="ALCISTA"){bull++;b("1D alcista");}
  if(i1d?.bias==="BAJISTA"){bear++;be("1D bajista");}
  if(i4.rsi<=32&&i1.rsi<=38){bull+=2;b("RSI sobreventa 4H+1H");}
  if(i4.rsi>=68&&i1.rsi>=65){bear+=2;be("RSI sobrecompra 4H+1H");}
  if(i4.macd.hist>0&&i4.macd.hist>i4.macd.prev){bull++;b("MACD 4H acelerando");}
  if(i4.macd.hist<0&&i4.macd.hist<i4.macd.prev){bear++;be("MACD 4H bajista");}
  if(i4.stoch.k<20){bull++;b("Stoch sobreventa");}
  if(i4.stoch.k>80){bear++;be("Stoch sobrecompra");}
  if(mkt.funding!=null&&mkt.funding<-0.01){bull++;b("Funding negativo");}
  if(mkt.funding!=null&&mkt.funding>0.05){bear++;be("Funding extremo");}
  if(mkt.lsr!=null&&mkt.lsr<0.65){bull++;b("L/S bajo");}
  if(mkt.lsr!=null&&mkt.lsr>1.7){bear++;be("L/S alto");}
  if(mkt.fg!=null&&mkt.fg<20){bull++;b("Miedo extremo");}
  if(mkt.fg!=null&&mkt.fg>80){bear++;be("Codicia extrema");}
  const side=bull>bear?"LONG":bear>bull?"SHORT":null;
  const maxSc=Math.max(bull,bear);
  if(!side||maxSc<4)return null;
  const price=mkt.price,av=i4.atr;
  // Determine trade type based on TF alignment and volatility
  const bothLow=i4.bb.width<2&&i1.bb.width<2;
  const strongTrend=Math.abs(i4.score)>=6;
  const tradeType = i15?.bias===i1.bias&&i1.bias===i4.bias&&bothLow ? "Scalp"
    : strongTrend && i1d?.bias===i4.bias ? "Swing"
    : "DayTrade";
  const avMult = tradeType==="Scalp"?1.0:tradeType==="Swing"?2.5:1.5;
  const tpMult = tradeType==="Scalp"?[1.5,2.0,2.5]:tradeType==="Swing"?[2.0,3.5,5.0]:[1.5,2.5,4.0];
  const maxLev = tradeType==="Scalp"?10:tradeType==="Swing"?3:5;
  return{side,tradeType,confidence:maxSc>=7?"ALTA":maxSc>=5?"MEDIA":"BAJA",
    bull,bear,maxSc,reasons,price,maxLev,
    sl:side==="LONG"?price-av*avMult:price+av*avMult,
    tp1:side==="LONG"?price+av*tpMult[0]:price-av*tpMult[0],
    tp2:side==="LONG"?price+av*tpMult[1]:price-av*tpMult[1],
    tp3:side==="LONG"?price+av*tpMult[2]:price-av*tpMult[2],ts:new Date()};
}

// ── Backtest engine ────────────────────────────────────────
function genStrategies(){
  const S=[];
  const ps=[5,8,9,13,21,34,50,89,100,144,200];
  for(let i=0;i<ps.length;i++)for(let j=i+1;j<ps.length;j++)
    S.push({id:`ema_${ps[i]}_${ps[j]}`,name:`EMA ${ps[i]}/${ps[j]}`,type:"ema",p:{fast:ps[i],slow:ps[j]}});
  [[7,20,80],[14,25,75],[14,30,70],[14,35,65],[21,30,70],[7,25,75],[14,28,72],[21,25,75],[14,32,68],[21,35,65]].forEach(([p,os,ob])=>
    S.push({id:`rsi_${p}_${os}`,name:`RSI(${p}) ${os}/${ob}`,type:"rsi",p:{period:p,os,ob}}));
  [[10,1.5],[10,2],[20,1.5],[20,2],[20,2.5],[30,2]].forEach(([p,m])=>
    S.push({id:`bb_${p}_${m}`,name:`BB(${p},${m})`,type:"bb",p:{period:p,mult:m}}));
  [[12,26,9],[8,21,5],[5,13,4],[10,20,7],[7,14,5],[15,30,9]].forEach(([f,s,sg])=>
    S.push({id:`macd_${f}_${s}`,name:`MACD(${f},${s},${sg})`,type:"macd",p:{f,s,sg}}));
  [[14,3],[5,3],[21,5]].forEach(([p,sm])=>[[20,80],[25,75],[30,70]].forEach(([os,ob])=>
    S.push({id:`stoch_${p}_${os}`,name:`Stoch(${p}) ${os}/${ob}`,type:"stoch",p:{period:p,smooth:sm,os,ob}})));
  [[9,21],[21,50],[50,200]].forEach(([f,s])=>[[25,75],[30,70],[35,65]].forEach(([os,ob])=>
    S.push({id:`emr_${f}_${s}_${os}`,name:`EMA${f}/${s}+RSI`,type:"ema_rsi",p:{fast:f,slow:s,os,ob}})));
  [[5,8],[5,13],[8,21],[13,21],[5,21],[8,13]].forEach(([f,s])=>
    S.push({id:`sc_${f}_${s}`,name:`Scalp ${f}/${s}`,type:"ema",p:{fast:f,slow:s}}));
  [[5,13,21],[9,21,50],[13,34,89],[21,50,100],[34,89,200]].forEach(([e1,e2,e3])=>
    [true,false].forEach(vl=>S.push({id:`tri_${e1}_${vl}`,name:`3EMA ${e1}/${e2}/${e3}${vl?"+V":""}`,type:"triple",p:{e1,e2,e3,vl}})));
  return S;
}
const ALL_STRATEGIES = genStrategies();

function calcEMALocal(d,p){if(!d?.length)return[];const k=2/(p+1),r=[d[0]];for(let i=1;i<d.length;i++)r.push(d[i]*k+r[i-1]*(1-k));return r;}
function calcRSILocal(c,p=14){if(c.length<p+2)return new Array(c.length).fill(50);const r=new Array(c.length).fill(null);let ag=0,al=0;for(let i=1;i<=p;i++){const d=c[i]-c[i-1];d>0?ag+=d:al-=d;}ag/=p;al/=p;r[p]=al===0?100:100-100/(1+ag/al);for(let i=p+1;i<c.length;i++){const d=c[i]-c[i-1];ag=(ag*(p-1)+Math.max(d,0))/p;al=(al*(p-1)+Math.max(-d,0))/p;r[i]=al===0?100:100-100/(1+ag/al);}return r;}
function calcMACDLocal(c,f=12,s=26,sg=9){const ef=calcEMALocal(c,f),es=calcEMALocal(c,s),ml=ef.map((v,i)=>v-es[i]),sl=calcEMALocal(ml,sg);return{hist:ml.map((v,i)=>v-sl[i])};}
function calcBBLocal(c,p=20,m=2){const sm=c.map((_,i)=>i<p-1?null:c.slice(i-p+1,i+1).reduce((a,b)=>a+b,0)/p);return c.map((_,i)=>{if(i<p-1)return{u:null,l:null};const sl=c.slice(i-p+1,i+1),mn=sm[i],std=Math.sqrt(sl.reduce((a,v)=>a+(v-mn)**2,0)/p);return{u:mn+m*std,l:mn-m*std};});}
function calcATRLocal(h,l,c,p=14){const tr=h.map((hh,i)=>i===0?hh-l[i]:Math.max(hh-l[i],Math.abs(hh-c[i-1]),Math.abs(l[i]-c[i-1])));return calcEMALocal(tr,p);}

function runStrategy(klines,strat){
  if(!klines||klines.length<50)return[];
  const c=klines.map(k=>k.c),h=klines.map(k=>k.h),l=klines.map(k=>k.l);
  const trades=[];let inTrade=null;const p=strat.p;
  const sig=i=>{
    if(i<5)return 0;
    const cs=c.slice(0,i+1),t=strat.type;
    if(t==="ema"){const ef=calcEMALocal(cs,p.fast),es=calcEMALocal(cs,p.slow);if(ef[ef.length-2]<=es[es.length-2]&&ef[ef.length-1]>es[es.length-1])return 1;if(ef[ef.length-2]>=es[es.length-2]&&ef[ef.length-1]<es[es.length-1])return -1;return 0;}
    if(t==="rsi"){const rv=calcRSILocal(cs,p.period),r=rv[rv.length-1],rp=rv[rv.length-2];if(rp<=p.os&&r>p.os)return 1;if(rp>=p.ob&&r<p.ob)return -1;return 0;}
    if(t==="bb"){const bv=calcBBLocal(cs,p.period,p.mult),b=bv[bv.length-1],bp=bv[bv.length-2];if(!b.l||!bp.l)return 0;if(cs[i-1]<=bp.l&&cs[i]>b.l)return 1;if(cs[i-1]>=bp.u&&cs[i]<b.u)return -1;return 0;}
    if(t==="macd"){const mr=calcMACDLocal(cs,p.f,p.s,p.sg),mh=mr.hist;if(mh[mh.length-2]<=0&&mh[mh.length-1]>0)return 1;if(mh[mh.length-2]>=0&&mh[mh.length-1]<0)return -1;return 0;}
    if(t==="stoch"){const rv=calcRSILocal(cs,p.period),st=rv.map((_,i2)=>{if(i2<p.period+p.smooth-1)return null;const w=rv.slice(i2-p.smooth+1,i2+1).filter(v=>v!=null);const mn=Math.min(...w),mx=Math.max(...w);return mx===mn?50:((rv[i2]-mn)/(mx-mn))*100;});const k=st[st.length-1],kp=st[st.length-2];if(kp!=null&&k!=null){if(kp<=p.os&&k>p.os)return 1;if(kp>=p.ob&&k<p.ob)return -1;}return 0;}
    if(t==="ema_rsi"){const ef=calcEMALocal(cs,p.fast),es=calcEMALocal(cs,p.slow),rv=calcRSILocal(cs,14),r=rv[rv.length-1];if(ef[ef.length-1]>es[es.length-1]&&r<p.os)return 1;if(ef[ef.length-1]<es[es.length-1]&&r>p.ob)return -1;return 0;}
    if(t==="triple"){const e1=calcEMALocal(cs,p.e1),e2=calcEMALocal(cs,p.e2),e3=calcEMALocal(cs,p.e3);const a=e1[e1.length-1],b=e2[e2.length-1],d=e3[e3.length-1];if(a>b&&b>d&&cs[i]>a)return 1;if(a<b&&b<d&&cs[i]<a)return -1;return 0;}
    return 0;
  };
  for(let i=10;i<klines.length-1;i++){
    const s=sig(i);
    if(!inTrade&&s!==0){const av=calcATRLocal(h.slice(0,i+1),l.slice(0,i+1),c.slice(0,i+1),14);inTrade={side:s===1?"long":"short",entry:c[i+1],atr:av[av.length-1]||c[i]*0.01};}
    if(inTrade){
      const av=inTrade.atr,sl=inTrade.side==="long"?inTrade.entry-av*1.5:inTrade.entry+av*1.5,tp=inTrade.side==="long"?inTrade.entry+av*2.5:inTrade.entry-av*2.5;
      const price=c[i+1],hitSL=inTrade.side==="long"?price<=sl:price>=sl,hitTP=inTrade.side==="long"?price>=tp:price<=tp;
      if(hitSL||hitTP||i===klines.length-2){const ex=hitSL?sl:hitTP?tp:price;const pnl=inTrade.side==="long"?(ex-inTrade.entry)/inTrade.entry*100:(inTrade.entry-ex)/inTrade.entry*100;trades.push({...inTrade,exit:ex,result:hitSL?"sl":hitTP?"tp":"open",pnl});inTrade=null;}
    }
  }
  return trades;
}
function btStats(trades){
  const cl=trades.filter(t=>t.result!=="open"),w=cl.filter(t=>t.pnl>0),lo=cl.filter(t=>t.pnl<=0);
  const wr=cl.length?w.length/cl.length*100:0,totPnl=cl.reduce((a,t)=>a+t.pnl,0);
  const avgW=w.length?w.reduce((a,t)=>a+t.pnl,0)/w.length:0,avgL=lo.length?lo.reduce((a,t)=>a+t.pnl,0)/lo.length:0;
  let pk=0,mdd=0,cum=0;for(const t of cl){cum+=t.pnl;if(cum>pk)pk=cum;if(pk-cum>mdd)mdd=pk-cum;}
  return{total:cl.length,wins:w.length,wr,totPnl,avgW,avgL,mdd,pf:avgL!==0?Math.abs(avgW/avgL):999};
}

// ── Order Book Panel ───────────────────────────────────────
function OrderBookPanel({ orderBook, price, theme: T }) {
  if (!orderBook) return <div style={{color:T.sec,textAlign:"center",padding:40,fontSize:11}}>Cargando order book...</div>;
  const bids=(orderBook.bids||[]).slice(0,15).map(b=>[+b[0],+b[1]]);
  const asks=(orderBook.asks||[]).slice(0,15).map(a=>[+a[0],+a[1]]);
  const maxSize=Math.max(...bids.map(b=>b[1]),...asks.map(a=>a[1]),1);
  const spread=asks[0]&&bids[0]?((asks[0][0]-bids[0][0])/bids[0][0]*100).toFixed(3):null;
  const totalBids=bids.reduce((a,b)=>a+b[0]*b[1],0);
  const totalAsks=asks.reduce((a,a2)=>a+a2[0]*a2[1],0);
  const pressure=((totalBids/(totalBids+totalAsks))*100).toFixed(1);
  return (
    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
        {[["SPREAD",spread?spread+"%":"N/A",T.warn],["PRESIÓN COMPRA",pressure+"%",parseFloat(pressure)>55?T.bull:T.bear],["TOTAL BIDS",fmtB(totalBids),T.bull],["TOTAL ASKS",fmtB(totalAsks),T.bear]].map(([l,v,c])=>(
          <div key={l} style={{background:T.card,border:`1px solid ${c}22`,borderRadius:6,padding:"8px 12px"}}>
            <div style={{fontSize:7,color:T.textSec,marginBottom:3}}>{l}</div>
            <div style={{fontSize:12,color:c,fontWeight:700}}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <div>
          <div style={{fontSize:8,color:T.textSec,marginBottom:6,letterSpacing:".1em"}}>ASKS (VENTA)</div>
          {asks.slice().reverse().map(([p2,s],i)=>(
            <div key={i} style={{position:"relative",marginBottom:1}}>
              <div style={{position:"absolute",right:0,top:0,bottom:0,width:`${(s/maxSize)*100}%`,background:T.bear+"22",borderRadius:2}}/>
              <div style={{display:"flex",justifyContent:"space-between",padding:"3px 6px",fontSize:10,position:"relative"}}>
                <span style={{color:T.bear,fontFamily:"monospace"}}>${fmt(p2)}</span>
                <span style={{color:T.textSec}}>{fmt(s,3)}</span>
              </div>
            </div>
          ))}
        </div>
        <div>
          <div style={{fontSize:8,color:T.textSec,marginBottom:6,letterSpacing:".1em"}}>BIDS (COMPRA)</div>
          {bids.map(([p2,s],i)=>(
            <div key={i} style={{position:"relative",marginBottom:1}}>
              <div style={{position:"absolute",left:0,top:0,bottom:0,width:`${(s/maxSize)*100}%`,background:T.bull+"22",borderRadius:2}}/>
              <div style={{display:"flex",justifyContent:"space-between",padding:"3px 6px",fontSize:10,position:"relative"}}>
                <span style={{color:T.bull,fontFamily:"monospace"}}>${fmt(p2)}</span>
                <span style={{color:T.textSec}}>{fmt(s,3)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Trade Ideas Panel ──────────────────────────────────────
function TradeIdeasPanel({ idea, alerts, inds, notifPerm, onRequestNotif, onSendToSetup, theme: T }) {
  const [history, setHistory] = useState(() => { try { return JSON.parse(localStorage.getItem("apex_ti") || "[]"); } catch { return []; } });
  const sendNotif = ti => {
    if (notifPerm === "granted") new Notification(`🚨 APEX: ${ti.side} BTC`, { body: `$${Math.round(ti.price)} | ${ti.confidence}` });
    const h = [{ ...ti, sentAt: new Date().toISOString() }, ...history].slice(0, 10);
    setHistory(h); try { localStorage.setItem("apex_ti", JSON.stringify(h)); } catch {}
  };
  const bColor = (bias) => bias === "ALCISTA" ? T.bull : bias === "BAJISTA" ? T.bear : T.warn;
  return (
    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      {idea ? (
        <div style={{background:idea.side==="LONG"?T.bull+"11":T.bear+"11",border:`2px solid ${idea.side==="LONG"?T.bull:T.bear}`,borderRadius:8,padding:18}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:12}}>
            <div style={{fontSize:18,fontWeight:800,color:idea.side==="LONG"?T.bull:T.bear}}>{idea.side==="LONG"?"▲ LONG":"▼ SHORT"} BTC/USDT PERP <span style={{fontSize:11,color:idea.tradeType==="Scalp"?T.warn:idea.tradeType==="Swing"?"#a78bfa":T.accent,background:T.card,padding:"2px 8px",borderRadius:4,marginLeft:6}}>{idea.tradeType||"DayTrade"}</span></div>
            <div style={{fontSize:11,color:idea.confidence==="ALTA"?T.bull:idea.confidence==="MEDIA"?T.warn:T.textSec,fontWeight:700}}>Confianza: {idea.confidence}</div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
            {[["ENTRADA","$"+fmt(idea.price,0),T.text],["STOP LOSS","$"+fmt(idea.sl,0),T.bear],["TP1","$"+fmt(idea.tp1,0),T.bull],["TP2","$"+fmt(idea.tp2,0),T.bull]].map(([l,v,c])=>(
              <div key={l} style={{background:T.card,border:"1px solid "+T.border,borderRadius:5,padding:"8px",textAlign:"center"}}>
                <div style={{fontSize:7,color:T.textSec}}>{l}</div>
                <div style={{fontSize:12,color:c,fontWeight:700,marginTop:2}}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{marginBottom:10}}>
            <div style={{fontSize:7,color:T.textSec,marginBottom:5}}>CONFLUENCIAS</div>
            <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
              {idea.reasons.filter(r=>r.s===(idea.side==="LONG"?"bull":"bear")).map((r,i)=>(
                <span key={i} style={{fontSize:8,padding:"2px 8px",borderRadius:3,background:idea.side==="LONG"?T.bull+"22":T.bear+"22",color:idea.side==="LONG"?T.bull:T.bear}}>✔ {r.txt}</span>
              ))}
            </div>
          </div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>sendNotif(idea)} style={{flex:1,background:T.accent+"22",border:`1px solid ${T.accent}`,color:T.accent,padding:"8px",borderRadius:5,cursor:"pointer",fontFamily:"inherit",fontSize:10}}>🔔 Notificación</button>
            <button onClick={()=>onSendToSetup(idea)} style={{flex:1,background:T.textSec+"22",border:`1px solid ${T.border}`,color:T.text,padding:"8px",borderRadius:5,cursor:"pointer",fontFamily:"inherit",fontSize:10}}>⚡ Enviar a Setup</button>
          </div>
        </div>
      ) : (
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:7,padding:"24px 16px",textAlign:"center",color:T.textSec,fontSize:11}}>
          Sin setup de alta confluencia<br/>
          <span style={{fontSize:9,color:T.textSec}}>APEX genera ideas cuando ≥4 indicadores coinciden</span>
        </div>
      )}
      <div className="card">
        <div style={{fontSize:8,color:T.textSec,letterSpacing:".14em",marginBottom:10}}>SESGO MULTI-TF</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6}}>
          {["1d","4h","1h","15m"].map(tf=>{
            const i2=inds[tf];
            return (
              <div key={tf} style={{background:T.card,border:`2px solid ${i2?bColor(i2.bias)+"44":T.border}`,borderRadius:6,padding:10,textAlign:"center"}}>
                <div style={{fontSize:8,color:T.textSec}}>{{"1d":"1D","4h":"4H","1h":"1H","15m":"15M"}[tf]}</div>
                <div style={{fontSize:13,fontWeight:700,color:bColor(i2?.bias)}}>{i2?.bias||"..."}</div>
                {i2 && <ScoreBar score={i2.score} theme={T} />}
              </div>
            );
          })}
        </div>
      </div>
      <div className="card" style={{background:T.card}}>
        <div style={{fontSize:8,color:T.textSec,marginBottom:8}}>ALERTAS ({alerts.length})</div>
        {alerts.length===0 ? (
          <div style={{color:T.textSec,fontSize:10,textAlign:"center",padding:12}}>Sin alertas activas</div>
        ) : (
          <div style={{display:"flex",flexDirection:"column",gap:4,maxHeight:180,overflowY:"auto"}}>
            {alerts.map((a,i)=>(
              <div key={i} style={{display:"flex",gap:8,padding:"6px 10px",background:T.card,border:`1px solid ${a.level==="danger"?T.bear+"33":T.bull+"33"}`,borderRadius:5}}>
                <span>{a.icon}</span>
                <span style={{fontSize:10,color:a.level==="danger"?T.bear:a.level==="success"?T.bull:T.warn}}>{a.msg}</span>
                <span style={{fontSize:7,color:T.textSec,marginLeft:"auto"}}>{a.tf}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="card" style={{display:"flex",alignItems:"center",gap:10}}>
        <span style={{width:8,height:8,borderRadius:"50%",background:notifPerm==="granted"?T.bull:T.bear,display:"inline-block"}}/>
        <span style={{fontSize:10,color:T.textSec}}>Notificaciones: {notifPerm==="granted"?"ACTIVAS":"INACTIVAS"}</span>
        {notifPerm!=="granted"&&<button onClick={onRequestNotif} style={{background:T.accent+"22",border:`1px solid ${T.accent}`,color:T.accent,padding:"4px 12px",borderRadius:4,cursor:"pointer",fontFamily:"inherit",fontSize:9}}>Activar</button>}
      </div>
      {history.length>0&&(
        <div className="card">
          <div style={{fontSize:8,color:T.textSec,marginBottom:6}}>HISTORIAL</div>
          {history.map((h2,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",fontSize:10,padding:"4px 8px",borderBottom:`1px solid ${T.border}`}}>
              <span style={{color:h2.side==="LONG"?T.bull:T.bear,fontWeight:700}}>{h2.side}</span>
              <span style={{color:T.textSec}}>${Math.round(h2.price)}</span>
              <span style={{color:h2.confidence==="ALTA"?T.bull:T.warn}}>{h2.confidence}</span>
              <span style={{color:T.textSec,fontSize:8}}>{new Date(h2.sentAt).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Backtest Panel ─────────────────────────────────────────
function BacktestPanel({ rawK, theme: T }) {
  const [tf, setTf] = useState("4h");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState(null);
  const [selType, setSelType] = useState("all");
  const [sortBy, setSortBy] = useState("wr");
  const [page, setPage] = useState(0);
  const [expandedRow, setExpandedRow] = useState(null);
  const PER = 20;

  const runAll = () => {
    const klines = rawK[tf]; if (!klines || klines.length < 50) return;
    setRunning(true);
    setTimeout(() => {
      const res = ALL_STRATEGIES.map(s => ({ ...s, stats: btStats(runStrategy(klines, s)) }));
      setResults(res); setRunning(false); setPage(0);
    }, 60);
  };

  const sorted = useMemo(() => {
    if (!results) return [];
    let r = selType === "all" ? results : results.filter(s => s.type === selType);
    if (sortBy === "wr") return [...r].sort((a,b) => b.stats.wr - a.stats.wr);
    if (sortBy === "pnl") return [...r].sort((a,b) => b.stats.totPnl - a.stats.totPnl);
    return [...r].sort((a,b) => b.stats.total - a.stats.total);
  }, [results, selType, sortBy]);

  const totalTrades = useMemo(() => results ? results.reduce((a,s) => a + s.stats.total, 0) : 0, [results]);
  const paged = sorted.slice(page * PER, (page + 1) * PER);
  const totalPages = Math.ceil(sorted.length / PER);

  return (
    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      <div className="card">
        <div style={{fontSize:8,color:T.textSec,letterSpacing:".14em",marginBottom:10}}>BACKTEST — {ALL_STRATEGIES.length} ESTRATEGIAS</div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
          <div style={{display:"flex",gap:4}}>
            {["1d","4h","1h","15m"].map(t=>(
              <button key={t} onClick={()=>setTf(t)} style={{background:tf===t?T.accent+"22":"transparent",border:`1px solid ${tf===t?T.accent:T.border}`,color:tf===t?T.accent:T.textSec,padding:"4px 10px",borderRadius:4,cursor:"pointer",fontFamily:"inherit",fontSize:9}}>{{"1d":"1D","4h":"4H","1h":"1H","15m":"15M"}[t]}</button>
            ))}
          </div>
          <div style={{display:"flex",gap:4}}>
            {["all","ema","rsi","bb","macd","stoch","triple"].map(t=>(
              <button key={t} onClick={()=>setSelType(t)} style={{background:selType===t?T.accent+"22":"transparent",border:`1px solid ${selType===t?T.accent:T.border}`,color:selType===t?T.accent:T.textSec,padding:"4px 8px",borderRadius:4,cursor:"pointer",fontFamily:"inherit",fontSize:8}}>{t}</button>
            ))}
          </div>
          <div style={{display:"flex",gap:4,marginLeft:"auto"}}>
            {[["wr","Win%"],["pnl","PnL"],["trades","#"]].map(([k,l])=>(
              <button key={k} onClick={()=>setSortBy(k)} style={{background:sortBy===k?T.accent+"22":"transparent",border:`1px solid ${sortBy===k?T.accent:T.border}`,color:sortBy===k?T.accent:T.textSec,padding:"4px 8px",borderRadius:4,cursor:"pointer",fontFamily:"inherit",fontSize:8}}>↕{l}</button>
            ))}
          </div>
          <button onClick={runAll} disabled={running} style={{background:T.accent+"22",border:`1px solid ${T.accent}`,color:T.accent,padding:"7px 16px",borderRadius:5,cursor:"pointer",fontFamily:"inherit",fontSize:10,fontWeight:700}}>{running?"⟳ Ejecutando...":"▶ EJECUTAR"}</button>
        </div>
      </div>

      {results && (
        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8}}>
          {[["Estrategias",sorted.length,T.accent],["Trades",totalTrades.toLocaleString(),T.textSec],["Avg Win%",(results.reduce((a,s)=>a+s.stats.wr,0)/Math.max(1,results.filter(s=>s.stats.total>0).length)).toFixed(1)+"%",T.bull],["Avg PnL",(results.reduce((a,s)=>a+s.stats.totPnl,0)/Math.max(1,results.length)).toFixed(2)+"%",T.warn],["Top PnL",Math.max(...results.map(s=>s.stats.totPnl)).toFixed(1)+"%",T.bull]].map(([l,v,c])=>(
            <div key={l} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:6,padding:10,textAlign:"center"}}>
              <div style={{fontSize:8,color:T.textSec}}>{l}</div>
              <div style={{fontSize:13,fontWeight:700,color:c,marginTop:3}}>{v}</div>
            </div>
          ))}
        </div>
      )}

      {results ? (
        <div className="card">
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <div style={{fontSize:8,color:T.textSec}}>{sorted.length} estrategias · página {page+1}/{totalPages}</div>
            <div style={{display:"flex",gap:4}}>
              <button onClick={()=>setPage(p=>Math.max(0,p-1))} disabled={page===0} style={{background:"transparent",border:`1px solid ${T.border}`,color:T.textSec,padding:"3px 8px",borderRadius:3,cursor:"pointer",fontFamily:"inherit",fontSize:9}}>◀</button>
              <button onClick={()=>setPage(p=>Math.min(totalPages-1,p+1))} disabled={page>=totalPages-1} style={{background:"transparent",border:`1px solid ${T.border}`,color:T.textSec,padding:"3px 8px",borderRadius:3,cursor:"pointer",fontFamily:"inherit",fontSize:9}}>▶</button>
            </div>
          </div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
              <thead><tr style={{borderBottom:`1px solid ${T.border}`}}>{["ESTRATEGIA","TIPO","TRADES","WIN%","AVG W","AVG L","PnL TOT","MAX DD"].map(h2=><th key={h2} style={{padding:"5px 8px",textAlign:"left",color:T.textSec,fontSize:8,whiteSpace:"nowrap"}}>{h2}</th>)}</tr></thead>
              <tbody>
                {paged.map((s,i)=>{
                  const st=s.stats;
                  const isExpanded=expandedRow===i+page*PER;
                  const longTrades=(s.trades||[]).filter(t=>t.side==="long").length;
                  const shortTrades=(s.trades||[]).filter(t=>t.side==="short").length;
                  const winLongs=(s.trades||[]).filter(t=>t.side==="long"&&t.pnl>0).length;
                  const winShorts=(s.trades||[]).filter(t=>t.side==="short"&&t.pnl>0).length;
                  return (
                    <React.Fragment key={i}>
                      <tr style={{borderBottom:`1px solid ${T.border}44`,cursor:"pointer",background:isExpanded?T.accent+"11":"transparent"}} onClick={()=>setExpandedRow(isExpanded?null:i+page*PER)}>
                        <td style={{padding:"5px 8px",color:T.text,fontWeight:600,whiteSpace:"nowrap"}}>{isExpanded?"▼":"▶"} {s.name}</td>
                        <td style={{padding:"5px 8px",color:T.textSec}}>{s.type}</td>
                        <td style={{padding:"5px 8px",color:T.textSec}}>{st.total}</td>
                        <td style={{padding:"5px 8px",color:st.wr>=55?T.bull:st.wr<45?T.bear:T.warn,fontWeight:700}}>{st.wr.toFixed(1)}%</td>
                        <td style={{padding:"5px 8px",color:T.bull}}>+{st.avgW.toFixed(2)}%</td>
                        <td style={{padding:"5px 8px",color:T.bear}}>{st.avgL.toFixed(2)}%</td>
                        <td style={{padding:"5px 8px",color:st.totPnl>=0?T.bull:T.bear,fontWeight:700}}>{st.totPnl>=0?"+":""}{st.totPnl.toFixed(2)}%</td>
                        <td style={{padding:"5px 8px",color:T.bear}}>-{st.mdd.toFixed(1)}%</td>
                      </tr>
                      {isExpanded&&(
                        <tr style={{background:T.accent+"08"}}>
                          <td colSpan={8} style={{padding:"10px 16px"}}>
                            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:10}}>
                              {[["LONGS",longTrades+" trades",T.bull],["WIN LONGS",longTrades>0?(winLongs/longTrades*100).toFixed(0)+"%":"N/A",T.bull],["SHORTS",shortTrades+" trades",T.bear],["WIN SHORTS",shortTrades>0?(winShorts/shortTrades*100).toFixed(0)+"%":"N/A",T.bear]].map(([l,v,c])=>(
                                <div key={l} style={{background:T.card,borderRadius:4,padding:"6px 8px"}}>
                                  <div style={{fontSize:7,color:T.textSec}}>{l}</div>
                                  <div style={{fontSize:11,color:c,fontWeight:700}}>{v}</div>
                                </div>
                              ))}
                            </div>
                            <div style={{fontSize:8,color:T.textSec,marginBottom:6}}>ÚLTIMOS 10 TRADES</div>
                            <div style={{display:"flex",flexDirection:"column",gap:2,maxHeight:160,overflowY:"auto"}}>
                              {(s.trades||[]).slice(-10).reverse().map((t,ti)=>(
                                <div key={ti} style={{display:"flex",gap:10,fontSize:9,padding:"3px 6px",background:t.pnl>0?T.bull+"11":T.bear+"11",borderRadius:3}}>
                                  <span style={{color:t.side==="long"?T.bull:T.bear,fontWeight:700,width:40}}>{t.side==="long"?"▲ L":"▼ S"}</span>
                                  <span style={{color:T.textSec}}>In: ${t.entry?.toFixed(0)}</span>
                                  <span style={{color:T.textSec}}>Out: ${t.exit?.toFixed(0)}</span>
                                  <span style={{color:t.pnl>0?T.bull:T.bear,fontWeight:700,marginLeft:"auto"}}>{t.pnl>=0?"+":""}{t.pnl.toFixed(2)}%</span>
                                  <span style={{color:T.textSec,width:28}}>{t.result?.toUpperCase()}</span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="card" style={{background:T.card,textAlign:"center",padding:32,color:T.textSec,fontSize:11}}>
          Selecciona timeframe y presiona ▶ EJECUTAR<br/>
          <span style={{fontSize:9}}>{ALL_STRATEGIES.length} estrategias · genera 3,000+ trades en 4H</span>
        </div>
      )}
    </div>
  );
}


// ── Auto refresh countdown ─────────────────────────────────
function RefreshCountdown({ theme: T }) {
  const [secs, setSecs] = useState(45);
  useEffect(() => {
    const t = setInterval(() => setSecs(s => s <= 1 ? 45 : s - 1), 1000);
    return () => clearInterval(t);
  }, []);
  const pct = (secs / 45) * 100;
  return (
    <div style={{display:"flex",alignItems:"center",gap:5,fontSize:8,color:T.textSec}}>
      <div style={{width:28,height:28,position:"relative"}}>
        <svg width="28" height="28" style={{transform:"rotate(-90deg)"}}>
          <circle cx="14" cy="14" r="11" fill="none" stroke={T.border} strokeWidth="2"/>
          <circle cx="14" cy="14" r="11" fill="none" stroke={secs<10?T.danger:T.accent} strokeWidth="2"
            strokeDasharray={`${2*Math.PI*11}`}
            strokeDashoffset={`${2*Math.PI*11*(1-pct/100)}`}
            style={{transition:"stroke-dashoffset 1s linear"}}/>
        </svg>
        <div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",fontSize:7,color:secs<10?T.danger:T.textSec,fontWeight:700}}>{secs}</div>
      </div>
    </div>
  );
}

// ── RSI/MACD Divergence Detector ───────────────────────────
function detectDivergences(klines) {
  if (!klines || klines.length < 30) return [];
  const c = klines.map(k => k.c);
  // Simple RSI calc inline
  const rsiVals = (() => {
    const p=14; if(c.length<p+2) return new Array(c.length).fill(50);
    const r=new Array(c.length).fill(null);let ag=0,al=0;
    for(let i=1;i<=p;i++){const d=c[i]-c[i-1];d>0?ag+=d:al-=d;}ag/=p;al/=p;
    r[p]=al===0?100:100-100/(1+ag/al);
    for(let i=p+1;i<c.length;i++){const d=c[i]-c[i-1];ag=(ag*(p-1)+Math.max(d,0))/p;al=(al*(p-1)+Math.max(-d,0))/p;r[i]=al===0?100:100-100/(1+ag/al);}
    return r;
  })();
  const divs = [];
  const W = Math.min(25, klines.length);
  const cs = c.slice(-W), rs = rsiVals.slice(-W).map(v=>v??50);
  const findSwings = (arr, lb=3) => {
    const hi=[], lo=[];
    for(let i=lb;i<arr.length-lb;i++){
      if(arr[i]===Math.max(...arr.slice(i-lb,i+lb+1))) hi.push(i);
      if(arr[i]===Math.min(...arr.slice(i-lb,i+lb+1))) lo.push(i);
    }
    return{hi,lo};
  };
  const ps=findSwings(cs), rs2=findSwings(rs);
  if(ps.hi.length>=2&&rs2.hi.length>=2){
    const ph1=ps.hi[ps.hi.length-2],ph2=ps.hi[ps.hi.length-1];
    const rh1=rs2.hi[rs2.hi.length-2],rh2=rs2.hi[rs2.hi.length-1];
    if(cs[ph2]>cs[ph1]&&rs[rh2]<rs[rh1])
      divs.push({type:"bearish",ind:"RSI",desc:"Precio HH → RSI LH — momentum agotado"});
  }
  if(ps.lo.length>=2&&rs2.lo.length>=2){
    const pl1=ps.lo[ps.lo.length-2],pl2=ps.lo[ps.lo.length-1];
    const rl1=rs2.lo[rs2.lo.length-2],rl2=rs2.lo[rs2.lo.length-1];
    if(cs[pl2]<cs[pl1]&&rs[rl2]>rs[rl1])
      divs.push({type:"bullish",ind:"RSI",desc:"Precio LL → RSI HL — reversión posible"});
  }
  return divs;
}

// ── Price Alert Panel ──────────────────────────────────────
function PriceAlertPanel({ price, notifPerm, onRequestNotif, theme: T }) {
  const [alerts, setAlerts] = useState(() => { try{return JSON.parse(localStorage.getItem("apex_palerts")||"[]");}catch{return[];} });
  const [newPrice, setNewPrice] = useState("");
  const [condition, setCondition] = useState("above");
  const triggeredRef = useRef(new Set());

  useEffect(() => {
    if (!price) return;
    alerts.forEach((a, i) => {
      const key = `${i}_${a.price}`;
      if (triggeredRef.current.has(key)) return;
      const triggered = a.cond === "above" ? price >= a.price : price <= a.price;
      if (triggered) {
        triggeredRef.current.add(key);
        if (notifPerm === "granted") new Notification(`🔔 APEX Alerta`, {body:`BTC ${a.cond==="above"?"llegó a":"bajó a"} $${a.price.toLocaleString()}`});
      }
    });
  }, [price, alerts, notifPerm]);

  const addAlert = () => {
    const p = parseFloat(newPrice);
    if (!p) return;
    const updated = [...alerts, {price:p, cond:condition, created:Date.now()}];
    setAlerts(updated);
    setNewPrice("");
    try{localStorage.setItem("apex_palerts",JSON.stringify(updated));}catch{}
  };
  const removeAlert = i => {
    const updated = alerts.filter((_,idx)=>idx!==i);
    setAlerts(updated);
    try{localStorage.setItem("apex_palerts",JSON.stringify(updated));}catch{}
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      <div className="card">
        <div style={{fontSize:8,color:T.textSec,letterSpacing:".14em",marginBottom:12}}>NUEVA ALERTA DE PRECIO</div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <div style={{display:"flex",gap:4}}>
            {["above","below"].map(c=>(
              <button key={c} onClick={()=>setCondition(c)} style={{background:condition===c?T.accent+"22":"transparent",border:`1px solid ${condition===c?T.accent:T.border}`,color:condition===c?T.accent:T.textSec,padding:"6px 12px",borderRadius:5,cursor:"pointer",fontFamily:"inherit",fontSize:10}}>
                {c==="above"?"▲ Sube a":"▼ Baja a"}
              </button>
            ))}
          </div>
          <input type="number" value={newPrice} onChange={e=>setNewPrice(e.target.value)} placeholder={`$${Math.round(price||0).toLocaleString()}`} style={{flex:1,minWidth:120,background:T.card,border:`1px solid ${T.border}`,color:T.text,fontFamily:"inherit",fontSize:11,padding:"7px 10px",borderRadius:5,outline:"none"}} onKeyDown={e=>e.key==="Enter"&&addAlert()}/>
          <button onClick={addAlert} style={{background:T.accent+"22",border:`1px solid ${T.accent}`,color:T.accent,padding:"7px 16px",borderRadius:5,cursor:"pointer",fontFamily:"inherit",fontSize:10,fontWeight:700}}>+ Agregar</button>
        </div>
        {notifPerm!=="granted"&&(
          <div style={{marginTop:10,display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:9,color:T.warn}}>⚠️ Activa notificaciones para recibir alertas</span>
            <button onClick={onRequestNotif} style={{background:T.warn+"22",border:`1px solid ${T.warn}`,color:T.warn,padding:"4px 10px",borderRadius:4,cursor:"pointer",fontFamily:"inherit",fontSize:9}}>Activar</button>
          </div>
        )}
      </div>
      {alerts.length>0?(
        <div className="card">
          <div style={{fontSize:8,color:T.textSec,letterSpacing:".14em",marginBottom:8}}>ALERTAS ACTIVAS ({alerts.length})</div>
          {alerts.map((a,i)=>{
            const dist=price?((a.price-price)/price*100).toFixed(2):null;
            const triggered=a.cond==="above"?price>=a.price:price<=a.price;
            return(
              <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 10px",marginBottom:4,background:triggered?T.bull+"11":T.card,border:`1px solid ${triggered?T.bull+"44":T.border}`,borderRadius:5}}>
                <div>
                  <span style={{fontSize:11,color:triggered?T.bull:T.text,fontWeight:700}}>${a.price.toLocaleString()}</span>
                  <span style={{fontSize:9,color:T.textSec,marginLeft:8}}>{a.cond==="above"?"▲ sube a":"▼ baja a"}</span>
                  {dist&&<span style={{fontSize:9,color:T.textSec,marginLeft:8}}>{dist}% desde precio</span>}
                </div>
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  {triggered&&<span style={{fontSize:8,color:T.bull,fontWeight:700}}>🔔 ACTIVA</span>}
                  <button onClick={()=>removeAlert(i)} style={{background:"none",border:`1px solid ${T.border}`,color:T.textSec,width:22,height:22,borderRadius:3,cursor:"pointer",fontSize:10,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
                </div>
              </div>
            );
          })}
        </div>
      ):(
        <div className="card" style={{textAlign:"center",padding:24,color:T.textSec,fontSize:11}}>Sin alertas activas · precio actual: ${price?Math.round(price).toLocaleString():"N/A"}</div>
      )}
    </div>
  );
}

// ── Trade Journal ──────────────────────────────────────────
function TradeJournal({ theme: T }) {
  const [trades, setTrades] = useState(() => { try{return JSON.parse(localStorage.getItem("apex_journal")||"[]");}catch{return[];} });
  const [form, setForm] = useState({side:"long",entry:"",exit:"",size:"",notes:"",date:new Date().toISOString().slice(0,10)});
  const [showForm, setShowForm] = useState(false);

  const saveTrade = () => {
    if (!form.entry || !form.exit) return;
    const entry=parseFloat(form.entry), exit=parseFloat(form.exit), size=parseFloat(form.size)||1;
    const pnl = form.side==="long" ? (exit-entry)/entry*100 : (entry-exit)/entry*100;
    const pnlUSD = form.side==="long" ? (exit-entry)*size : (entry-exit)*size;
    const updated = [{...form,entry,exit,size,pnl,pnlUSD,id:Date.now()}, ...trades];
    setTrades(updated);
    try{localStorage.setItem("apex_journal",JSON.stringify(updated.slice(0,100)));}catch{}
    setForm({side:"long",entry:"",exit:"",size:"",notes:"",date:new Date().toISOString().slice(0,10)});
    setShowForm(false);
  };

  const stats = trades.length ? {
    total: trades.length,
    wins: trades.filter(t=>t.pnl>0).length,
    wr: (trades.filter(t=>t.pnl>0).length/trades.length*100).toFixed(1),
    totalPnl: trades.reduce((a,t)=>a+(t.pnlUSD||0),0).toFixed(2),
    avgPnl: (trades.reduce((a,t)=>a+t.pnl,0)/trades.length).toFixed(2),
    bestTrade: Math.max(...trades.map(t=>t.pnl)).toFixed(2),
    worstTrade: Math.min(...trades.map(t=>t.pnl)).toFixed(2),
  } : null;

  const IS = {background:T.card,border:`1px solid ${T.border}`,color:T.text,fontFamily:"inherit",fontSize:11,padding:"7px 10px",borderRadius:5,outline:"none"};

  return (
    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      {stats&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:8}}>
          {[["TOTAL TRADES",stats.total,T.textSec],["WIN RATE",stats.wr+"%",parseFloat(stats.wr)>=55?T.bull:T.bear],["P&L TOTAL","$"+parseFloat(stats.totalPnl).toFixed(0),parseFloat(stats.totalPnl)>=0?T.bull:T.bear],["AVG P&L %",stats.avgPnl+"%",parseFloat(stats.avgPnl)>=0?T.bull:T.bear],["MEJOR TRADE","+"+stats.bestTrade+"%",T.bull],["PEOR TRADE",stats.worstTrade+"%",T.bear]].map(([l,v,c])=>(
            <div key={l} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:6,padding:"10px 12px"}}>
              <div style={{fontSize:7,color:T.textSec,marginBottom:3}}>{l}</div>
              <div style={{fontSize:13,color:c,fontWeight:700}}>{v}</div>
            </div>
          ))}
        </div>
      )}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{fontSize:9,color:T.textSec}}>{trades.length} trades registrados</div>
        <button onClick={()=>setShowForm(s=>!s)} style={{background:T.accent+"22",border:`1px solid ${T.accent}`,color:T.accent,padding:"6px 14px",borderRadius:5,cursor:"pointer",fontFamily:"inherit",fontSize:9,fontWeight:700}}>+ Registrar Trade</button>
      </div>
      {showForm&&(
        <div className="card">
          <div style={{fontSize:8,color:T.textSec,letterSpacing:".14em",marginBottom:12}}>NUEVO TRADE</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div>
              <div style={{fontSize:9,color:T.textSec,marginBottom:4}}>Lado</div>
              <div style={{display:"flex",gap:6}}>
                {["long","short"].map(s=>(
                  <button key={s} onClick={()=>setForm(f=>({...f,side:s}))} style={{flex:1,background:form.side===s?(s==="long"?T.bull+"22":T.bear+"22"):"transparent",border:`1px solid ${form.side===s?(s==="long"?T.bull:T.bear):T.border}`,color:form.side===s?(s==="long"?T.bull:T.bear):T.textSec,padding:"6px",borderRadius:4,cursor:"pointer",fontFamily:"inherit",fontSize:10}}>{s==="long"?"▲ LONG":"▼ SHORT"}</button>
                ))}
              </div>
            </div>
            <div><div style={{fontSize:9,color:T.textSec,marginBottom:4}}>Fecha</div><input style={{...IS,width:"100%"}} type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))}/></div>
            {[["Precio Entrada",form.entry,"entry"],["Precio Salida",form.exit,"exit"],["Tamaño (BTC)",form.size,"size"]].map(([l,v,k])=>(
              <div key={k}><div style={{fontSize:9,color:T.textSec,marginBottom:4}}>{l}</div><input style={{...IS,width:"100%"}} type="number" value={v} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))}/></div>
            ))}
            <div style={{gridColumn:"span 2"}}><div style={{fontSize:9,color:T.textSec,marginBottom:4}}>Notas</div><textarea value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} style={{...IS,width:"100%",height:60,resize:"vertical"}} placeholder="Setup, razón de entrada, aprendizaje..."/></div>
          </div>
          <div style={{display:"flex",gap:8,marginTop:12}}>
            <button onClick={saveTrade} style={{flex:1,background:T.accent+"22",border:`1px solid ${T.accent}`,color:T.accent,padding:"8px",borderRadius:5,cursor:"pointer",fontFamily:"inherit",fontSize:10,fontWeight:700}}>💾 Guardar Trade</button>
            <button onClick={()=>setShowForm(false)} style={{background:"none",border:`1px solid ${T.border}`,color:T.textSec,padding:"8px 16px",borderRadius:5,cursor:"pointer",fontFamily:"inherit",fontSize:10}}>Cancelar</button>
          </div>
        </div>
      )}
      <div style={{display:"flex",flexDirection:"column",gap:4,maxHeight:400,overflowY:"auto"}}>
        {trades.length===0?(
          <div className="card" style={{textAlign:"center",padding:32,color:T.textSec,fontSize:11}}>Sin trades registrados · Lleva control de tu performance</div>
        ):trades.map((t,i)=>(
          <div key={t.id||i} style={{display:"grid",gridTemplateColumns:"auto 1fr 1fr 1fr 1fr auto",gap:8,alignItems:"center",padding:"8px 12px",background:T.card,border:`1px solid ${t.pnl>=0?T.bull+"33":T.bear+"33"}`,borderRadius:6}}>
            <span style={{fontSize:10,color:t.side==="long"?T.bull:T.bear,fontWeight:700}}>{t.side==="long"?"▲":"▼"}</span>
            <span style={{fontSize:9,color:T.textSec}}>{t.date}</span>
            <span style={{fontSize:10,color:T.textSec}}>In: ${parseFloat(t.entry).toLocaleString()}</span>
            <span style={{fontSize:10,color:T.textSec}}>Out: ${parseFloat(t.exit).toLocaleString()}</span>
            <span style={{fontSize:11,color:t.pnl>=0?T.bull:T.bear,fontWeight:700}}>{t.pnl>=0?"+":""}{parseFloat(t.pnl).toFixed(2)}%</span>
            <button onClick={()=>{const u=trades.filter((_,j)=>j!==i);setTrades(u);try{localStorage.setItem("apex_journal",JSON.stringify(u));}catch{}}} style={{background:"none",border:`1px solid ${T.border}`,color:T.textSec,width:22,height:22,borderRadius:3,cursor:"pointer",fontSize:10,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Funding Calculator ─────────────────────────────────────
function FundingCalc({ mkt, theme: T }) {
  const [size, setSize] = useState("10000");
  const [hours, setHours] = useState("24");
  const IS = {background:T.card,border:`1px solid ${T.border}`,color:T.text,fontFamily:"inherit",fontSize:11,padding:"8px 12px",borderRadius:5,outline:"none",width:"100%"};
  const funding = mkt.funding ?? 0;
  const sizeN = parseFloat(size) || 0;
  const hoursN = parseFloat(hours) || 0;
  const fundingPer8h = funding / 100;
  const periods = hoursN / 8;
  const totalFunding = sizeN * fundingPer8h * periods;
  const totalPct = fundingPer8h * periods * 100;
  const isLong = totalFunding > 0;

  return (
    <div className="card">
      <div style={{fontSize:8,color:T.textSec,letterSpacing:".14em",marginBottom:14}}>CALCULADORA DE FUNDING ACUMULADO</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
        <div><div style={{fontSize:9,color:T.textSec,marginBottom:5}}>Tamaño posición (USDT)</div><input style={IS} type="number" value={size} onChange={e=>setSize(e.target.value)}/></div>
        <div><div style={{fontSize:9,color:T.textSec,marginBottom:5}}>Horas a mantener</div><input style={IS} type="number" value={hours} onChange={e=>setHours(e.target.value)}/></div>
      </div>
      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:7,padding:14,display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
        {[["Funding actual",funding>0?"+"+funding.toFixed(4)+"%":funding.toFixed(4)+"%",funding>0?T.danger:T.bull],["Períodos (c/8h)",periods.toFixed(1)+"x",T.textSec],["Costo total $",(Math.abs(totalFunding)).toFixed(4)+" USDT",Math.abs(totalFunding)>sizeN*0.01?T.danger:T.warn],["Costo total %",Math.abs(totalPct).toFixed(4)+"%",T.textSec],["Pagas/cobras",funding>0?"PAGAS (long)":"COBRAS (long)",funding>0?T.danger:T.bull],["Equivale a","$"+Math.abs(totalFunding/hoursN*24).toFixed(2)+"/día",T.textSec]].map(([l,v,c])=>(
          <div key={l}><div style={{fontSize:8,color:T.textSec,marginBottom:3}}>{l}</div><div style={{fontSize:12,color:c,fontWeight:700}}>{v}</div></div>
        ))}
      </div>
      <div style={{marginTop:10,fontSize:9,color:funding>0?T.danger:T.bull,lineHeight:1.8}}>
        {funding>0
          ? `⚠️ Con funding positivo (+${funding.toFixed(4)}%), mantener ${hours}h un long de $${parseFloat(size).toLocaleString()} cuesta $${Math.abs(totalFunding).toFixed(2)} USDT (${Math.abs(totalPct).toFixed(3)}%).`
          : `✓ Con funding negativo (${funding.toFixed(4)}%), mantener ${hours}h un long de $${parseFloat(size).toLocaleString()} GENERA $${Math.abs(totalFunding).toFixed(2)} USDT (${Math.abs(totalPct).toFixed(3)}%).`
        }
      </div>
    </div>
  );
}

// ── Sessions Panel ─────────────────────────────────────────
function SessionsPanel({ theme: T }) {
  const now = new Date();
  const utcH = now.getUTCHours() + now.getUTCMinutes()/60;
  const sessions = [
    {name:"TOKYO / ASIA",open:0,close:9,tz:"UTC+9",color:"#4a8aaa",vol:"Bajo",pairs:"BTC, JPY pairs",desc:"Movimientos más lentos. Menor liquidez. Cuidado con falsas rupturas."},
    {name:"FRANKFURT",open:7,close:10,tz:"UTC+1",color:"#8a6aaa",vol:"Medio",pairs:"BTC, EUR pairs",desc:"Apertura europea. Empieza a crecer la liquidez. Breakouts frecuentes."},
    {name:"LONDON",open:8,close:17,tz:"UTC+0",color:"#4aaa6a",vol:"Alto",pairs:"BTC, GBP pairs",desc:"Mayor volumen europeo. Alta liquidez. Trend days frecuentes."},
    {name:"NEW YORK OPEN",open:13,close:17,tz:"UTC-5",color:"#aaa44a",vol:"Máximo",pairs:"BTC, USD pairs",desc:"Mayor liquidez global. Overlap London+NY. Máximo volatilidad. Mejores setups."},
    {name:"NEW YORK TARDE",open:17,close:22,tz:"UTC-5",color:"#aa6a4a",vol:"Medio-Alto",pairs:"BTC, USD",desc:"Volumen decreciente. Posibles reversiones al cierre de posiciones."},
    {name:"CIERRE / ASIA",open:22,close:24,tz:"UTC+9",color:"#5a5a6a",vol:"Bajo",pairs:"BTC",desc:"Menor liquidez. Consolidación frecuente. Evitar apalancamiento alto."},
  ];
  return (
    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:4,height:12,borderRadius:6,overflow:"hidden"}}>
        {Array.from({length:24},(_,h)=>{const sess=sessions.find(s=>h>=s.open&&h<s.close)||sessions[5];const isCurr=utcH>=h&&utcH<h+1;return(<div key={h} style={{background:isCurr?"#fff":sess.color+(utcH>=h?"ff":"44"),position:"relative"}} title={`${h}:00 UTC — ${sess.name}`}>{isCurr&&<div style={{position:"absolute",top:0,bottom:0,left:0,right:0,background:"#fff",borderRadius:2}}/>}</div>);})}
      </div>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:7,color:T.textSec}}>
        {[0,4,8,12,16,20,24].map(h=><span key={h}>{h}:00</span>)}
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {sessions.map(s=>{
          const isActive=utcH>=s.open&&utcH<s.close;
          const remaining=isActive?Math.round((s.close-utcH)*60):null;
          const startsIn=!isActive&&utcH<s.open?Math.round((s.open-utcH)*60):null;
          return(
            <div key={s.name} style={{padding:"12px 14px",background:T.card,border:`2px solid ${isActive?s.color:T.border}`,borderRadius:8,opacity:isActive?1:0.75,transition:"all .3s"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{width:10,height:10,borderRadius:"50%",background:s.color,boxShadow:isActive?`0 0 8px ${s.color}`:undefined}}/>
                  <span style={{fontSize:12,fontWeight:700,color:isActive?s.color:T.textSec}}>{s.name}</span>
                  <span style={{fontSize:8,color:T.textSec}}>{s.tz}</span>
                </div>
                <div style={{textAlign:"right"}}>
                  {isActive&&<span style={{fontSize:10,color:s.color,fontWeight:700}}>ACTIVA · {remaining}m restantes</span>}
                  {startsIn&&<span style={{fontSize:9,color:T.textSec}}>Abre en {startsIn}m</span>}
                  {!isActive&&!startsIn&&<span style={{fontSize:9,color:T.textSec}}>{s.open}:00 – {s.close}:00 UTC</span>}
                </div>
              </div>
              <div style={{display:"flex",gap:16,fontSize:9}}>
                <span><span style={{color:T.textSec}}>Horario: </span><span style={{color:T.text}}>{s.open}:00 – {s.close}:00 UTC</span></span>
                <span><span style={{color:T.textSec}}>Volumen: </span><span style={{color:s.color,fontWeight:700}}>{s.vol}</span></span>
              </div>
              <div style={{fontSize:9,color:T.textSec,marginTop:5,lineHeight:1.6}}>{s.desc}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════
export default function App() {
  const [themeName,setThemeName]=useState(()=>{try{return localStorage.getItem("apex_theme")||"terminal";}catch{return"terminal";}});
  const T = THEMES[themeName] || THEMES.terminal;
  const changeTheme = n => { setThemeName(n); try{localStorage.setItem("apex_theme",n);}catch{} };

  const [mkt,setMkt]=useState({loading:true});
  const [inds,setInds]=useState({});
  const [rawK,setRawK]=useState({});
  const [onchain,setOnchain]=useState(null);
  const [news,setNews]=useState([]);
  const [alerts,setAlerts]=useState([]);
  const [cycle,setCycle]=useState(null);
  const [conn,setConn]=useState({});
  const [orderBook, setOB] = useState(null);
  const [tradeIdea, setTI] = useState(null);
  const [divergences, setDivergences] = useState([]);
  const lastTIRef = useRef(null);
  const [tab,setTab]=useState("dashboard");
  const [chartTf,setChartTf]=useState("4h");
  const [img,setImg]=useState(null);
  const [imgName,setImgName]=useState("");
  const [q,setQ]=useState("");
  const [analysis,setAna]=useState("");
  const [busy,setBusy]=useState(false);
  const [err,setErr]=useState("");
  const [chat,setChat]=useState([]);
  const [notifPerm,setNP]=useState(typeof Notification!=="undefined"?Notification.permission:"default");
  const fileRef=useRef();

  const SYS=`Eres APEX Trader BTC v8: trader profesional 15 años futuros Binance. TIPOS: Scalp(15M,<2h,R:R 1.5:1,max10x), DayTrade(1H,2-24h,R:R 2:1,max5x), Swing(4H/1D,días,R:R 3:1,max3x). REGLAS: min 3 confluencias, siempre SL, integra on-chain+ciclo+news. FORMATO: 📊 SETUP:[LONG/SHORT/ESPERAR] TIPO:[Scalp/DayTrade/Swing] | 🎯 SESGO | LECTURA 1D/4H/1H | NEWS IMPACT | 🟢 ENTRADA $$ | 🔴 SL $$ | ✅ TP1 TP2 TP3 R:R | ⚡ LEVERAGE | ✔ CONFLUENCIAS | ⚠️ INVALIDACIÓN | 📊 CONFIANZA. Español.`

  // Fetch market
  const fetchMkt=useCallback(async()=>{
    const nc={};
    const [tick,prem,oi,lsr,fng]=await Promise.all([
      safe(()=>fetch(`${B_SPOT}/api/v3/ticker/24hr?symbol=BTCUSDT`).then(r=>r.json())),
      safe(()=>fetch(`${B_FUT}/fapi/v1/premiumIndex?symbol=BTCUSDT`).then(r=>r.json())),
      safe(()=>fetch(`${B_FUT}/fapi/v1/openInterest?symbol=BTCUSDT`).then(r=>r.json())),
      safe(()=>fetch(`${B_FUT}/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1`).then(r=>r.json())),
      safe(()=>fetch(FG_API).then(r=>r.json())),
    ]);
    const m={loading:false,ts:new Date()};
    if(tick){m.price=+tick.lastPrice;m.change=+tick.priceChangePercent;m.high=+tick.highPrice;m.low=+tick.lowPrice;m.vol=+tick.quoteVolume;nc.binanceSpot=true;}
    if(prem){m.funding=+prem.lastFundingRate*100;m.mark=+prem.markPrice;m.index=+prem.indexPrice;nc.binanceFut=true;}
    if(oi)m.oi=+oi.openInterest;
    if(lsr?.[0]){m.lsr=+lsr[0].longShortRatio;m.longPct=+lsr[0].longAccount*100;m.shortPct=+lsr[0].shortAccount*100;}
    if(fng?.data?.[0]){m.fg=+fng.data[0].value;m.fgLabel=fng.data[0].value_classification;nc.fg=true;}
    setMkt(m);
    if(m.price) try{document.title=`₿ $${Math.round(m.price).toLocaleString()} ${m.change>=0?'▲':'▼'}${Math.abs(m.change||0).toFixed(2)}% — APEX`;}catch{}
    const [ob, byT, kraT] = await Promise.all([
      safe(()=>fetch(`${B_SPOT}/api/v3/depth?symbol=BTCUSDT&limit=20`).then(r=>r.json())),
      safe(()=>fetch(`${BYBIT}/v5/market/tickers?category=spot&symbol=BTCUSDT`).then(r=>r.json())),
      safe(()=>fetch(`${KRAKEN}/Ticker?pair=XBTUSD`).then(r=>r.json())),
    ]);
    if(ob) setOB(ob);
    if(byT?.result?.list?.[0]) m.bybitPrice = +byT.result.list[0].lastPrice;
    if(kraT?.result){const k=Object.values(kraT.result)[0];if(k)m.krakenPrice=+k.c[0];}
    const kd={};
    await Promise.all(TFS.map(async tf=>{
      const raw=await safe(()=>fetch(`${B_SPOT}/api/v3/klines?symbol=BTCUSDT&interval=${tf}&limit=${TFLIM[tf]}`).then(r=>r.json()));
      if(raw?.length){kd[tf]=raw.map(k=>({t:k[0],o:+k[1],h:+k[2],l:+k[3],c:+k[4],v:+k[5]}));nc[`k_${tf}`]=raw.length;}
    }));
    const ni={};for(const tf of TFS)if(kd[tf])ni[tf]=runInds(kd[tf]);
    setInds(ni);setRawK(kd);setConn(c=>({...c,...nc,ts:new Date()}));
    setAlerts(getAlerts(m,ni));
    if(m.price){setCycle(getBTCCycle(m.price));
      if(kd["4h"]){
        const divs4h=detectDivergences(kd["4h"]);
        setDivergences(divs4h);
      }
      const ti=scoreTradeIdea(m,ni);if(ti&&ti.side!==lastTIRef.current?.side){setTI(ti);lastTIRef.current=ti;if(ti.confidence==="ALTA"&&notifPerm==="granted")new Notification("🚨 APEX: "+ti.side+" BTC",{body:"$"+Math.round(ti.price)+" | Confianza ALTA"});}}
  },[]);

  // Fetch on-chain
  const fetchOnchain=useCallback(async()=>{
    const [diff,height,mem,fees,blocks]=await Promise.all([
      safe(()=>fetch(`${MEMPOOL}/v1/difficulty-adjustment`).then(r=>r.json())),
      safe(()=>fetch(`${MEMPOOL}/blocks/tip/height`).then(r=>r.json())),
      safe(()=>fetch(`${MEMPOOL}/mempool`).then(r=>r.json())),
      safe(()=>fetch(`${MEMPOOL}/v1/fees/recommended`).then(r=>r.json())),
      safe(()=>fetch(`${MEMPOOL}/v1/blocks`).then(r=>r.json())),
    ]);
    const hr=diff?.currentDifficultyAdjustment?(diff.currentDifficultyAdjustment/7.158e18)*1000:null;
    setOnchain({hr,diffAdj:diff?.difficultyChange??null,height:typeof height==="number"?height:null,mempool:mem?.count,fee:fees?.fastestFee,feeMid:fees?.halfHourFee,feeHour:fees?.hourFee,recentBlocks:Array.isArray(blocks)?blocks.slice(0,10):[]});
    setConn(c=>({...c,onchain:!!hr}));
  },[]);

  // Fetch news from multiple sources
  const fetchNews=useCallback(async()=>{
    // Each source is independent - failure of one doesn't break others
    const fetches = NEWS_SOURCES.map(src =>
      fetch(src.url).then(r=>r.json()).then(d=>({ok:true,data:d,name:src.name})).catch(()=>({ok:false,data:null,name:src.name}))
    );
    const results = await Promise.allSettled(fetches);
    const all=[]; let successCount=0;
    results.forEach(r=>{
      if(r.status!=="fulfilled")return;
      const {ok,data,name}=r.value;
      if(!ok||!data)return;
      if(Array.isArray(data?.items)){
        successCount++;
        data.items.forEach(item=>all.push({
          title:item.title||"",url:item.link||"#",
          published_on:Math.floor(new Date(item.pubDate||Date.now()).getTime()/1000),
          source_info:{name},body:item.description||item.content||""
        }));
      }
    });
    const seen=new Set();
    const deduped=all.filter(n=>{const k=n.title.slice(0,40);if(seen.has(k))return false;seen.add(k);return true;});
    deduped.sort((a,b)=>b.published_on-a.published_on);
    setNews(deduped.slice(0,50));
    setConn(c=>({...c,news:deduped.length>0,newsCount:successCount}));
  },[]);

  useEffect(()=>{fetchMkt();fetchOnchain();fetchNews();const t1=setInterval(fetchMkt,45000);const t2=setInterval(fetchOnchain,90000);const t3=setInterval(fetchNews,180000);return()=>{clearInterval(t1);clearInterval(t2);clearInterval(t3);};},[]);

  // Claude call
  const callApex=async(userMsg,isChat=false)=>{
    setBusy(true);setErr("");
    if(isChat&&userMsg)setChat(p=>[...p,{role:"user",text:userMsg}]);
    try{
      const ctx=buildCtx(mkt,inds,onchain,cycle,news);
      const promptText=`${SYS}\n\nDATOS MERCADO BINANCE EN VIVO:\n${ctx}\n\n${userMsg||"Dame setup APEX completo con entrada, SL y TPs."}`;
      let content;
      if(img){
        const compressed=await compressImg(img);
        content=[{type:"image",source:{type:"base64",media_type:"image/jpeg",data:compressed}},{type:"text",text:promptText}];
      }else{
        content=promptText;
      }
      // Retry once on rate limit (529)
      let res; 
      for(let attempt=0;attempt<2;attempt++){
        res=await fetch(CLAUDE,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1000,messages:[{role:"user",content}]})});
        if(res.status===529){await new Promise(r=>setTimeout(r,3000));continue;}
        break;
      }
      if(!res.ok){const e=await res.json().catch(()=>({}));throw new Error(e?.error?.message||`HTTP ${res.status} — espera unos segundos e intenta de nuevo`);}
      const data=await res.json();
      const reply=data.content?.find(b=>b.type==="text")?.text||data.content?.[0]?.text||"Sin respuesta.";
      if(isChat)setChat(p=>[...p,{role:"assistant",text:reply}]);
      else setAna(reply);
      return reply;
    }catch(e){
      const msg=e?.message||"Error de conexión";
      setErr("⚠️ "+msg+(msg.includes("fetch")?" — verifica conexión o intenta en 10s":""));
      if(isChat)setChat(p=>[...p,{role:"assistant",text:"⚠️ "+msg}]);
      return null;
    }finally{setBusy(false);}
  };

  const onAnalyze=async()=>{const r=await callApex(q,false);if(r)setTab("setup");};
  const onSend=async()=>{if(!q.trim())return;const qq=q;setQ("");await callApex(qq,true);};
  const onFile=e=>{const f=e.target.files?.[0];if(!f)return;setImgName(f.name);const rd=new FileReader();rd.onload=ev=>setImg(ev.target.result.split(",")[1]);rd.readAsDataURL(f);};
  const requestNotif=async()=>{if(typeof Notification==="undefined")return;const p=await Notification.requestPermission();setNP(p);};

  const sess=getSession();
  const PC=mkt.change>=0?T.bull:T.danger;
  const FC=mkt.funding>0.05?T.danger:mkt.funding<-0.01?T.bull:mkt.funding>0.01?T.warn:T.accent;
  const ind=inds[chartTf];
  const dangerCnt=alerts.filter(a=>a.lvl==="danger").length;

  const TABS=["dashboard","chart","cycle","indicators","vpvr","orderbook","heatmap","onchain","news","setup","chat","tradeideas","backtest","calc","alerts","journal","sessions","funding","status"];
  const TLBLS=["📊 Mercado","📈 Chart","🌈 Ciclo","📊 Indicadores","📉 VPVR","📖 OBook","🔥 Heatmap","⛓ OnChain","📰 News","⚡ Setup","💬 Chat","🚨 Ideas","🔬 Backtest","🧮 Calc","🔔 Alertas","📓 Diario","🕐 Sesiones","💸 Funding","🔗 Status"];

  if(mkt.loading)return(
    <div style={{background:T.bg,minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'JetBrains Mono',monospace"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700;800&display=swap');@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:56,color:"#f7931a",animation:"spin 2s linear infinite",display:"inline-block"}}>₿</div>
        <div style={{color:T.textSec,fontSize:9,letterSpacing:".3em",marginTop:14}}>CARGANDO APEX TRADER v7...</div>
      </div>
    </div>
  );

  return(
    <div style={{background:T.bg,minHeight:"100vh",color:T.text,fontFamily:"'JetBrains Mono',monospace",fontSize:13}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700;800&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:${T.border}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        .card{background:${T.card};border:1px solid ${T.border};border-radius:8px;padding:16px;animation:fadeUp .3s ease both}
        .tab-btn{background:none;border:none;cursor:pointer;font-family:inherit;font-size:9px;letter-spacing:.07em;padding:6px 10px;border-radius:5px;transition:all .2s;white-space:nowrap}
        .analyze-btn{background:${T.accent}22;border:1px solid ${T.accent};color:${T.accent};padding:12px;border-radius:7px;cursor:pointer;font-family:inherit;font-size:11px;letter-spacing:.12em;text-transform:uppercase;width:100%;transition:all .2s;font-weight:700}
        .analyze-btn:hover{background:${T.accent}33}
        .analyze-btn:disabled{opacity:.4;cursor:not-allowed}
        .ghost{background:none;border:1px solid ${T.border};color:${T.textSec};padding:5px 10px;border-radius:5px;cursor:pointer;font-family:inherit;font-size:9px;transition:all .2s}
        .ghost:hover{border-color:${T.accent};color:${T.accent}}
        input,textarea{background:${T.bg};border:1px solid ${T.border};color:${T.text};font-family:inherit;font-size:11px;padding:9px 12px;border-radius:6px;outline:none;transition:border .2s}
        input:focus,textarea:focus{border-color:${T.accent}}
        .upload{border:2px dashed ${T.border};border-radius:7px;padding:14px;text-align:center;cursor:pointer;transition:all .2s}
        .upload:hover{border-color:${T.accent};background:${T.accent}08}
        a{color:inherit;text-decoration:none}
      `}</style>

      {/* HEADER */}
      <div style={{background:T.card,borderBottom:`1px solid ${T.border}`,padding:"10px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:99}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{width:38,height:38,borderRadius:"50%",background:"linear-gradient(135deg,#f7931a,#d06010)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:19,fontWeight:900,color:"#fff",boxShadow:"0 0 18px #f7931a44"}}>₿</div>
          <div>
            <div style={{fontSize:14,fontWeight:800,color:T.text,letterSpacing:".1em"}}>
              APEX TRADER BTC <span style={{fontSize:9,color:T.textSec,fontWeight:400}}>v7</span>
              {dangerCnt>0&&<span style={{marginLeft:8,background:T.danger+"22",border:`1px solid ${T.danger}44`,color:T.danger,fontSize:8,padding:"1px 6px",borderRadius:3}}>{dangerCnt} ALERTA{dangerCnt>1?"S":""}</span>}
            </div>
            <div style={{fontSize:7,color:T.muted,letterSpacing:".18em"}}>{sess.n} · {new Date().toUTCString().split(" ")[4]} UTC · {cycle?.phase||"..."}</div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:16}}>
          {/* Theme switcher */}
          <div style={{display:"flex",gap:4}}>
            {Object.keys(THEMES).map(name=>(
              <button key={name} title={name} onClick={()=>changeTheme(name)} style={{width:18,height:18,borderRadius:"50%",border:`2px solid ${themeName===name?"#fff":"transparent"}`,background:THEMES[name].accent,cursor:"pointer",padding:0}}/>
            ))}
          </div>
          <RefreshCountdown theme={T}/>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:22,fontWeight:800,color:PC}}>${fmt(mkt.price)}</div>
            <div style={{fontSize:9,color:PC}}>{mkt.change>=0?"▲":"▼"}{Math.abs(mkt.change).toFixed(2)}% 24h</div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:2}}>
            {["1d","4h","1h"].map(tf=>(
              <div key={tf} style={{display:"flex",gap:5,alignItems:"center"}}>
                <span style={{fontSize:7,color:T.muted,width:16}}>{TFLBL[tf]}</span>
                <span style={{fontSize:9,fontWeight:700,color:bCol(inds[tf]?.bias,T)}}>{inds[tf]?.bias||"..."}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{padding:"10px 20px",width:"100%"}}>
        {/* TICKER */}
        <div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:6,marginBottom:10,flexWrap:"wrap"}}>
          {[["FUNDING",mkt.funding!=null?(mkt.funding>0?"+":"")+fmt(mkt.funding,4)+"%":"—",FC],["OI",mkt.oi?fmt(mkt.oi,0)+" BTC":"—","#8ab0aa"],["L/S",mkt.lsr?fmt(mkt.lsr,2):"—",mkt.lsr>1.6?T.danger:mkt.lsr<0.65?T.bull:T.warn],["F&G",mkt.fg!=null?`${mkt.fg} — ${mkt.fgLabel}`:"—",mkt.fg<25?T.danger:mkt.fg>75?T.warn:T.bull],["MARK","$"+fmt(mkt.mark),T.textSec],["SESIÓN",sess.n,sess.c||T.accent],
            ["BYBIT",mkt.bybitPrice?"$"+fmt(mkt.bybitPrice,0):"—",T.textSec],
            ["KRAKEN",mkt.krakenPrice?"$"+fmt(mkt.krakenPrice,0):"—",T.textSec]].map(([l,v,c])=>(
            <div key={l} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:6,padding:"6px 14px",flexShrink:0,minWidth:120}}>
              <div style={{fontSize:8,color:T.muted,letterSpacing:".12em",marginBottom:2}}>{l}</div>
              <div style={{fontSize:12,color:c,fontWeight:700}}>{v}</div>
            </div>
          ))}
        </div>

        {/* TABS */}
        <div style={{display:"flex",gap:1,marginBottom:14,background:T.bg,borderRadius:8,padding:3,border:`1px solid ${T.border}`,overflowX:"auto"}}>
          {TABS.map((t,i)=>(
            <button key={t} className="tab-btn" onClick={()=>setTab(t)} style={{flex:1,minWidth:52,color:tab===t?T.accent:T.muted,background:tab===t?T.accent+"22":"transparent",fontWeight:tab===t?700:400,border:tab===t?`1px solid ${T.accent}33`:"1px solid transparent"}}>
              {TLBLS[i]}
            </button>
          ))}
        </div>

        {/* ══ DASHBOARD ══ */}
        {tab==="dashboard"&&(
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:12}}>
            <div className="card" style={{gridColumn:"span 2",borderLeft:`4px solid ${PC}`}}>
              <div style={{fontSize:8,color:T.muted,letterSpacing:".16em",marginBottom:8}}>PRECIO · BTC/USDT PERP BINANCE</div>
              <div style={{fontSize:42,fontWeight:800,color:PC}}>${fmt(mkt.price)}</div>
              <div style={{display:"flex",gap:20,marginTop:12,paddingTop:12,borderTop:`1px solid ${T.border}`,flexWrap:"wrap"}}>
                {[["HIGH 24H","$"+fmt(mkt.high),T.bull],["LOW 24H","$"+fmt(mkt.low),T.danger],["VOLUMEN",fmtB(mkt.vol),T.textSec],["MARK","$"+fmt(mkt.mark),T.warn],["ATR 4H","$"+fmt(inds["4h"]?.atr),T.textSec],["CICLO",cycle?.phase?.split(" ").slice(0,2).join(" ")||"...",cycle?.col||T.textSec]].map(([l,v,c])=>(
                  <div key={l}><div style={{fontSize:8,color:T.muted}}>{l}</div><div style={{color:c,fontSize:12,fontWeight:700,marginTop:2}}>{v}</div></div>
                ))}
              </div>
            </div>
            <div className="card">
              <div style={{fontSize:8,color:T.muted,letterSpacing:".14em",marginBottom:8}}>FUNDING RATE</div>
              <div style={{fontSize:22,fontWeight:700,color:FC}}>{mkt.funding!=null?(mkt.funding>0?"+":"")+fmt(mkt.funding,4)+"%":"—"}</div>
              <div style={{height:4,background:T.bg,borderRadius:2,margin:"10px 0",position:"relative",overflow:"hidden"}}><div style={{position:"absolute",left:"50%",top:0,width:1,height:"100%",background:T.border}}/>{mkt.funding!=null&&<div style={{height:"100%",width:`${Math.min(Math.abs(mkt.funding)/0.1*50,50)}%`,marginLeft:mkt.funding>=0?"50%":`${50-Math.min(Math.abs(mkt.funding)/0.1*50,50)}%`,background:FC,borderRadius:2}}/>}</div>
              <div style={{fontSize:10,color:FC}}>{mkt.funding>0.05?"🔴 Longs sobreextendidos":mkt.funding>0.01?"🟡 Sesgado long":mkt.funding>-0.01?"🟢 Neutral":"🟢 Shorts pagando"}</div>
            </div>
            <div className="card">
              <div style={{fontSize:8,color:T.muted,letterSpacing:".14em",marginBottom:8}}>OPEN INTEREST</div>
              <div style={{fontSize:22,fontWeight:700,color:T.accent}}>{mkt.oi?fmt(mkt.oi,0)+" BTC":"—"}</div>
              <div style={{fontSize:11,color:T.textSec,marginTop:4}}>{mkt.oi&&mkt.price?fmtB(mkt.oi*mkt.price):"—"}</div>
              <div style={{marginTop:8,fontSize:9,color:T.muted,lineHeight:1.7}}>OI↑+P↑ = tendencia<br/>OI↑+P↓ = shorts abriendo</div>
            </div>
            <div className="card" style={{borderTop:`3px solid ${mkt.lsr>1.6?T.danger:mkt.lsr<0.65?T.bull:T.warn}`}}>
              <div style={{fontSize:8,color:T.muted,letterSpacing:".14em",marginBottom:8}}>LONG / SHORT RATIO</div>
              <div style={{fontSize:22,fontWeight:700,color:mkt.lsr>1.6?T.danger:mkt.lsr<0.65?T.bull:T.warn}}>{mkt.lsr?fmt(mkt.lsr,2):"—"}</div>
              {mkt.longPct&&<><div style={{height:5,background:T.bg,borderRadius:3,overflow:"hidden",margin:"8px 0"}}><div style={{height:"100%",width:`${mkt.longPct}%`,background:`linear-gradient(to right,${T.bull},${T.bull}88)`}}/></div><div style={{display:"flex",justifyContent:"space-between",fontSize:10}}><span style={{color:T.bull}}>L {fmt(mkt.longPct,1)}%</span><span style={{color:T.danger}}>S {fmt(mkt.shortPct,1)}%</span></div></>}
              <div style={{fontSize:10,color:mkt.lsr>1.6?T.danger:mkt.lsr<0.65?T.bull:T.warn,marginTop:8}}>{mkt.lsr>1.6?"⚠️ Exceso longs → flush":mkt.lsr<0.65?"⚠️ Exceso shorts → squeeze":"✓ Equilibrado"}</div>
            </div>
            <div className="card">
              <div style={{fontSize:8,color:T.muted,letterSpacing:".14em",marginBottom:8}}>FEAR & GREED</div>
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <div style={{fontSize:38,fontWeight:800,color:mkt.fg<25?T.danger:mkt.fg<45?"#ff8c00":mkt.fg<55?T.warn:mkt.fg<75?"#7bed9f":T.bull}}>{mkt.fg??""}</div>
                <div>
                  <div style={{fontSize:14,color:mkt.fg<25?T.danger:mkt.fg>75?T.bull:T.warn,fontWeight:700}}>{mkt.fgLabel??""}</div>
                  <div style={{height:4,background:`linear-gradient(to right,${T.danger},${T.warn},${T.bull})`,borderRadius:2,width:100,marginTop:8,position:"relative"}}>
                    <div style={{position:"absolute",top:-4,left:`${mkt.fg??50}%`,width:10,height:10,background:T.text,borderRadius:"50%",transform:"translateX(-50%)",boxShadow:`0 0 4px ${T.text}88`}}/>
                  </div>
                </div>
              </div>
            </div>
            {alerts.length>0&&(
              <div className="card" style={{gridColumn:"span 2",background:T.bg,border:`1px solid ${T.border}`}}>
                <div style={{fontSize:8,color:T.muted,letterSpacing:".14em",marginBottom:10}}>⚡ ALERTAS ACTIVAS ({alerts.length})</div>
                <div style={{display:"flex",flexDirection:"column",gap:4,maxHeight:130,overflowY:"auto"}}>
                  {alerts.slice(0,6).map((a,i)=>(
                    <div key={i} style={{display:"flex",gap:8,fontSize:10}}>
                      <span style={{flexShrink:0}}>{a.icon}</span>
                      <span style={{color:a.lvl==="danger"?T.danger:a.lvl==="good"?T.bull:T.warn,lineHeight:1.5}}>{a.msg}</span>
                      <span style={{fontSize:8,color:T.muted,flexShrink:0,marginLeft:"auto"}}>{a.tf}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══ CHART ══ */}
        {tab==="chart"&&(
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <div className="card">
              <div style={{fontSize:8,color:T.muted,letterSpacing:".14em",marginBottom:10}}>GRÁFICO DE VELAS — BTC/USDT · {TFLBL[chartTf]}</div>
              <CandleChart klines={rawK[chartTf]} theme={T} tf={chartTf} onTfChange={setChartTf} onSendToSetup={()=>{setQ("Analiza S/R del gráfico y dame setup completo.");setTab("setup");}}/>
              <div style={{display:"flex",gap:12,marginTop:10,flexWrap:"wrap"}}>
                {inds[chartTf]&&[["EMA 9",inds[chartTf].ema.e9,"#3b82f6"],["EMA 21",inds[chartTf].ema.e21,"#22c55e"],["EMA 50",inds[chartTf].ema.e50,"#f97316"],["EMA 200",inds[chartTf].ema.e200,"#ef4444"]].map(([l,v,c])=>(
                  <div key={l} style={{display:"flex",alignItems:"center",gap:4}}>
                    <div style={{width:20,height:2,background:c,borderRadius:1}}/>
                    <span style={{fontSize:9,color:T.textSec}}>{l}: ${fmt(v)}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* RSI panel */}
            {inds[chartTf]&&(
              <div className="card">
                <div style={{fontSize:8,color:T.muted,letterSpacing:".14em",marginBottom:8}}>RSI 14 · {fmt(inds[chartTf].rsi,1)}</div>
                <div style={{position:"relative",height:40,background:T.bg,borderRadius:4}}>
                  {[30,50,70].map(lv=>(
                    <div key={lv} style={{position:"absolute",left:0,right:0,top:`${100-(lv/100)*100}%`,height:1,background:T.border,opacity:.6}}>
                      <span style={{position:"absolute",right:4,fontSize:7,color:T.muted,lineHeight:1}}>{lv}</span>
                    </div>
                  ))}
                  <div style={{position:"absolute",bottom:0,left:0,height:`${inds[chartTf].rsi||50}%`,width:8,background:rCol(inds[chartTf].rsi,T),borderRadius:2}}/>
                  <div style={{position:"absolute",top:"50%",left:20,fontSize:10,color:rCol(inds[chartTf].rsi,T),fontWeight:700,transform:"translateY(-50%)"}}>
                    RSI: {fmt(inds[chartTf].rsi,1)} — {inds[chartTf].rsi>=70?"SOBRECOMPRA":inds[chartTf].rsi<=30?"SOBREVENTA":inds[chartTf].rsi>50?"BULLISH":"NEUTRAL"}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══ CYCLE ══ */}
        {tab==="cycle"&&<CyclePanel cycle={cycle} theme={T}/>}

        {/* ══ INDICATORS ══ */}
        {tab==="indicators"&&(
          <div>
            <div style={{display:"flex",gap:4,marginBottom:12,background:T.bg,borderRadius:6,padding:3,border:`1px solid ${T.border}`,width:"fit-content"}}>
              {TFS.map(tf=><button key={tf} className="tab-btn" onClick={()=>setChartTf(tf)} style={{color:chartTf===tf?T.accent:T.muted,background:chartTf===tf?T.accent+"22":"transparent",fontWeight:chartTf===tf?700:400,fontSize:10}}>{TFLBL[tf]}</button>)}
            </div>
            {ind?(
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:10}}>
                <div className="card" style={{gridColumn:"span 2",borderLeft:`4px solid ${bCol(ind.bias,T)}`}}>
                  <div style={{fontSize:8,color:T.muted,letterSpacing:".14em",marginBottom:8}}>SESGO {TFLBL[chartTf]} — CONSENSO TÉCNICO</div>
                  <div style={{display:"flex",alignItems:"center",gap:14}}>
                    <div style={{fontSize:24,fontWeight:800,color:bCol(ind.bias,T)}}>{ind.bias}</div>
                    <div style={{flex:1}}><div style={{fontSize:10,color:T.textSec,marginBottom:4}}>{ind.score} / 9 indicadores alcistas</div><ScoreBar score={ind.score} theme={T}/></div>
                  </div>
                  <div style={{display:"flex",gap:8,marginTop:12,flexWrap:"wrap"}}>
                    {[["RSI",fmt(ind.rsi,1),rCol(ind.rsi,T),ind.rsi>=70?"OB":ind.rsi<=30?"OS":ind.rsi>50?"BULL":"BEAR"],["MACD H",fmt(ind.macd.hist,2),ind.macd.hist>0?T.bull:T.danger,ind.macd.hist>ind.macd.prev?"ACEL ▲":"DECEL ▼"],["BB %B",fmt(ind.bb.pct,1)+"%",ind.bb.pct>80?T.danger:ind.bb.pct<20?T.bull:T.warn,ind.bb.width<1.5?"SQUEEZE!":ind.bb.pct>80?"TECHO":"SUELO"],["STOCH K",fmt(ind.stoch.k,1),ind.stoch.k>80?T.danger:ind.stoch.k<20?T.bull:T.warn,ind.stoch.k>ind.stoch.d?"K>D":"K<D"],["ATR","$"+fmt(ind.atr),T.textSec,fmt((ind.atr/mkt.price)*100,2)+"%"]].map(([l,v,c,sub])=>(
                      <div key={l} style={{background:T.bg,border:`1px solid ${c}22`,borderRadius:6,padding:"8px 12px",minWidth:95}}>
                        <div style={{fontSize:8,color:T.muted,marginBottom:3}}>{l}</div>
                        <div style={{fontSize:14,fontWeight:700,color:c}}>{v}</div>
                        <div style={{fontSize:8,color:T.textSec,marginTop:2}}>{sub}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="card">
                  <div style={{fontSize:8,color:T.muted,letterSpacing:".14em",marginBottom:10}}>EMAs · ${fmt(mkt.price)}</div>
                  {[["EMA 9",ind.ema.e9],["EMA 21",ind.ema.e21],["EMA 50",ind.ema.e50],["EMA 100",ind.ema.e100],["EMA 200",ind.ema.e200]].map(([l,v])=>(
                    <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:`1px solid ${T.border}`}}>
                      <span style={{fontSize:10,color:T.textSec}}>{l}</span>
                      <span style={{fontSize:11,color:mkt.price>v?T.bull:T.danger,fontWeight:700}}>${fmt(v)} {mkt.price>v?"↑":"↓"}{Math.abs(pct(mkt.price,v))}%</span>
                    </div>
                  ))}
                </div>
                <div className="card">
                  <div style={{fontSize:8,color:T.muted,letterSpacing:".14em",marginBottom:10}}>MACD (12,26,9)</div>
                  {[["Línea",ind.macd.line,ind.macd.line>0?T.bull:T.danger],["Signal",ind.macd.signal,ind.macd.signal>0?T.bull:T.danger],["Histograma",ind.macd.hist,ind.macd.hist>0?T.bull:T.danger],["Hist prev",ind.macd.prev,ind.macd.prev>0?T.bull:T.danger]].map(([l,v,c])=>(
                    <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:`1px solid ${T.border}`}}>
                      <span style={{fontSize:10,color:T.textSec}}>{l}</span><span style={{fontSize:11,color:c,fontWeight:700}}>{fmt(v,2)}</span>
                    </div>
                  ))}
                  <div style={{marginTop:8,fontSize:10,color:ind.macd.hist>0&&ind.macd.hist>ind.macd.prev?T.bull:ind.macd.hist<0&&ind.macd.hist<ind.macd.prev?T.danger:T.warn}}>{ind.macd.hist>0&&ind.macd.hist>ind.macd.prev?"▲ Alcista acelerando":ind.macd.hist<0&&ind.macd.hist<ind.macd.prev?"▼ Bajista acelerando":"→ Mixto"}</div>
                </div>
                <div className="card">
                  <div style={{fontSize:8,color:T.muted,letterSpacing:".14em",marginBottom:10}}>BOLLINGER BANDS (20,2σ)</div>
                  {[["Upper",T.warn,ind.bb.upper],["Mid SMA20",T.textSec,ind.bb.mid],["Lower",T.bull,ind.bb.lower]].map(([l,c,v])=>(
                    <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:`1px solid ${T.border}`}}>
                      <span style={{fontSize:10,color:T.textSec}}>{l}</span><span style={{fontSize:11,color:c,fontWeight:700}}>${fmt(v)}</span>
                    </div>
                  ))}
                  <div style={{marginTop:10}}>
                    <div style={{height:5,background:`linear-gradient(to right,${T.bull},${T.warn},${T.danger})`,borderRadius:3,position:"relative"}}>
                      <div style={{position:"absolute",top:-4,left:`${Math.max(0,Math.min(100,ind.bb.pct))}%`,width:10,height:10,background:T.text,borderRadius:"50%",transform:"translateX(-50%)",boxShadow:`0 0 4px ${T.text}88`}}/>
                    </div>
                    <div style={{fontSize:9,color:T.textSec,marginTop:6}}>Ancho: {fmt(ind.bb.width,2)}% {ind.bb.width<1.5?"⚡ SQUEEZE — breakout próximo":""}</div>
                  </div>
                </div>
                <div className="card">
                  <div style={{fontSize:8,color:T.muted,letterSpacing:".14em",marginBottom:10}}>STOCHASTIC RSI</div>
                  <div style={{display:"flex",gap:16,marginBottom:10}}>
                    <div><div style={{fontSize:9,color:T.muted}}>K</div><div style={{fontSize:24,fontWeight:700,color:ind.stoch.k>80?T.danger:ind.stoch.k<20?T.bull:T.warn}}>{fmt(ind.stoch.k,1)}</div></div>
                    <div><div style={{fontSize:9,color:T.muted}}>D</div><div style={{fontSize:24,fontWeight:700,color:ind.stoch.d>80?T.danger:ind.stoch.d<20?T.bull:T.warn}}>{fmt(ind.stoch.d,1)}</div></div>
                  </div>
                  <div style={{height:5,background:T.bg,borderRadius:3,position:"relative",marginBottom:5}}>
                    <div style={{position:"absolute",left:"0%",top:-1,width:"20%",height:7,background:T.bull+"22",borderRadius:2}}/>
                    <div style={{position:"absolute",left:"80%",top:-1,width:"20%",height:7,background:T.danger+"22",borderRadius:2}}/>
                    {ind.stoch.k!=null&&<div style={{position:"absolute",top:0,left:`${Math.max(0,Math.min(100,ind.stoch.k))}%`,width:7,height:5,background:T.accent,borderRadius:1,transform:"translateX(-50%)"}}/>}
                  </div>
                  <div style={{fontSize:10,color:ind.stoch.k>80?T.danger:ind.stoch.k<20?T.bull:T.warn}}>{ind.stoch.k>80?"⚠️ Sobrecompra":ind.stoch.k<20?"✓ Sobreventa":"→ Neutral"} · {ind.stoch.k>ind.stoch.d?"K>D alcista":"K<D bajista"}</div>
                </div>
                <div className="card" style={{gridColumn:"span 2"}}>
                  <div style={{fontSize:8,color:T.muted,letterSpacing:".14em",marginBottom:10}}>FIBONACCI AUTO · {TFLBL[chartTf]} · Precio: ${fmt(mkt.price)}</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                    {[["RETROCESOS",ind.fib?.filter(f=>!f.isExt)],["EXTENSIONES",ind.fib?.filter(f=>f.isExt)]].map(([title,fibs])=>(
                      <div key={title}>
                        <div style={{fontSize:8,color:T.muted,marginBottom:6}}>{title}</div>
                        {fibs?.map((f,i)=>{const dist=Math.abs(((f.price-mkt.price)/mkt.price)*100),near=dist<1.5;return(
                          <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"4px 8px",borderRadius:4,marginBottom:2,background:near?T.accent+"11":"transparent",border:near?`1px solid ${T.accent}33`:"1px solid transparent"}}>
                            <span style={{fontSize:9,color:f.isExt?T.warn:T.textSec}}>{f.label}</span>
                            <span style={{fontSize:10,color:near?T.accent:T.textSec,fontWeight:near?700:400}}>${fmt(f.price)}</span>
                            <span style={{fontSize:8,color:T.muted}}>{near?"◀ CERCA":dist.toFixed(1)+"%"}</span>
                          </div>
                        );})}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="card" style={{gridColumn:"span 2",background:T.bg}}>
                  <div style={{fontSize:8,color:T.muted,letterSpacing:".14em",marginBottom:10}}>CONSENSO MULTI-TIMEFRAME</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
                    {TFS.map(tf=>{const i2=inds[tf];return(
                      <div key={tf} style={{background:T.card,border:`2px solid ${i2?bCol(i2.bias,T)+"44":T.border}`,borderRadius:7,padding:12,textAlign:"center"}}>
                        <div style={{fontSize:9,color:T.muted,marginBottom:4}}>{TFLBL[tf]}</div>
                        <div style={{fontSize:14,fontWeight:700,color:bCol(i2?.bias,T)}}>{i2?.bias||"..."}</div>
                        <div style={{fontSize:9,color:T.textSec,marginTop:3}}>{i2?`RSI:${fmt(i2.rsi,0)} MACD:${i2.macd.hist>0?"↑":"↓"}`:""}</div>
                        {i2&&<ScoreBar score={i2.score} theme={T}/>}
                      </div>
                    );})}
                  </div>
                </div>
              </div>
            ):<div style={{color:T.muted,textAlign:"center",padding:48,fontSize:14}}>Cargando indicadores para {TFLBL[chartTf]}...</div>}
          </div>
        )}

        {/* ══ VPVR ══ */}
        {tab==="vpvr"&&<VPVRTab rawK={rawK} mkt={mkt} theme={T}/>}

        {/* ══ HEATMAP ══ */}
        {tab==="heatmap"&&(
          <div>
            <div style={{fontSize:8,color:T.muted,letterSpacing:".14em",marginBottom:12}}>HEATMAP DE LIQUIDACIONES — BTC/USDT · Precio actual: ${fmt(mkt.price,0)}</div>
            <LiqHeatmap price={mkt.price} theme={T}/>
          </div>
        )}

        {/* ══ ON-CHAIN ══ */}
        {tab==="onchain"&&<OnChainPanel data={onchain} theme={T}/>}

        {/* ══ NEWS ══ */}
        {tab==="news"&&<NewsPanel news={news} session={sess} theme={T}/>}

        {/* ══ SETUP ══ */}
        {tab==="setup"&&(
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <div className="card" style={{background:T.bg}}>
              <div style={{fontSize:8,color:T.muted,letterSpacing:".14em",marginBottom:8}}>✓ CEREBRO APEX v7 — DATOS CARGADOS</div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {[["EMAs",true],["RSI",true],["MACD",true],["BB",true],["Stoch",true],["ATR",true],["Fibonacci",true],["Funding",!!mkt.funding],["OI",!!mkt.oi],["On-Chain",!!onchain],["Ciclo",!!cycle],["News",news.length>0],["F&G",!!mkt.fg]].map(([l,ok])=>(
                  <div key={l} style={{display:"flex",alignItems:"center",gap:4,fontSize:9,color:ok?T.bull:T.textSec}}>
                    <span style={{width:7,height:7,borderRadius:"50%",background:ok?T.bull:T.danger,display:"inline-block",animation:ok?"pulse 2s infinite":undefined}}/>
                    {l}
                  </div>
                ))}
              </div>
            </div>
            <div className="card">
              <div style={{fontSize:8,color:T.muted,letterSpacing:".14em",marginBottom:10}}>GRÁFICO TRADINGVIEW (OPCIONAL)</div>
              <div className="upload" onClick={()=>fileRef.current.click()}>
                {imgName?<div style={{color:T.bull,fontSize:11}}>📊 {imgName} · click para cambiar</div>:<div style={{color:T.muted,fontSize:11}}>📤 Screenshot TradingView — complementa el análisis<br/><span style={{fontSize:9,color:T.muted}}>La imagen se comprime automáticamente antes de enviar</span></div>}
              </div>
              <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={onFile}/>
              {img&&<img src={`data:image/png;base64,${img}`} style={{width:"100%",borderRadius:5,marginTop:10,border:`1px solid ${T.border}`,maxHeight:260,objectFit:"contain"}} alt="chart"/>}
            </div>
            <div className="card">
              <div style={{fontSize:8,color:T.muted,letterSpacing:".14em",marginBottom:8}}>CONSULTA</div>
              <input style={{width:"100%"}} type="text" value={q} onChange={e=>setQ(e.target.value)} placeholder="Setup completo, divergencias, ciclo, VPVR..." onKeyDown={e=>e.key==="Enter"&&onAnalyze()}/>
              <div style={{display:"flex",gap:6,marginTop:8,flexWrap:"wrap"}}>
                {["Setup completo","¿Long o Short?","¿RSI divergencia?","VPVR + Fib","¿Ciclo confirma?","¿Funding ok?"].map(s=><button key={s} className="ghost" onClick={()=>setQ(s)}>{s}</button>)}
              </div>
            </div>
            <button className="analyze-btn" onClick={onAnalyze} disabled={busy}>{busy?"⟳ APEX v7 ANALIZANDO...":"⚡ ANALIZAR — APEX v7 CEREBRO COMPLETO"}</button>
            {err&&<div style={{color:T.danger,fontSize:10,textAlign:"center",padding:6,background:T.danger+"11",borderRadius:5}}>{err}</div>}
            <div className="card" style={{minHeight:120,background:T.bg}}>
              <div style={{fontSize:8,color:T.muted,letterSpacing:".14em",marginBottom:10}}>ANÁLISIS APEX v7</div>
              {busy&&<div style={{color:T.accent,fontSize:10,marginBottom:8,animation:"pulse 1s infinite"}}>⟳ Procesando indicadores + on-chain + ciclo...</div>}
              <AnalysisText text={analysis} theme={T}/>
            </div>
          </div>
        )}

        {/* ══ CHAT ══ */}
        {tab==="chat"&&(
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:12,minHeight:240,maxHeight:380,overflowY:"auto"}}>
              {chat.length===0
                ? <div style={{color:T.muted,fontSize:11,textAlign:"center",padding:36}}>Chat con APEX v7 — todos los datos van automáticamente<br/><span style={{fontSize:9}}>EMAs · RSI · MACD · BB · Stoch · ATR · Fib · Funding · OI · On-Chain · Ciclo</span></div>
                : chat.map((m,i)=>(
                  <div key={i} style={{marginBottom:10}}>
                    {m.role==="user"
                      ? <div style={{textAlign:"right"}}><span style={{background:T.accent+"22",border:`1px solid ${T.accent}44`,borderRadius:"8px 8px 2px 8px",padding:"7px 12px",fontSize:11,color:T.accent,display:"inline-block",maxWidth:"80%",textAlign:"left"}}>{m.text}</span></div>
                      : <div><span style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:"2px 8px 8px 8px",padding:"9px 13px",fontSize:11,color:T.text,display:"inline-block",maxWidth:"92%",whiteSpace:"pre-wrap",lineHeight:1.8}}>{m.text}</span></div>
                    }
                  </div>
                ))
              }
              {busy&&<div style={{color:T.accent,fontSize:9,animation:"pulse 1s infinite"}}>APEX analizando...</div>}
            </div>
            <div style={{display:"flex",gap:8}}>
              <input style={{flex:1}} type="text" value={q} onChange={e=>setQ(e.target.value)} placeholder="Pregunta a APEX v7..." onKeyDown={e=>e.key==="Enter"&&onSend()}/>
              <button className="analyze-btn" style={{width:"auto",padding:"9px 20px",fontSize:10}} onClick={onSend} disabled={busy||!q.trim()}>↵</button>
            </div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {["¿Long o Short?","RSI extremo?","MACD 4H","Fib cercano","¿Ciclo confirma?","On-chain señal","Setup scalp 15M"].map(s=><button key={s} className="ghost" onClick={()=>setQ(s)}>{s}</button>)}
            </div>
            <button className="ghost" style={{alignSelf:"center"}} onClick={()=>{setChat([]);setAna("");}}>🗑 Limpiar chat</button>
          </div>
        )}

        {/* ══ CALCULATOR ══ */}
        {tab==="calc"&&<Calculator price={mkt.price} theme={T}/>}

        {/* ══ ALERTS ══ */}
        {tab==="alerts"&&(
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <div className="card">
              <div style={{fontSize:8,color:T.muted,letterSpacing:".14em",marginBottom:10}}>NOTIFICACIONES BROWSER</div>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                <span style={{width:8,height:8,borderRadius:"50%",background:notifPerm==="granted"?T.bull:T.danger,display:"inline-block"}}/>
                <span style={{fontSize:11,color:notifPerm==="granted"?T.bull:T.textSec}}>{notifPerm==="granted"?"Notificaciones ACTIVAS":"Notificaciones INACTIVAS"}</span>
                {notifPerm!=="granted"&&<button className="analyze-btn" style={{width:"auto",padding:"6px 16px",fontSize:9}} onClick={requestNotif}>🔔 Activar</button>}
              </div>
            </div>
            <div className="card">
              <div style={{fontSize:8,color:T.muted,letterSpacing:".14em",marginBottom:10}}>ALERTAS AUTOMÁTICAS DE INDICADORES ({alerts.length})</div>
              {alerts.length===0
                ? <div style={{color:T.muted,fontSize:11,textAlign:"center",padding:20}}>Sin alertas activas — mercado en zona neutral</div>
                : <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {alerts.map((a,i)=>(
                      <div key={i} style={{display:"flex",gap:10,padding:"8px 12px",background:T.bg,border:`1px solid ${a.lvl==="danger"?T.danger+"33":a.lvl==="good"?T.bull+"33":T.warn+"33"}`,borderRadius:6}}>
                        <span style={{fontSize:16,flexShrink:0}}>{a.icon}</span>
                        <div style={{flex:1}}>
                          <div style={{fontSize:10,color:a.lvl==="danger"?T.danger:a.lvl==="good"?T.bull:T.warn,lineHeight:1.5}}>{a.msg}</div>
                          <div style={{fontSize:8,color:T.muted,marginTop:2}}>{a.tf}</div>
                        </div>
                      </div>
                    ))}
                  </div>
              }
            </div>
          </div>
        )}

        {/* ══ ORDER BOOK ══ */}
        {tab==="orderbook"&&(
          <div>
            <div style={{fontSize:8,color:T.textSec,letterSpacing:".14em",marginBottom:12}}>ORDER BOOK & PROFUNDIDAD — BTC/USDT · BINANCE</div>
            <OrderBookPanel orderBook={orderBook} price={mkt.price} theme={T}/>
          </div>
        )}

        {/* ══ TRADE IDEAS ══ */}
        {tab==="tradeideas"&&(
          <TradeIdeasPanel
            idea={tradeIdea}
            alerts={alerts}
            inds={inds}
            notifPerm={notifPerm}
            onRequestNotif={requestNotif}
            onSendToSetup={(data)=>{if(data?.side)setQ(`Dame setup para ${data.side} a $${Math.round(data.price||mkt.price)}`);setTab("setup");}}
            theme={T}
          />
        )}

        {/* ══ BACKTEST ══ */}
        {tab==="backtest"&&<BacktestPanel rawK={rawK} theme={T}/>}

                {/* ══ PRICE ALERTS ══ */}
        {tab==="alerts"&&(
          <PriceAlertPanel price={mkt.price} notifPerm={notifPerm} onRequestNotif={requestNotif} theme={T}/>
        )}

        {/* ══ TRADE JOURNAL ══ */}
        {tab==="journal"&&<TradeJournal theme={T}/>}

        {/* ══ SESSIONS ══ */}
        {tab==="sessions"&&<SessionsPanel theme={T}/>}

        {/* ══ FUNDING CALC ══ */}
        {tab==="funding"&&<FundingCalc mkt={mkt} theme={T}/>}

                {/* ══ STATUS ══ */}
        {tab==="status"&&(
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <div className="card">
              <div style={{fontSize:8,color:T.muted,letterSpacing:".14em",marginBottom:12}}>CONEXIONES — APEX v7</div>
              {[["Binance Spot","api.binance.com",conn.binanceSpot,"Precio, Klines, High/Low, Volumen"],["Binance Futures","fapi.binance.com",conn.binanceFut,"Funding Rate, Mark Price, Open Interest"],["Binance L/S","fapi.binance.com/futures/data",conn.binanceFut,"Long/Short Account Ratio"],["Fear & Greed","api.alternative.me/fng",conn.fg,"Índice sentimiento cripto"],["mempool.space","mempool.space/api",conn.onchain,"Hash Rate, Bloques, Fees, Mempool"],["News RSS","rss2json.com (4 fuentes)",conn.news,"CoinTelegraph, CoinDesk, BTC Magazine, Decrypt"],["APEX AI","api.anthropic.com/v1",true,"Claude Sonnet — Motor IA, Imagen comprimida"]].map(([name,url,status,desc])=>(
                <div key={name} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 12px",background:T.bg,border:`1px solid ${status?T.bull+"33":T.danger+"33"}`,borderRadius:6,marginBottom:6}}>
                  <span style={{width:8,height:8,borderRadius:"50%",background:status?T.bull:T.danger,flexShrink:0,animation:status?"pulse 2s infinite":undefined}}/>
                  <div style={{flex:1}}>
                    <div style={{fontSize:11,color:status?T.bull:T.danger,fontWeight:600}}>{name}</div>
                    <div style={{fontSize:8,color:T.muted,marginTop:1}}>{url} — {desc}</div>
                  </div>
                  <span style={{fontSize:9,color:status?T.bull:T.danger,fontWeight:700}}>{status?"LIVE":"OFFLINE"}</span>
                </div>
              ))}
            </div>
            <div className="card">
              <div style={{fontSize:8,color:T.muted,letterSpacing:".14em",marginBottom:10}}>MÓDULOS APEX v7</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:3}}>
                {["EMAs 9/21/50/100/200","RSI + divergencias","MACD histograma","Bollinger Bands","Stochastic RSI","ATR sizing","Fibonacci auto","VPVR completo","Candlestick Chart","Liquidation Heatmap","On-Chain mempool.space","Ciclo BTC halvings","MVRV log regression","News 4 fuentes RSS","5 Themes","Auto Trade Score","Notif. browser push","Calculadora posición","Compresión imágenes","Sesiones globales"].map(m=>(
                  <div key={m} style={{display:"flex",gap:6,padding:"3px 0",borderBottom:`1px solid ${T.border}`,alignItems:"center"}}>
                    <span style={{width:6,height:6,borderRadius:"50%",background:T.bull,display:"inline-block",flexShrink:0}}/>
                    <span style={{fontSize:9,color:T.textSec}}>{m}</span>
                  </div>
                ))}
              </div>
              <div style={{marginTop:10,fontSize:8,color:T.muted}}>Auto-refresh: Binance 45s · On-chain 90s · News 3min · Último: {conn.ts?.toLocaleTimeString()||"—"}</div>
            </div>
          </div>
        )}

        <div style={{textAlign:"center",marginTop:16,fontSize:8,color:T.muted,lineHeight:1.8,paddingBottom:16}}>
          APEX TRADER BTC v7 · Binance · mempool.space · RSS News · Claude AI · 5 Themes<br/>
          ⚠️ Solo uso educativo. Trading apalancado implica riesgo de pérdida total.
        </div>
      </div>
    </div>
  );
}
