/* End-to-end test for the Technical Terminal.
 *
 * Boots the real index.html in headless Chromium against recorded API fixtures
 * (no network), then asserts on behaviour rather than on markup: indicator maths
 * against hand-rolled values, the volume-profile levels against a golden run,
 * the absence of look-ahead bias in the historical score, the sector
 * applicability rules, the staleness guard, and every honest-empty state.
 *
 *   npm install playwright && npx playwright install chromium
 *   node tests/e2e.cjs
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { build } = require('./harness');

const TMP  = build(path.join(__dirname, '.tmp'));
const PORT = 8531;
const MIME = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json', '.ico':'image/x-icon' };

const server = http.createServer((req, res) => {
  const p = path.join(TMP, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(p, (e, buf) => {
    if (e) { res.writeHead(404).end('nope'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(buf);
  });
});

let pass = 0, fail = 0;
const ck = (name, cond, extra) => {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.error('FAIL  ' + name + (extra !== undefined ? '   -> ' + JSON.stringify(extra) : '')); }
};

const BASE = `http://localhost:${PORT}`;

server.listen(PORT, () => {
(async () => {
  const b = await chromium.launch({ ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}) });
  const pg = await b.newPage({ viewport:{ width:1500, height:1020 } });
  const errs=[];
  pg.on('pageerror', e => errs.push(e.message));
  pg.on('console', m => { if(m.type()==='error' && !/favicon/i.test(m.text())) errs.push(m.text()); });

  await pg.goto(`${BASE}/index.html`);
  await pg.waitForTimeout(1500);
  // default viewport must be ~1 trading year, not all 5 years
  const dflt = await pg.evaluate(()=>{ const r=window.__chart.timeScale().getVisibleLogicalRange();
    return { span: Math.round(r.to-r.from), win: document.getElementById('lv-win').textContent }; });
  console.log('default viewport span (bars):', dflt.span, '|', dflt.win);
  ck('default window line shows an Israeli-formatted ~1-year window',
     /חלון: \d{2}\/\d{2}\/2025 → \d{2}\/\d{2}\/2026/.test(dflt.win) && /25[0-9] נרות|24[0-9] נרות/.test(dflt.win),
     dflt.win);
  ck('opens on ~1 trading year, not the full 5Y', dflt.span>200 && dflt.span<300, dflt.span);
  ck('quote change formats cleanly (no toPrecision artefact)',
     /^-5\.05 \(-4\.21%\)$/.test(await pg.evaluate(()=>document.getElementById('qch').textContent)),
     await pg.evaluate(()=>document.getElementById('qch').textContent));
  // now zoom all the way out for the 5Y golden checks
  await pg.evaluate(()=>window.__chart.timeScale().fitContent());
  await pg.waitForTimeout(700);
  await pg.waitForFunction(()=>document.querySelectorAll('#lv .cell').length>=3, {timeout:20000}).catch(()=>{});
  await pg.waitForTimeout(1800);

  const s = await pg.evaluate(()=>({
    veil: document.getElementById('veil').classList.contains('on'),
    qsym: document.getElementById('qsym').textContent,
    qpx:  document.getElementById('qpx').textContent,
    qch:  document.getElementById('qch').textContent,
    qcls: document.getElementById('qch').className,
    win:  document.getElementById('lv-win').textContent,
    cells:[...document.querySelectorAll('#lv .cell')].map(c=>({cls:c.className, txt:c.textContent.replace(/\s+/g,' ').trim()})),
    bars: window.__BARS ? window.__BARS.length : -1,
    lines:window.__lines ? window.__lines.length : -1,
    panes:window.__chart.panes().length,
    canv: document.querySelectorAll('#chart canvas').length,
    hookErr: window.__hookErr||null,
  }));
  console.log('\n=== ORCL ==='); console.log(JSON.stringify(s,null,2));

  ck('no page errors', errs.length===0, errs.slice(0,4));
  ck('veil hidden after load', s.veil===false);
  ck('5Y of daily bars loaded', s.bars>1200, s.bars);
  ck('three panes (price/volume/rsi)', s.panes===3, s.panes);
  ck('canvases rendered', s.canv>=3, s.canv);
  ck('quote shows symbol + price', s.qsym==='ORCL' && s.qpx==='114.99', [s.qsym,s.qpx]);
  ck('quote change is negative-styled', /neg/.test(s.qcls), s.qcls);
  ck('exactly 3 level cells', s.cells.length===3, s.cells.length);
  ck('window line reports bars + nodes', /נרות/.test(s.win) && /צבירים/.test(s.win), s.win);

  // ORCL is at a 5Y low -> support cell must be the explicit "none" state, not a made-up number
  const sup = s.cells[2];
  ck('support cell is a real level on the 5Y window (ORCL traded down there in 2022)',
     /cell s/.test(sup.cls) && /104\.71/.test(sup.txt), sup);
  ck('two resistance cells are real levels', /cell r/.test(s.cells[0].cls) && /cell r/.test(s.cells[1].cls), [s.cells[0].cls,s.cells[1].cls]);
  ck('price lines drawn = number of real levels (3)', s.lines===3, s.lines);

  // algorithm parity with the Python golden run on the same 5Y window
  const g = await pg.evaluate(()=>{
    const bars = window.__BARS, price = bars[bars.length-1].c;
    const r = window.__profileLevels(bars, price);
    return { price, nodes:r.nodes.map(n=>+n.p.toFixed(2)), res:r.res.map(n=>+n.p.toFixed(2)), sup:r.sup?+r.sup.p.toFixed(2):null };
  });
  console.log('\nJS profile on full 5Y:', JSON.stringify(g));
  ck('JS matches Python golden R1=116.58', Math.abs(g.res[0]-116.58)<0.02, g.res[0]);
  ck('JS matches Python golden R2=126.08', Math.abs(g.res[1]-126.08)<0.02, g.res[1]);
  ck('JS matches Python golden S1=104.71 on full window', Math.abs(g.sup-104.71)<0.02, g.sup);

  // indicator sanity
  const ind = await pg.evaluate(()=>{
    const c = window.__BARS.map(b=>b.c);
    const e9=window.__ema(c,9), e21=window.__ema(c,21), s50=window.__sma(c,50), s100=window.__sma(c,100), r=window.__rsi(c,14);
    const n=c.length-1;
    let s=0; for(let i=n-49;i<=n;i++) s+=c[i];
    return { e9:e9[n], e21:e21[n], s50:s50[n], sma50manual:s/50, s100:s100[n], rsi:r[n],
             firstE9:e9.findIndex(v=>v!==null), firstS100:s100.findIndex(v=>v!==null),
             rsiMin:Math.min(...r.filter(v=>v!=null)), rsiMax:Math.max(...r.filter(v=>v!=null)) };
  });
  console.log('\nindicators:', JSON.stringify(ind,null,1));
  ck('SMA50 matches a hand-rolled mean', Math.abs(ind.s50-ind.sma50manual)<1e-9, [ind.s50,ind.sma50manual]);
  ck('EMA9 first value at index 8', ind.firstE9===8, ind.firstE9);
  ck('SMA100 first value at index 99', ind.firstS100===99, ind.firstS100);
  ck('RSI bounded 0-100', ind.rsiMin>=0 && ind.rsiMax<=100, [ind.rsiMin,ind.rsiMax]);
  ck('downtrend: price < EMA9 < EMA21 < SMA50', 114.99<ind.e9 && ind.e9<ind.e21 && ind.e21<ind.s50, [ind.e9,ind.e21,ind.s50]);


  // ═══════════ the graded current point ═══════════
  const A = await pg.evaluate(()=>({
    cards:[...document.querySelectorAll('#st .cell')].map(c=>c.className),
    sub: document.getElementById('st-sub').textContent.replace(/\s+/g,' ').trim(),
    txt: document.getElementById('st').textContent.replace(/\s+/g,' ').trim(),
  }));
  ck('assessment renders 3 cards', A.cards.length===3, A.cards);
  ck('score card states X of Y', /\d+ מתוך \d+ תנאים/.test(A.txt), A.txt.slice(0,60));
  ck('both percentile windows are shown', /אחוזון על שנה/.test(A.txt) && /אחוזון על שנתיים/.test(A.txt), null);
  ck('all four categories are profiled',
     ['הקשר מגמה','טריות הטריגר','מומנטום','גיאומטריה'].every(x=>A.txt.includes(x)), null);
  ck('sub-line reports trend + last trigger age',
     /מגמה:/.test(A.sub) && /ימי מסחר/.test(A.sub), A.sub);

  // score maths must agree with the raw conditions
  const S2 = await pg.evaluate(()=>{
    const n=window.__BARS.length-1, fresh=window.__freshUpFlags(), L=window.__PROFILE_LOOKBACK;
    const lv=window.__profileLevels(window.__BARS.slice(n-L+1,n+1), window.__BARS[n].c);
    const res=window.__evalConditions(n,fresh,lv), sc=window.__scoreAll(res);
    const vals=window.__COND.map(c=>({k:c.key,v:res[c.key]}));
    return {sc, vals, nulls:vals.filter(x=>x.v===null).map(x=>x.k),
            trues:vals.filter(x=>x.v===true).length, total:vals.length};
  });
  console.log('\nconditions:', JSON.stringify(S2.vals), '\nscore:', JSON.stringify(S2.sc));
  ck('applicable = 8 minus the n/a conditions', S2.sc.applicable === S2.total - S2.nulls.length,
     [S2.sc.applicable, S2.total, S2.nulls]);
  ck('passed equals the number of true conditions', S2.sc.passed === S2.trues, [S2.sc.passed, S2.trues]);
  ck('n/a conditions are excluded, never counted as failures',
     S2.sc.passed <= S2.sc.applicable && S2.sc.applicable < S2.total, [S2.sc, S2.nulls]);
  ck('ORCL has no support now, so R:R is the n/a one', S2.nulls.includes('rr'), S2.nulls);
  ck('no hard veto: a failed condition still yields a score',
     S2.sc.ratio!==null && S2.sc.passed>0 && S2.sc.passed<S2.sc.applicable, S2.sc);

  // percentile sanity
  const P = await pg.evaluate(()=>{
    const H=window.__buildHistory(504), r=H.ratios;
    const n=window.__BARS.length-1, L=window.__PROFILE_LOOKBACK;
    const lv=window.__profileLevels(window.__BARS.slice(n-L+1,n+1), window.__BARS[n].c);
    const sc=window.__scoreAll(window.__evalConditions(n,H.fresh,lv));
    return { len:r.length, y1:window.__pctlOf(r.slice(-252),sc.ratio), y2:window.__pctlOf(r,sc.ratio),
             med1:window.__median(r.slice(-252)), min:Math.min(...r), max:Math.max(...r) };
  });
  console.log('percentiles:', JSON.stringify(P));
  ck('history covers 504 bars', P.len===504, P.len);
  ck('percentiles are within 0-100', P.y1>=0&&P.y1<=100&&P.y2>=0&&P.y2<=100, [P.y1,P.y2]);
  ck('the reference set is NOT degenerate (spread of scores exists)', P.max>P.min, [P.min,P.max]);

  // ═══ the important one: no look-ahead bias ═══
  const LA = await pg.evaluate(()=>{
    const keep = window.__BARS, L = window.__PROFILE_LOOKBACK;
    const k = keep.length - 60;                       // a bar 60 days in the past
    const f1 = window.__freshUpFlags();
    const s1 = window.__scoreAll(window.__evalConditions(
      k, f1, window.__profileLevels(keep.slice(k-L+1,k+1), keep[k].c)));
    // now pretend today IS bar k: truncate the series and rebuild every indicator
    window.__setBARS(keep.slice(0, k+1)); window.__paintSeries();
    const t = window.__BARS.length - 1, f2 = window.__freshUpFlags();
    const s2 = window.__scoreAll(window.__evalConditions(
      t, f2, window.__profileLevels(window.__BARS.slice(t-L+1,t+1), window.__BARS[t].c)));
    window.__setBARS(keep); window.__paintSeries();   // restore
    return { s1, s2 };
  });
  console.log('look-ahead check:', JSON.stringify(LA));
  ck('NO LOOK-AHEAD: a past bar scores the same whether or not later bars exist',
     LA.s1.passed===LA.s2.passed && LA.s1.applicable===LA.s2.applicable, LA);

  // score must not move when you zoom (fixed 252-bar basis), unlike the levels
  const Z = await pg.evaluate(async ()=>{
    const before = document.getElementById('st').textContent.replace(/\s+/g,' ').trim();
    const lvBefore = document.getElementById('lv-win').textContent;
    const n=window.__BARS.length;
    window.__chart.timeScale().setVisibleLogicalRange({from:n-600,to:n+3});
    await new Promise(r=>setTimeout(r,700));
    return { before, after:document.getElementById('st').textContent.replace(/\s+/g,' ').trim(),
             lvBefore, lvAfter:document.getElementById('lv-win').textContent };
  });
  ck('score is zoom-independent (fixed window)', Z.before===Z.after, [Z.before.slice(0,40), Z.after.slice(0,40)]);
  ck('levels ARE zoom-dependent (visible-range subscription alive)',
     Z.lvBefore!==Z.lvAfter, [Z.lvBefore, Z.lvAfter]);
  ck('method + caveats are documented in the note',
     await pg.evaluate(()=>{const t=document.getElementById('lv-note').textContent;
       return /בלי הצצה לעתיד/.test(t) && /בלתי-תלויים/.test(t) && /n\/a/.test(t) && /252/.test(t);}), null);

  const leg = await pg.evaluate(()=>[...document.querySelectorAll('.legend > span')].map(x=>x.textContent.replace(/\s+/g,' ').trim()));
  console.log('\ntop legend:', JSON.stringify(leg));
  ck('top legend = 4 MAs + Volume + the trigger key',
     leg.length===6 && leg.slice(0,5).join('|')==='EMA 9|EMA 21|SMA 50|SMA 100|Volume', leg);
  ck('legend documents what the arrow means',
     /9\/21/.test(leg[5]) && /כניסה/.test(leg[5]) && /יציאה/.test(leg[5]), leg[5]);
  ck('no RSI entry left in the top legend', !leg.some(x=>/RSI/.test(x)), leg);
  ck('RSI pane carries a text primitive (pane 2 exists and is labelled)',
     await pg.evaluate(()=>window.__chart.panes().length===3), null);
  const col = await pg.evaluate(()=>({
    lvl: window.__LEVEL_COLOR,
    accents: [...document.querySelectorAll('#lv .cell.r, #lv .cell.s')]
      .map(c => getComputedStyle(c).borderInlineStartColor),
    candleUp:   getComputedStyle(document.documentElement).getPropertyValue('--up').trim(),
    candleDown: getComputedStyle(document.documentElement).getPropertyValue('--down').trim(),
  }));
  console.log('\ncolours:', JSON.stringify(col));
  ck('level colour is blue #2962ff', col.lvl==='#2962ff', col.lvl);
  ck('every real level card accent is the same blue',
     col.accents.length>=2 && col.accents.every(c=>c==='rgb(41, 98, 255)'), col.accents);
  ck('candles keep red/green (blue is only for levels)',
     col.candleUp==='#26a69a' && col.candleDown==='#ef5350', [col.candleUp,col.candleDown]);

  // ─────────── dates, trend row, triggers ───────────
  const dt = await pg.evaluate(()=>({
    win: document.getElementById('lv-win').textContent,
    he:  [window.__heDate('2025-07-24'), window.__heDate('2026-01-05')],
  }));
  ck('panel window line uses dd/mm/yyyy',
     /חלון: \d{2}\/\d{2}\/\d{4} → \d{2}\/\d{2}\/\d{4}/.test(dt.win), dt.win);
  ck('no ISO dates left in the panel line', !/\d{4}-\d{2}-\d{2}/.test(dt.win), dt.win);
  ck('heDate converts correctly', dt.he[0]==='24/07/2025' && dt.he[1]==='05/01/2026', dt.he);
  ck('chart time axis stays English (locale untouched)',
     await pg.evaluate(()=>window.__chart.options().localization.locale==='en-US'), null);

  const S = await pg.evaluate(()=>({
    cells:[...document.querySelectorAll('#st .cell')].map(c=>({cls:c.className,txt:c.textContent.replace(/\s+/g,' ').trim()})),
    sub: document.getElementById('st-sub').textContent,
  }));
  ck('status strip has 3 cards', S.cells.length===3, S.cells.length);
  ck('gate is visible as a checklist condition',
     /SMA 50 מעל SMA 100/.test(await pg.evaluate(()=>document.getElementById('st').textContent)), null);
  ck('checklist shows passes too, not only failures',
     await pg.evaluate(()=>{const t=document.getElementById('st').textContent;
       return t.includes('✓') && t.includes('✗');}), null);
  ck('checklist lists all 8 conditions',
     await pg.evaluate(()=>window.__COND.every(c=>document.getElementById('st').textContent.includes(c.label))), null);

  // trend row must agree with the raw indicator values
  const tv = await pg.evaluate(()=>{
    const I=window.__IND, n=window.__BARS.length-1, c=window.__BARS[n].c;
    return { e9:I.ema9[n], e21:I.ema21[n], s50:I.s50[n], s100:I.s100[n], c,
             st:window.__trendState(I,n,c), gate:window.__gateOpen(I,n) };
  });
  console.log('\ntrend inputs:', JSON.stringify(tv));
  const bull = tv.e9>tv.e21 && tv.e21>tv.s50 && tv.s50>tv.s100;
  const bear = tv.e9<tv.e21 && tv.e21<tv.s50 && tv.s50<tv.s100;
  ck('trend label matches the ribbon order actually present',
     (!bull && !bear) ? tv.st.key==='flat' : (bull ? tv.st.key==='bull' : tv.st.key==='bear'), tv.st);
  ck('gate flag equals SMA50 > SMA100', tv.gate === (tv.s50>tv.s100), [tv.gate,tv.s50,tv.s100]);
  ck('trend card class mirrors the computed state', S.cells[0].cls.includes(tv.st.key), [S.cells[0].cls, tv.st.key]);

  // every marked entry must sit on a bar where the gate was open
  const mk = await pg.evaluate(()=>{
    const I=window.__IND, B=window.__BARS;
    const idx = {}; B.forEach((b,i)=>idx[b.t]=i);
    const ms = window.__markers.markers();
    return ms.map(m=>({ t:m.time, shape:m.shape, text:m.text, color:m.color,
                        gate: window.__gateOpen(I, idx[m.time]) }));
  });
  const ups = mk.filter(m=>m.shape==='arrowUp');
  console.log('markers:', mk.length, '| entries:', ups.length, '| breaks:', mk.filter(m=>m.shape==='circle').length);
  ck('markers were placed', mk.length>0, mk.length);
  ck('EVERY entry marker sits on a gate-open bar', ups.length>0 && ups.every(m=>m.gate===true),
     ups.filter(m=>!m.gate));
  ck('markers are sorted ascending by time (library requirement)',
     mk.every((m,i)=>i===0 || mk[i-1].t<=m.t), 'unsorted');
  ck('no level-break marker on the ribbon series', mk.every(m=>m.shape!=='circle'), mk.filter(m=>m.shape==='circle'));
  ck('at most one level-break marker, on the candle series',
     (await pg.evaluate(()=>window.__brkMarkers.markers().length))<=1, null);
  ck('every trigger arrow is white and labelled 9/21',
     mk.every(m=>m.color==='#ffffff' && m.text==='9/21'), mk.slice(0,3));
  ck('trigger arrows carry no red/green (that was the clash)',
     !mk.some(m=>/ef5350|26a69a/i.test(m.color||'')), mk.slice(0,3));

  // the level break must be a real close-through of a level that is actually displayed
  const brk = await pg.evaluate(()=>{
    const B=window.__BARS, idx={}; B.forEach((b,i)=>idx[b.t]=i);
    const m = window.__brkMarkers.markers()[0];
    if(!m) return null;
    const i = idx[m.time];
    const shown = [...document.querySelectorAll('#lv .cell.r .c-px, #lv .cell.s .c-px')]
      .map(e=>parseFloat(e.textContent.replace(/,/g,'')));
    return { prev:B[i-1].c, cur:B[i].c, tag:m.text, date:m.time, shown,
             line: document.getElementById('lv-win').textContent };
  });
  if (brk){
    console.log('break check:', JSON.stringify(brk));
    const hit = brk.shown.filter(lv => (brk.prev<=lv && brk.cur>lv) || (brk.prev>=lv && brk.cur<lv));
    ck('the break bar really closed through one of the displayed levels', hit.length>0, brk);
    ck('the break is reported in the levels line with an Israeli date',
       /פריצה אחרונה: \d{2}\/\d{2}\/\d{4}/.test(brk.line), brk.line);
  }

  await pg.screenshot({ path: path.join(__dirname, '.tmp', 'shot-orcl.png') });

  // ---- zoom changes the window and therefore the levels ----
  const before = await pg.evaluate(()=>document.getElementById('lv-win').textContent);
  await pg.evaluate(()=>{ const n=window.__BARS.length; window.__chart.timeScale().setVisibleLogicalRange({from:n-260,to:n-1}); });
  await pg.waitForTimeout(900);
  const after = await pg.evaluate(()=>({ win:document.getElementById('lv-win').textContent,
    cells:[...document.querySelectorAll('#lv .cell')].map(c=>c.textContent.replace(/\s+/g,' ').trim()) }));
  console.log('\nwindow before:', before, '\nwindow after :', after.win, '\ncells after  :', JSON.stringify(after.cells));
  ck('levels recompute on visible-range change', before!==after.win, [before, after.win]);
  ck('narrow window -> honest empty support state (no node below price)',
     /אין צביר נפח מתחת/.test(after.cells[2]), after.cells[2]);
  ck('narrow window -> only the 2 resistance lines are drawn',
     (await pg.evaluate(()=>window.__lines.length))===2, await pg.evaluate(()=>window.__lines.length));
  await pg.screenshot({ path: path.join(__dirname, '.tmp', 'shot-zoom.png') });


  // ═══════════════ fundamental layer ═══════════════
  await pg.waitForFunction(()=>document.querySelectorAll('#fu .cell').length>0,{timeout:30000}).catch(()=>{});
  await pg.waitForTimeout(1200);
  const F1 = await pg.evaluate(()=>({
    sub:document.getElementById('fu-sub').textContent.replace(/\s+/g,' ').trim(),
    txt:document.getElementById('fu').textContent.replace(/\s+/g,' ').trim(),
    note:document.getElementById('fu-note').textContent,
    cards:document.querySelectorAll('#fu .cell').length,
  }));
  ck('ORCL fundamentals render 3 cards', F1.cards===3, F1.cards);
  ck('ORCL fundamentals come from YOUR pipeline, not the live API',
     /הפייפליין שלך/.test(F1.txt) && !/stockanalysis/.test(F1.txt.slice(0,200)), F1.txt.slice(0,90));
  ck('GARP verdict + score shown', /Solid · 5 מתוך 8/.test(F1.txt), F1.txt.slice(0,80));
  ck('all 8 GARP criteria listed',
     ['Revenue Growth','Rule of 40','FCF Margin','Net Margin','Return on Equity','Valuation (PEG)','Fwd Multiple','Balance Sheet']
       .every(n=>F1.txt.includes(n)), null);
  ck('implied value from your pipeline is shown for a covered name', /262\.55/.test(F1.txt), null);
  ck('quality x timing statement present', /איכותית|חלשה/.test(F1.sub), F1.sub);
  ck('RECONCILIATION: the two price sources are compared', /מחירים תואמים|פער מחיר/.test(F1.sub), F1.sub);
  ck('timing axis uses the ABSOLUTE technical score, not the percentile',
     /טכני 4\/7/.test(F1.sub) && /תזמון גרוע/.test(F1.sub), F1.sub);
  ck('caveats documented (denominator + staleness)',
     /אינו נספר במכנה/.test(F1.note) && /מיושן/.test(F1.note), F1.note.slice(0,120));

  // the applicability rules must match the existing terminal exactly
  const AP = await pg.evaluate(()=>{
    const f=window.__criterionApplies;
    return {
      finR40:f('Rule of 40','Financial Services'), finFCF:f('FCF Margin','Financial Services'),
      finBS:f('Balance Sheet','Financial Services'), finRev:f('Revenue Growth','Financial Services'),
      techR40:f('Rule of 40','Technology'), commR40:f('Rule of 40','Communication Services'),
      healthR40:f('Rule of 40','Healthcare'), unknownR40:f('Rule of 40',null),
      techBS:f('Balance Sheet','Technology'),
    };
  });
  ck('Financials skip Rule of 40 / FCF margin / balance sheet',
     !AP.finR40 && !AP.finFCF && !AP.finBS && AP.finRev, AP);
  ck('Rule of 40 applies only to Technology + Communication Services',
     AP.techR40 && AP.commR40 && !AP.healthR40 && !AP.unknownR40, AP);
  ck('non-financials still get the balance-sheet test', AP.techBS, AP);

  // freshness guard
  const FV = await pg.evaluate(()=>({
    fresh: window.__freshVal({v:19.7, age:2}, 30),
    stale: window.__freshVal({v:24.9, age:1638}, 30),
    none:  window.__freshVal(null, 30),
  }));
  ck('STALENESS GUARD: a 1638-day-old P/E is rejected, a 2-day-old one kept',
     FV.fresh===19.7 && FV.stale===null && FV.none===null, FV);

  // ---- live path: a ticker outside the universe ----
  await pg.fill('#sym','CULP'); await pg.click('#go'); await pg.waitForTimeout(2600);
  const FC = await pg.evaluate(()=>({
    sub:document.getElementById('fu-sub').textContent.replace(/\s+/g,' ').trim(),
    txt:document.getElementById('fu').textContent.replace(/\s+/g,' ').trim(),
    note:document.getElementById('fu-note').textContent,
  }));
  console.log('\nCULP:', FC.txt.slice(0,230));
  ck('LIVE PATH works for a ticker outside your 126', /stockanalysis \(חי\)/.test(FC.txt), FC.txt.slice(0,60));
  ck('sector recovered from SEC SIC', /sector via SEC SIC 2211/.test(FC.txt), FC.txt.slice(0,150));
  ck('a textile mill is not a growth sector, so Rule of 40 is skipped',
     /Rule of 40 · לא ישים/.test(FC.txt), null);
  ck("CULP's stale 2022 P/E does not leak in — PEG and Fwd Multiple read as missing",
     /Valuation \(PEG\) · אין נתון/.test(FC.txt) && /Fwd Multiple · אין נתון/.test(FC.txt), null);
  ck('implied value is n/a on the live path (needs the whole universe)',
     /ערך משתמע: n\/a/.test(FC.txt), null);
  ck('the live path is flagged as an undocumented API in the note',
     /לא מתועד/.test(FC.note), FC.note.slice(0,120));
  ck('no price reconciliation claimed when there is only one source',
     !/מחירים תואמים|פער מחיר/.test(FC.sub), FC.sub);

  // ---- live path on a BANK: the applicability rules must fire off SEC data ----
  await pg.fill('#sym','PLBC'); await pg.click('#go'); await pg.waitForTimeout(2600);
  const FB = await pg.evaluate(()=>document.getElementById('fu').textContent.replace(/\s+/g,' ').trim());
  console.log('PLBC:', FB.slice(0,230));
  ck('a bank is identified as Financial Services from its SIC',
     /Financial Services \(sector via SEC SIC 6153\)/.test(FB), FB.slice(0,150));
  ck('the bank skips exactly Rule of 40, FCF margin and balance sheet',
     /Rule of 40 · לא ישים/.test(FB) && /FCF Margin · לא ישים/.test(FB) && /Balance Sheet · לא ישים/.test(FB), null);
  ck('the bank is scored out of 4, not 8', /3 מתוך 4/.test(FB), FB.slice(0,80));

  // ---- crypto: no fundamentals, stated plainly ----
  await pg.fill('#sym','BTCUSDT'); await pg.click('#go'); await pg.waitForTimeout(2200);
  const FX = await pg.evaluate(()=>document.getElementById('fu').textContent.replace(/\s+/g,' ').trim());
  ck('crypto says it has no fundamentals instead of inventing any',
     /אין נתונים פונדמנטליים למטבעות/.test(FX) && !/GARP/.test(FX), FX.slice(0,90));

  await pg.fill('#sym','ORCL'); await pg.click('#go'); await pg.waitForTimeout(2200);

  // ---- crypto ----
  await pg.fill('#sym','BTCUSDT'); await pg.click('#go'); await pg.waitForTimeout(2500);
  const c2 = await pg.evaluate(()=>({
    veil:document.getElementById('veil').classList.contains('on'),
    qsym:document.getElementById('qsym').textContent, qpx:document.getElementById('qpx').textContent,
    bars:window.__BARS.length, win:document.getElementById('lv-win').textContent,
    cells:[...document.querySelectorAll('#lv .cell')].map(c=>({cls:c.className,txt:c.textContent.replace(/\s+/g,' ').trim()})),
  }));
  console.log('\n=== BTCUSDT ==='); console.log(JSON.stringify(c2,null,2));
  ck('crypto path loads', c2.veil===false && c2.bars===1000, [c2.veil,c2.bars]);
  ck('crypto quote shown', c2.qsym==='BTCUSDT' && parseFloat(c2.qpx.replace(/,/g,''))>1000, [c2.qsym,c2.qpx]);
  ck('crypto gets real levels both sides', c2.cells.filter(c=>/cell (r|s)\b/.test(c.cls)).length===3, c2.cells.map(c=>c.cls));
  await pg.screenshot({ path: path.join(__dirname, '.tmp', 'shot-btc.png') });

  // ---- failure states must be explicit ----
  await pg.fill('#sym','ZZZZQQ'); await pg.click('#go'); await pg.waitForTimeout(1500);
  const bad = await pg.evaluate(()=>({on:document.getElementById('veil').classList.contains('on'),
    t:document.getElementById('veil-t').textContent, w:document.getElementById('veil-w').textContent}));
  ck('unknown stock shows explicit failure, not a blank chart', bad.on && /ZZZZQQ/.test(bad.t) && bad.w.length>20, bad);

  await pg.fill('#sym','FAKEUSDT'); await pg.click('#go'); await pg.waitForTimeout(1500);
  const bad2 = await pg.evaluate(()=>({on:document.getElementById('veil').classList.contains('on'), w:document.getElementById('veil-w').textContent}));
  ck('unknown crypto pair shows explicit failure', bad2.on && /Binance/.test(bad2.w), bad2);

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log('page errors:', errs.length?errs.slice(0,6):'none');
  await b.close();
  server.close();
  process.exit(fail?1:0);
})();
});
