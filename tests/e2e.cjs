/* End-to-end test for the Technical Terminal.
 *
 * Boots the real index.html in headless Chromium against recorded API fixtures
 * (no network, frozen clock), then asserts on behaviour rather than on markup:
 * indicator maths against hand-rolled values, the volume-profile levels against a
 * golden run, the absence of look-ahead bias in the historical score, the sector
 * applicability rules, the staleness guard on BOTH data paths, the sign traps in
 * the GARP scorecard, symbol-to-symbol state isolation, and every honest-empty
 * state.
 *
 * The clock is frozen to the fixture recording date in harness.js. Without that,
 * the staleness guard compares fixed fixture timestamps against a moving Date.now()
 * and the suite starts failing a month after recording with the source untouched.
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
let browser = null;

server.listen(PORT, () => {
(async () => {
  browser = await chromium.launch({ ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}) });
  /* Pinned, and pinned to the audience's zone rather than the runner's. Date handling
     is the classic bug that is correct only in the timezone you happened to test in;
     a UTC runner hid a real off-by-one day in the panel's date formatting. */
  const pg = await browser.newPage({ viewport:{ width:1500, height:1020 }, timezoneId:'Asia/Jerusalem' });
  const errs=[];
  pg.on('pageerror', e => errs.push(e.message));
  pg.on('console', m => { if(m.type()==='error' && !/favicon/i.test(m.text())) errs.push(m.text()); });

  /* Symbol loads wait on an observable end state instead of a fixed sleep. A sleep
     long enough on this machine is a coin flip on a loaded one, and the failure it
     produces points at the assertion rather than at the wait. */
  const loadSym = async (s) => {
    await pg.fill('#sym', s); await pg.click('#go');
    await pg.waitForFunction(
      sym => document.getElementById('qsym').textContent === sym
             && document.querySelectorAll('#fu .cell').length > 0,
      s, { timeout: 25000 });
  };
  const loadBad = async (s) => {
    await pg.fill('#sym', s); await pg.click('#go');
    await pg.waitForFunction(
      sym => document.getElementById('veil').classList.contains('on')
             && document.getElementById('veil-t').textContent.includes(sym),
      s, { timeout: 25000 });
  };

  /* Waits for the levels panel to stop moving instead of sleeping a guessed number
     of milliseconds. renderLevels is debounced and the chart settles its range after
     layout, so "long enough on my machine" is a coin flip on a loaded one. */
  await pg.addInitScript(() => {
    window.__stable = async (quietMs = 300, capMs = 10000) => {
      let prev = null, quiet = 0;
      for (let t = 0; t < capMs; t += 50){
        const cur = document.getElementById('lv-win').textContent
                  + '|' + (window.__lines ? window.__lines.length : -1);
        if (cur === prev){ quiet += 50; if (quiet >= quietMs) return true; }
        else { quiet = 0; prev = cur; }
        await new Promise(r => setTimeout(r, 50));
      }
      return false;
    };
  });

  await pg.goto(`${BASE}/index.html`);
  await pg.waitForFunction(()=>window.__BARS && window.__BARS.length>0
                              && document.querySelectorAll('#lv .cell').length>=3
                              && document.querySelectorAll('#fu .cell').length>0,
                           null, {timeout:30000});

  // the test hooks themselves must be installed, or every assertion below is vacuous
  const hook = await pg.evaluate(()=>({ err:window.__hookErr||null, bars:window.__BARS?window.__BARS.length:-1,
                                        frozen:window.__FROZEN_NOW||null, now:Date.now() }));
  ck('test hooks installed (no __hookErr)', !hook.err && hook.bars>0, hook);
  ck('CLOCK IS FROZEN to the fixture recording date, so the suite cannot rot with the calendar',
     hook.frozen!==null && hook.now===hook.frozen
       && new Date(hook.frozen).toISOString().slice(0,10)==='2026-07-26', [hook.frozen, hook.now]);

  // default viewport must be ~1 trading year, not all 5 years
  const dflt = await pg.evaluate(()=>{ const r=window.__chart.timeScale().getVisibleLogicalRange();
    return { span: Math.round(r.to-r.from), win: document.getElementById('lv-win').textContent }; });
  /* the count is asserted as a range, not as a 3-digit pattern: the library settles
     the visible range after layout, so the exact bar count is a timing artefact and
     pinning it makes the suite fail for reasons that have nothing to do with the code */
  const dfltBars = +(dflt.win.match(/· (\d+) נרות/) || [])[1];
  console.log('default viewport span (bars):', dflt.span, '| bars in window:', dfltBars, '|', dflt.win);
  ck('default window line shows an Israeli-formatted ~1-year window',
     /חלון: \d{2}\/\d{2}\/2025 → \d{2}\/\d{2}\/2026/.test(dflt.win) && dfltBars>200 && dfltBars<300,
     [dflt.win, dfltBars]);
  ck('opens on ~1 trading year, not the full 5Y', dflt.span>200 && dflt.span<300, dflt.span);
  ck('quote change formats cleanly (no toPrecision artefact)',
     /^-5\.05 \(-4\.21%\)$/.test(await pg.evaluate(()=>document.getElementById('qch').textContent)),
     await pg.evaluate(()=>document.getElementById('qch').textContent));

  /* Zoom all the way out for the 5Y golden checks, and wait for the FULL window to
     be the one on screen. Waiting merely for "the text changed" catches an
     intermediate range mid-animation and measures the golden levels on the wrong
     window — which is how this produced a level set that legitimately had no
     support below the price. */
  await pg.evaluate(()=>window.__chart.timeScale().fitContent());
  await pg.waitForFunction(()=>{
    const m = document.getElementById('lv-win').textContent.match(/· (\d+) נרות/);
    return m && +m[1] > 1200;
  }, null, {timeout:20000});

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
  }));
  console.log('\n=== ORCL ==='); console.log(JSON.stringify(s,null,2));

  ck('no page errors so far', errs.length===0, errs.slice(0,4));
  ck('veil hidden after load', s.veil===false);
  ck('5Y of daily bars loaded', s.bars>1200, s.bars);
  ck('three panes (price/volume/rsi)', s.panes===3, s.panes);
  ck('canvases rendered', s.canv>=3, s.canv);
  ck('quote shows symbol + price', s.qsym==='ORCL' && s.qpx==='114.99', [s.qsym,s.qpx]);
  ck('quote change is negative-styled', /neg/.test(s.qcls), s.qcls);
  ck('exactly 3 level cells', s.cells.length===3, s.cells.length);
  ck('window line reports bars + nodes', /נרות/.test(s.win) && /צבירים/.test(s.win), s.win);

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

  // ═══ a profile needs volume; without it there are no levels, not invented ones ═══
  const NV = await pg.evaluate(()=>{
    const base = window.__BARS.slice(-252);
    const price = base[base.length-1].c;
    const rz = window.__profileLevels(base.map(b=>({...b, v:0})),    price);
    const rn = window.__profileLevels(base.map(b=>({...b, v:null})), price);
    return { zeroNodes:rz.nodes.length, zeroRes:rz.res.length, zeroSup:rz.sup, zeroFlag:!!rz.novol,
             nullNodes:rn.nodes.length, nullFlag:!!rn.novol,
             realNodes:window.__profileLevels(base, price).nodes.length };
  });
  console.log('zero-volume profile:', JSON.stringify(NV));
  ck('NO FABRICATED LEVELS: a window with zero volume yields none',
     NV.zeroNodes===0 && NV.zeroRes===0 && NV.zeroSup===null && NV.zeroFlag===true, NV);
  ck('null volume is treated the same as zero volume', NV.nullNodes===0 && NV.nullFlag===true, NV);
  ck('the same bars WITH volume still produce levels (the guard is not blanket)', NV.realNodes>0, NV.realNodes);

  const NVUI = await pg.evaluate(()=>{
    const keep = window.__BARS;
    window.__setBARS(keep.map(b=>({...b, v:0}))); window.__paintSeries(); window.__renderLevels();
    const out = { txt:[...document.querySelectorAll('#lv .cell')].map(c=>c.textContent.replace(/\s+/g,' ').trim()),
                  lines:window.__lines.length };
    window.__setBARS(keep); window.__paintSeries(); window.__renderLevels();
    return out;
  });
  ck('the panel says WHY there are no levels instead of showing a bare empty card',
     NVUI.txt.length===3 && NVUI.txt.every(t=>/אין נתוני נפח/.test(t)) && NVUI.lines===0, NVUI);

  // ═══ indicator sanity, including the null-prefix case ═══
  const ind = await pg.evaluate(()=>{
    const c = window.__BARS.map(b=>b.c);
    const e9=window.__ema(c,9), e21=window.__ema(c,21), s50=window.__sma(c,50), s100=window.__sma(c,100), r=window.__rsi(c,14);
    const rma=window.__sma(r,14);
    const n=c.length-1;
    let s=0; for(let i=n-49;i<=n;i++) s+=c[i];
    const firstRma = rma.findIndex(v=>v!==null);
    let hand=0; for(let i=firstRma-13;i<=firstRma;i++) hand+=r[i];
    return { e9:e9[n], e21:e21[n], s50:s50[n], sma50manual:s/50, s100:s100[n], rsi:r[n],
             firstE9:e9.findIndex(v=>v!==null), firstS100:s100.findIndex(v=>v!==null),
             firstRsi:r.findIndex(v=>v!==null), firstRma, rmaAtFirst:rma[firstRma], handMean:hand/14,
             rmaMin:Math.min(...rma.filter(v=>v!=null)),
             rsiMin:Math.min(...r.filter(v=>v!=null)), rsiMax:Math.max(...r.filter(v=>v!=null)) };
  });
  console.log('\nindicators:', JSON.stringify(ind,null,1));
  ck('SMA50 matches a hand-rolled mean', Math.abs(ind.s50-ind.sma50manual)<1e-9, [ind.s50,ind.sma50manual]);
  ck('EMA9 first value at index 8', ind.firstE9===8, ind.firstE9);
  ck('SMA100 first value at index 99', ind.firstS100===99, ind.firstS100);
  ck('RSI bounded 0-100', ind.rsiMin>=0 && ind.rsiMax<=100, [ind.rsiMin,ind.rsiMax]);
  ck('downtrend: price < EMA9 < EMA21 < SMA50', 114.99<ind.e9 && ind.e9<ind.e21 && ind.e21<ind.s50, [ind.e9,ind.e21,ind.s50]);
  // sma() over the RSI series: the first 13 outputs used to be partial sums / 14
  ck('RSI SMA starts 14 bars after the RSI does, not on the same bar',
     ind.firstRsi===14 && ind.firstRma===27, [ind.firstRsi, ind.firstRma]);
  ck('RSI SMA first value equals a hand-rolled mean of the first 14 RSI values',
     Math.abs(ind.rmaAtFirst-ind.handMean)<1e-9, [ind.rmaAtFirst, ind.handMean]);
  ck('NO RAMP ARTEFACT: every RSI SMA value is a plausible RSI, never near zero',
     ind.rmaMin>5, ind.rmaMin);

  // ═══════════ the graded current point ═══════════
  const A = await pg.evaluate(()=>({
    cards:[...document.querySelectorAll('#st .cell')].map(c=>c.className),
    sub: document.getElementById('st-sub').textContent.replace(/\s+/g,' ').trim(),
    txt: document.getElementById('st').textContent.replace(/\s+/g,' ').trim(),
  }));
  ck('assessment renders 3 cards', A.cards.length===3, A.cards);
  ck('score card states X of Y', /\d+ מתוך \d+ תנאים/.test(A.txt), A.txt.slice(0,60));
  ck('both percentile windows are shown', /אחוזון על שנה/.test(A.txt) && /אחוזון על שנתיים/.test(A.txt), null);
  ck("the median is a share of conditions, not a fabricated X-of-today's-Y",
     /חציון \d+%/.test(A.txt) && !/חציון \d+ מתוך/.test(A.txt), A.txt.slice(0,220));
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
            trues:vals.filter(x=>x.v===true).length, total:vals.length,
            rsi:window.__IND.rsi[n], lo:window.__RSI_LO, hi:window.__RSI_HI, rsiOb:res.rsiOb};
  });
  console.log('\nconditions:', JSON.stringify(S2.vals), '\nscore:', JSON.stringify(S2.sc));
  ck('applicable = 8 minus the n/a conditions', S2.sc.applicable === S2.total - S2.nulls.length,
     [S2.sc.applicable, S2.total, S2.nulls]);
  ck('passed equals the number of true conditions', S2.sc.passed === S2.trues, [S2.sc.passed, S2.trues]);
  /* the old form asserted passed <= applicable, which tally() makes true by
     construction. What matters is that an n/a shrinks the denominator by exactly one
     each and is never silently counted as a failure. */
  ck('each n/a shrinks the denominator by exactly one and none is counted as a failure',
     S2.sc.applicable === S2.total - S2.nulls.length && S2.nulls.length > 0
       && S2.sc.passed === S2.trues, [S2.sc, S2.nulls, S2.trues]);
  ck('ORCL has no support now, so R:R is the n/a one', S2.nulls.includes('rr'), S2.nulls);
  ck('no hard veto: a failed condition still yields a score',
     S2.sc.ratio!==null && S2.sc.passed>0 && S2.sc.passed<S2.sc.applicable, S2.sc);
  // the RSI condition is a band: a collapsing name must not collect a momentum point
  // simply for not being overbought
  ck('RSI condition is a band, and ORCL (RSI far below 50) fails it',
     S2.rsi<S2.lo && S2.rsiOb===false, [S2.rsi, S2.lo, S2.rsiOb]);

  // "no resistance overhead" is the maximum of the measured quantity, not a missing value
  const RM = await pg.evaluate(()=>{
    const n=window.__BARS.length-1, fresh=window.__freshUpFlags(), c=window.__BARS[n].c;
    const none = window.__evalConditions(n, fresh, { res:[],               sup:{p:c*0.9} });
    const near = window.__evalConditions(n, fresh, { res:[{p:c*1.01}],     sup:{p:c*0.9} });
    return { noneRoom:none.room, noneRR:none.rr, noneFlag:none._noRes, noneRoomVal:none._room,
             nearRoom:near.room, nearRR:near.rr };
  });
  console.log('room/RR:', JSON.stringify(RM));
  ck('NO RESISTANCE = unlimited room, so the room condition PASSES instead of reading n/a',
     RM.noneRoom===true && RM.noneFlag===true && RM.noneRoomVal===Infinity, RM);
  ck('with unlimited room and a real support, R:R passes rather than dropping out',
     RM.noneRR===true, RM);
  ck('a near resistance still fails the 3% room rule (the rule did not become vacuous)',
     RM.nearRoom===false, RM);

  // percentile sanity
  const P = await pg.evaluate(()=>{
    const H=window.__buildHistory(504), r=H.ratios;
    const n=window.__BARS.length-1, L=window.__PROFILE_LOOKBACK;
    const lv=window.__profileLevels(window.__BARS.slice(n-L+1,n+1), window.__BARS[n].c);
    const sc=window.__scoreAll(window.__evalConditions(n,H.fresh,lv));
    return { len:r.length, y1:window.__pctlOf(r.slice(-252),sc.ratio), y2:window.__pctlOf(r,sc.ratio),
             med1:window.__median(r.slice(-252)), min:Math.min(...r), max:Math.max(...r),
             lastHist:r[r.length-1], todayRatio:sc.ratio };
  });
  console.log('percentiles:', JSON.stringify(P));
  ck('history covers 504 bars', P.len===504, P.len);
  ck('percentiles are within 0-100', P.y1>=0&&P.y1<=100&&P.y2>=0&&P.y2<=100, [P.y1,P.y2]);
  ck('the reference set is NOT degenerate (spread of scores exists)', P.max>P.min, [P.min,P.max]);
  ck('the reference set ends on the bar BEFORE today — today is not inside its own comparison',
     await pg.evaluate(()=>{
       const H=window.__buildHistory(504), L=window.__PROFILE_LOOKBACK, B=window.__BARS;
       const prev=B.length-2;
       const s=window.__scoreAll(window.__evalConditions(prev,H.fresh,
         window.__profileLevels(B.slice(prev-L+1,prev+1), B[prev].c)));
       return Math.abs(H.ratios[H.ratios.length-1]-s.ratio)<1e-12;
     }), [P.lastHist, P.todayRatio]);

  // ═══ the important one: no look-ahead bias, sampled across the series ═══
  const LA = await pg.evaluate(()=>{
    const keep = window.__BARS, L = window.__PROFILE_LOOKBACK;
    /* spread across the whole eligible range, not just the recent tail: stepping back
       by a fixed amount from the last bar only ever samples the most recent third */
    const N = 25, lo = L + 20, hi = keep.length - 2;
    const step = Math.max(1, Math.floor((hi - lo) / (N - 1)));
    const ks = [];
    for (let k = lo; k <= hi && ks.length < N; k += step) ks.push(k);
    // every s1 is computed while the FULL series (and its indicators) is loaded
    const f1 = window.__freshUpFlags();
    const s1 = ks.map(k => window.__scoreAll(window.__evalConditions(
      k, f1, window.__profileLevels(keep.slice(k-L+1,k+1), keep[k].c))));
    // then each bar is re-scored as if it were the last bar in existence
    const s2 = ks.map(k => {
      window.__setBARS(keep.slice(0, k+1)); window.__paintSeries();
      const t = window.__BARS.length-1, f2 = window.__freshUpFlags();
      return window.__scoreAll(window.__evalConditions(
        t, f2, window.__profileLevels(window.__BARS.slice(t-L+1,t+1), window.__BARS[t].c)));
    });
    window.__setBARS(keep); window.__paintSeries();   // restore
    const bad = ks.map((k,i)=>({k, full:s1[i], truncated:s2[i]}))
                  .filter(x=>x.full.passed!==x.truncated.passed || x.full.applicable!==x.truncated.applicable);
    return { n:ks.length, bad, spread:new Set(s1.map(x=>x.passed)).size,
             lo:ks[0], hi:ks[ks.length-1], len:keep.length };
  });
  console.log('look-ahead check:', LA.n, 'bars sampled from', LA.lo, 'to', LA.hi,
              '(series length', LA.len + '),', LA.bad.length, 'mismatches');
  ck('the look-ahead sample really does span the series, not just its recent tail',
     LA.lo < LA.len*0.35 && LA.hi > LA.len*0.9, [LA.lo, LA.hi, LA.len]);
  ck(`NO LOOK-AHEAD: ${LA.n} past bars each score the same whether or not later bars exist`,
     LA.n>=20 && LA.bad.length===0, LA.bad.slice(0,3));
  ck('the sampled bars are not all identical, so the check has something to catch',
     LA.spread>1, LA.spread);

  // score must not move when you zoom (fixed 252-bar basis), unlike the levels
  const Z = await pg.evaluate(async ()=>{
    const before = document.getElementById('st').textContent.replace(/\s+/g,' ').trim();
    const lvBefore = document.getElementById('lv-win').textContent;
    const n=window.__BARS.length;
    window.__chart.timeScale().setVisibleLogicalRange({from:n-600,to:n+3});
    await window.__stable();
    return { before, after:document.getElementById('st').textContent.replace(/\s+/g,' ').trim(),
             lvBefore, lvAfter:document.getElementById('lv-win').textContent };
  });
  ck('score is zoom-independent (fixed window)', Z.before===Z.after, [Z.before.slice(0,40), Z.after.slice(0,40)]);
  ck('levels ARE zoom-dependent (visible-range subscription alive)',
     Z.lvBefore!==Z.lvAfter, [Z.lvBefore, Z.lvAfter]);
  ck('method + caveats are documented in the note',
     await pg.evaluate(()=>{const t=document.getElementById('lv-note').textContent;
       return /בלי הצצה לעתיד/.test(t) && /בלתי-תלויים/.test(t) && /n\/a/.test(t) && /252/.test(t);}), null);

  // levels are measured against the last bar IN VIEW, not against today's close
  const AN = await pg.evaluate(async ()=>{
    const n=window.__BARS.length;
    window.__chart.timeScale().setVisibleLogicalRange({from:n-900, to:n-400});
    await window.__stable();
    const win = document.getElementById('lv-win').textContent;
    const anchorC = window.__BARS[n-400].c, todayC = window.__BARS[n-1].c;
    window.__chart.timeScale().fitContent();
    await window.__stable();
    return { win, anchorC, todayC, backToLive:document.getElementById('lv-win').textContent };
  });
  console.log('anchor check:', JSON.stringify(AN).slice(0,260));
  ck('panning back states which bar the levels are measured against',
     /מדוד מול הסגירה ב-/.test(AN.win) && Math.abs(AN.anchorC-AN.todayC)>0.01, AN.win.slice(0,160));
  ck('returning to the live window drops the anchor note again',
     !/מדוד מול הסגירה ב-/.test(AN.backToLive), AN.backToLive.slice(0,120));

  const leg = await pg.evaluate(()=>[...document.querySelectorAll('.legend > span')].map(x=>x.textContent.replace(/\s+/g,' ').trim()));
  console.log('\ntop legend:', JSON.stringify(leg));
  ck('top legend = 4 MAs + Volume + the trigger key',
     leg.length===6 && leg.slice(0,5).join('|')==='EMA 9|EMA 21|SMA 50|SMA 100|Volume', leg);
  ck('legend documents what the arrow means',
     /9\/21/.test(leg[5]) && /כניסה/.test(leg[5]) && /יציאה/.test(leg[5]), leg[5]);
  ck('no RSI entry left in the top legend', !leg.some(x=>/RSI/.test(x)), leg);
  /* asserting panes().length===3 here only repeated an earlier check. What actually
     needs to hold is that the RSI pane carries both of its series, in their own
     colours, and that neither of them sits on the price pane. */
  const rsiPane = await pg.evaluate(()=>{
    const p = window.__chart.panes()[2].getSeries();
    return { n:p.length, colors:p.map(x=>x.options().color),
             pricePane:window.__chart.panes()[0].getSeries().length };
  });
  ck('the RSI pane carries RSI + its average, in their own colours, off the price pane',
     rsiPane.n===2 && rsiPane.colors.includes('#9c88ff') && rsiPane.colors.includes('#f6c309')
       && rsiPane.pricePane===5, rsiPane);
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
    lbl: [window.__dateLabel('Jul 25, 2026'), window.__dateLabel('2026-01-05'),
          window.__dateLabel('2026-12-31'), window.__dateLabel('nonsense')],
    tz:  Intl.DateTimeFormat().resolvedOptions().timeZone,
  }));
  ck('panel window line uses dd/mm/yyyy',
     /חלון: \d{2}\/\d{2}\/\d{4} → \d{2}\/\d{2}\/\d{4}/.test(dt.win), dt.win);
  ck('no ISO dates left in the panel line', !/\d{4}-\d{2}-\d{2}/.test(dt.win), dt.win);
  ck('heDate converts correctly', dt.he[0]==='24/07/2025' && dt.he[1]==='05/01/2026', dt.he);
  /* This page runs in Asia/Jerusalem (see newPage above). "Jul 25, 2026" parses as
     local midnight and "2026-01-05" as UTC midnight, so a single ISO round-trip
     shifted one of them by a day. Both must read back exactly as written. */
  ck("the pipeline's own date format is normalised to dd/mm/yyyy, with no timezone shift",
     dt.lbl[0]==='25/07/2026' && dt.lbl[1]==='05/01/2026', [dt.lbl, dt.tz]);
  ck('a year boundary does not roll over either, and an unreadable date is passed through',
     dt.lbl[2]==='31/12/2026' && dt.lbl[3]==='nonsense', dt.lbl);
  ck('the suite runs in the audience timezone, so date bugs cannot hide behind UTC',
     dt.tz==='Asia/Jerusalem', dt.tz);
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
  /* The first card is the SCORE card, so its accent tracks the ratio bands — not the
     trend state, which only ever appears in the sub-line. The old assertion compared
     the two and passed because on this fixture they happened to agree. */
  const scoreCls = await pg.evaluate(()=>{
    const n=window.__BARS.length-1, L=window.__PROFILE_LOOKBACK, H=window.__buildHistory(504);
    const sc=window.__scoreAll(window.__evalConditions(n,H.fresh,
      window.__profileLevels(window.__BARS.slice(n-L+1,n+1), window.__BARS[n].c)));
    return { ratio:sc.ratio, cls:document.querySelector('#st .cell').className };
  });
  ck('the score card accent tracks the SCORE, per its own thresholds',
     scoreCls.cls.includes(scoreCls.ratio>=0.75 ? 'bull' : scoreCls.ratio>=0.5 ? 'flat' : 'bear'),
     [scoreCls.cls, scoreCls.ratio]);
  ck('the trend state is reported in the sub-line, which is where it lives',
     S.sub.includes(tv.st.label), [S.sub, tv.st.label]);

  // every marked entry must sit on a bar where the gate was open
  const mk = await pg.evaluate(()=>{
    const I=window.__IND, B=window.__BARS;
    const idx = {}; B.forEach((b,i)=>idx[b.t]=i);
    return window.__markers.markers().map(m=>({ t:m.time, shape:m.shape, text:m.text, color:m.color,
                                                gate: window.__gateOpen(I, idx[m.time]) }));
  });
  const ups = mk.filter(m=>m.shape==='arrowUp');
  console.log('markers:', mk.length, '| entries:', ups.length);
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
  /* not wrapped in `if (brk)`: on this fixture a break exists, so losing the marker
     entirely has to fail the suite rather than quietly skip two assertions */
  console.log('break check:', JSON.stringify(brk));
  ck('a level break is detected on this fixture at all', brk!==null, brk);
  const hit = brk ? brk.shown.filter(lv => (brk.prev<=lv && brk.cur>lv) || (brk.prev>=lv && brk.cur<lv)) : [];
  ck('the break bar really closed through one of the displayed levels', hit.length>0, brk);
  ck('the break is reported in the levels line with an Israeli date',
     !!brk && /פריצה אחרונה: \d{2}\/\d{2}\/\d{4}/.test(brk.line), brk && brk.line);

  await pg.screenshot({ path: path.join(__dirname, '.tmp', 'shot-orcl.png') });

  // ---- zoom changes the window and therefore the levels ----
  const before = await pg.evaluate(()=>document.getElementById('lv-win').textContent);
  await pg.evaluate(()=>{ const n=window.__BARS.length; window.__chart.timeScale().setVisibleLogicalRange({from:n-260,to:n-1}); });
  await pg.waitForFunction(w=>document.getElementById('lv-win').textContent!==w, before, {timeout:15000});
  const after = await pg.evaluate(()=>({ win:document.getElementById('lv-win').textContent,
    cells:[...document.querySelectorAll('#lv .cell')].map(c=>c.textContent.replace(/\s+/g,' ').trim()),
    lines:window.__lines.length }));
  console.log('\nwindow before:', before, '\nwindow after :', after.win, '\ncells after  :', JSON.stringify(after.cells));
  ck('levels recompute on visible-range change', before!==after.win, [before, after.win]);
  ck('narrow window -> honest empty support state (no node below price)',
     /אין צביר נפח מתחת/.test(after.cells[2]), after.cells[2]);
  ck('narrow window -> only the 2 resistance lines are drawn', after.lines===2, after.lines);

  // a range too narrow to compute must clear what it cannot replace
  const TN = await pg.evaluate(async ()=>{
    const n=window.__BARS.length;
    window.__chart.timeScale().setVisibleLogicalRange({from:n-6,to:n-1});
    await window.__stable();
    const out = { win:document.getElementById('lv-win').textContent,
                  cells:document.querySelectorAll('#lv .cell').length,
                  lines:window.__lines.length, brk:window.__brkMarkers.markers().length };
    window.__chart.timeScale().fitContent();
    await window.__stable();
    return out;
  });
  ck('a too-narrow range clears the stale levels instead of leaving them drawn',
     /טווח צר מדי/.test(TN.win) && TN.cells===0 && TN.lines===0 && TN.brk===0, TN);
  await pg.screenshot({ path: path.join(__dirname, '.tmp', 'shot-zoom.png') });

  // ═══════════════ fundamental layer ═══════════════
  const F1 = await pg.evaluate(()=>({
    sub:document.getElementById('fu-sub').textContent.replace(/\s+/g,' ').trim(),
    txt:document.getElementById('fu').textContent.replace(/\s+/g,' ').trim(),
    note:document.getElementById('fu-note').textContent,
    cards:document.querySelectorAll('#fu .cell').length,
    tech:window.__TECH,
  }));
  console.log('\nORCL fundamentals sub:', F1.sub);
  ck('ORCL fundamentals render 3 cards', F1.cards===3, F1.cards);
  ck('ORCL fundamentals come from YOUR pipeline, not the live API',
     /הפייפליין שלך/.test(F1.txt) && !/stockanalysis/.test(F1.txt.slice(0,200)), F1.txt.slice(0,90));
  ck('GARP verdict + score shown', /5 מתוך 8 · Solid/.test(F1.txt), F1.txt.slice(0,80));
  ck('all 8 GARP criteria listed',
     ['Revenue Growth','Rule of 40','FCF Margin','Net Margin','Return on Equity','Valuation (PEG)','Fwd Multiple','Balance Sheet']
       .every(n=>F1.txt.includes(n)), null);
  ck('implied value from your pipeline is shown for a covered name', /262\.55/.test(F1.txt), null);
  ck('quality x timing statement present', /איכותית|חלשה/.test(F1.sub), F1.sub);
  ck('RECONCILIATION: the two price sources are compared', /מחירים תואמים|פער מחיר/.test(F1.sub), F1.sub);
  ck('timing axis uses the ABSOLUTE technical score, not the percentile',
     new RegExp(`טכני ${F1.tech.passed}/${F1.tech.applicable}`).test(F1.sub) && /תזמון גרוע/.test(F1.sub), F1.sub);
  ck('caveats documented (denominator + staleness)',
     /אינו נספר במכנה/.test(F1.note) && /טריות/.test(F1.note), F1.note.slice(0,160));
  ck("the snapshot's build date is shown, in the same format as every other date, with its age",
     /25\/07\/2026/.test(F1.txt) && /לפני \d+ ימים/.test(F1.txt), F1.txt.slice(0,220));

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

  // freshness guard, live path
  const FV = await pg.evaluate(()=>({
    fresh: window.__freshVal({v:19.7, age:2}, 30),
    stale: window.__freshVal({v:24.9, age:1638}, 30),
    none:  window.__freshVal(null, 30),
  }));
  ck('STALENESS GUARD: a 1638-day-old P/E is rejected, a 2-day-old one kept',
     FV.fresh===19.7 && FV.stale===null && FV.none===null, FV);

  // ═══ the same guard on the pipeline path, which used to have none at all ═══
  const US = await pg.evaluate(()=>{
    const keep = window.__getUnivMeta();
    const probe = gen => {
      window.__setUnivMeta({ generated:gen, count:126 });
      const f = window.__fundFromUniverse({ ticker:'X', sector:'Technology', price:100, pe:20,
        forwardPE:10, peg:0.6, ptAvg:150, impliedPrice:180, revGrowth:20, fcfMargin:20,
        netMargin:20, roe:20, debtEquity:0.5 });
      return { age:window.__universeAge(), usable:window.__universeUsable(), stale:!!f.stalePrice,
               pe:f.pe, pt:f.ptAvg, implied:f.impliedPrice, ref:f.refPrice, roe:f.roe };
    };
    const out = { current:probe('Jul 25, 2026'), monthOld:probe('Mar 1, 2026'),
                  ancient:probe('Jan 1, 2024'), unreadable:probe('not a date') };
    window.__setUnivMeta(keep); window.__clearFundCache();
    return out;
  });
  console.log('universe staleness:', JSON.stringify(US));
  ck('a current snapshot passes untouched', US.current.usable && !US.current.stale && US.current.pe===20, US.current);
  ck("PIPELINE STALENESS: past 30 days the snapshot's multiples, target and implied value are dropped",
     US.monthOld.stale && US.monthOld.pe===null && US.monthOld.pt===null
       && US.monthOld.implied===null && US.monthOld.ref===null, US.monthOld);
  ck('statement figures survive the 30-day horizon, because they are quarterly', US.monthOld.roe===20, US.monthOld);
  ck('past 200 days the snapshot is refused entirely and the live path takes over',
     US.ancient.usable===false && US.monthOld.usable===true, [US.ancient.usable, US.monthOld.usable]);
  ck('an unreadable build date is treated as unusable, not as fresh',
     US.unreadable.usable===false && US.unreadable.age===null, US.unreadable);

  // ═══ sign traps: a value that is bad beyond what the threshold can express must FAIL ═══
  const SG = await pg.evaluate(()=>{
    const row = (g,n) => g.rows.find(r=>r.name===n);
    const loss = window.__garp({ sector:'Technology', revGrowth:20, fcfMargin:25, netMargin:-8,
      roe:-12, peg:-1.4, pe:-10, forwardPE:-5, debtEquity:Infinity });
    // the pipeline reports the same fact as a negative ratio rather than as Infinity
    const negDE = window.__garp({ sector:'Technology', revGrowth:20, fcfMargin:25, netMargin:20,
      roe:20, peg:0.8, pe:20, forwardPE:12, debtEquity:-2.5 });
    const good = window.__garp({ sector:'Technology', revGrowth:20, fcfMargin:25, netMargin:20,
      roe:20, peg:0.8, pe:20, forwardPE:12, debtEquity:0.4 });
    return {
      pegSt:row(loss,'Valuation (PEG)').st, pegDisp:row(loss,'Valuation (PEG)').disp,
      fwdSt:row(loss,'Fwd Multiple').st,    fwdDisp:row(loss,'Fwd Multiple').disp,
      bsSt: row(loss,'Balance Sheet').st,   bsDisp: row(loss,'Balance Sheet').disp,
      lossCounted:loss.counted, lossPass:loss.pass,
      goodPeg:row(good,'Valuation (PEG)').st, goodCounted:good.counted,
      negDESt:row(negDE,'Balance Sheet').st, negDEDisp:row(negDE,'Balance Sheet').disp,
      negDECounted:negDE.counted,
    };
  });
  console.log('sign traps:', JSON.stringify(SG));
  ck('NEGATIVE PEG FAILS the "< 2" test instead of satisfying it',
     SG.pegSt==='fail' && /אין רווח או צמיחה/.test(SG.pegDisp), SG);
  ck('two negative multiples fail Fwd-vs-Trailing instead of being ranked against each other',
     SG.fwdSt==='fail' && /מכפיל שלילי/.test(SG.fwdDisp), SG);
  ck('NEGATIVE EQUITY fails the balance sheet instead of reading as no data',
     SG.bsSt==='fail' && /הון עצמי שלילי/.test(SG.bsDisp), SG);
  ck('all three stay IN the denominator — dropping them used to raise the score',
     SG.lossCounted===SG.goodCounted, [SG.lossCounted, SG.goodCounted]);
  ck('a healthy positive PEG still passes', SG.goodPeg==='pass', SG.goodPeg);
  ck('a NEGATIVE D/E — how the pipeline reports negative equity — fails too, not just Infinity',
     SG.negDESt==='fail' && /הון עצמי שלילי/.test(SG.negDEDisp) && SG.negDECounted===8, SG);

  // ---- live path: a ticker outside the universe ----
  await loadSym('CULP');
  const FC = await pg.evaluate(()=>({
    sub:document.getElementById('fu-sub').textContent.replace(/\s+/g,' ').trim(),
    txt:document.getElementById('fu').textContent.replace(/\s+/g,' ').trim(),
    note:document.getElementById('fu-note').textContent,
  }));
  console.log('\nCULP:', FC.txt.slice(0,230));
  ck('LIVE PATH works for a ticker outside your 126', /stockanalysis \(חי\)/.test(FC.txt), FC.txt.slice(0,60));
  ck('sector recovered from SEC SIC', /sector via SEC SIC 2211/.test(FC.txt), FC.txt.slice(0,150));
  ck('the out-of-bucket sector is stated in Hebrew, not printed as the raw token "other"',
     /סקטור\s+אחר — לא פיננסי ולא סקטור צמיחה/.test(FC.txt) && !/סקטור\s+other/.test(FC.txt),
     FC.txt.slice(0,180));
  ck('a textile mill is not a growth sector, so Rule of 40 is skipped',
     /Rule of 40\s+לא ישים/.test(FC.txt), null);
  ck("CULP's stale 2022 P/E does not leak in — PEG and Fwd Multiple read as missing",
     /Valuation \(PEG\)\s+אין נתון/.test(FC.txt) && /Fwd Multiple\s+אין נתון/.test(FC.txt), null);
  ck('implied value is n/a on the live path (needs the whole universe)',
     /ערך משתמע\s+n\/a/.test(FC.txt), null);
  ck('the live path is flagged as an undocumented API in the note',
     /לא מתועד/.test(FC.note), FC.note.slice(0,120));
  ck('no price reconciliation claimed when there is only one source',
     !/מחירים תואמים|פער מחיר/.test(FC.sub), FC.sub);

  // ---- live path on a BANK: the applicability rules must fire off SEC data ----
  await loadSym('PLBC');
  const FB = await pg.evaluate(()=>document.getElementById('fu').textContent.replace(/\s+/g,' ').trim());
  console.log('PLBC:', FB.slice(0,280));
  ck('a bank is identified as Financial Services from its SIC',
     /Financial Services\s+sector via SEC SIC 6153/.test(FB), FB.slice(0,150));
  ck('the bank skips exactly Rule of 40, FCF margin and balance sheet',
     /Rule of 40\s+לא ישים/.test(FB) && /FCF Margin\s+לא ישים/.test(FB) && /Balance Sheet\s+לא ישים/.test(FB), null);
  // shrinking EPS makes PEG a FAILED test rather than an absent one, so the bank is out of 5
  ck('PLBC has shrinking EPS, so its PEG reads as an explicit failure, not as no-data',
     /Valuation \(PEG\)\s+אין רווח או צמיחה חיוביים/.test(FB), FB.slice(0,280));
  ck('the bank is therefore scored out of 5: 4 sector-applicable criteria plus the failed PEG',
     /3 מתוך 5/.test(FB), FB.slice(0,80));

  // ---- crypto: no fundamentals, and the chart path still works ----
  await loadSym('BTCUSDT');
  const c2 = await pg.evaluate(()=>({
    veil:document.getElementById('veil').classList.contains('on'),
    qsym:document.getElementById('qsym').textContent, qpx:document.getElementById('qpx').textContent,
    bars:window.__BARS.length, win:document.getElementById('lv-win').textContent,
    fu:document.getElementById('fu').textContent.replace(/\s+/g,' ').trim(),
    cells:[...document.querySelectorAll('#lv .cell')].map(c=>({cls:c.className,txt:c.textContent.replace(/\s+/g,' ').trim()})),
  }));
  console.log('\n=== BTCUSDT ==='); console.log(JSON.stringify({...c2, fu:c2.fu.slice(0,80)},null,2));
  ck('crypto says it has no fundamentals instead of inventing any',
     /אין נתונים פונדמנטליים למטבעות/.test(c2.fu) && !/GARP/.test(c2.fu), c2.fu.slice(0,90));
  ck('crypto path loads', c2.veil===false && c2.bars===1000, [c2.veil,c2.bars]);
  ck('crypto quote shown', c2.qsym==='BTCUSDT' && parseFloat(c2.qpx.replace(/,/g,''))>1000, [c2.qsym,c2.qpx]);
  ck('crypto gets real levels both sides', c2.cells.filter(c=>/cell (r|s)\b/.test(c.cls)).length===3, c2.cells.map(c=>c.cls));
  await pg.screenshot({ path: path.join(__dirname, '.tmp', 'shot-btc.png') });

  // ═══ nothing on screen may outlive the symbol it describes ═══
  await loadSym('ORCL');
  const before2 = await pg.evaluate(()=>({
    st:document.getElementById('st').textContent.length,
    lv:document.getElementById('lv').textContent.length,
    fu:document.getElementById('fu').textContent.length,
    tech:window.__TECH ? window.__TECH.passed : null,
  }));
  await loadBad('ZZZZQQ');
  const bad = await pg.evaluate(()=>({
    on:document.getElementById('veil').classList.contains('on'),
    t:document.getElementById('veil-t').textContent, w:document.getElementById('veil-w').textContent,
    st:document.getElementById('st').textContent.trim(),
    lv:document.getElementById('lv').textContent.trim(),
    fu:document.getElementById('fu').textContent.trim(),
    sub:document.getElementById('st-sub').textContent.trim(),
    qsym:document.getElementById('qsym').textContent,
    tech:window.__TECH, bars:window.__BARS.length, lines:window.__lines.length,
    marks:window.__markers.markers().length, brk:window.__brkMarkers.markers().length,
  }));
  ck('unknown stock shows explicit failure, not a blank chart', bad.on && /ZZZZQQ/.test(bad.t) && bad.w.length>20, bad.t);
  ck('the previous symbol really was on screen before the failed load',
     before2.st>0 && before2.lv>0 && before2.fu>0 && before2.tech!==null, before2);
  ck('A FAILED LOAD CLEARS THE FOOTER: no stale levels, score or fundamentals survive it',
     bad.st==='' && bad.lv==='' && bad.fu==='' && bad.sub==='—' && bad.qsym==='—', bad);
  ck('a failed load also clears the chart series, its price lines and its markers',
     bad.bars===0 && bad.lines===0 && bad.marks===0 && bad.brk===0, bad);
  ck("TECH is reset, so the next company cannot inherit this one's technical score",
     bad.tech===null, bad.tech);

  await pg.fill('#sym','FAKEUSDT'); await pg.click('#go');
  await pg.waitForFunction(()=>document.getElementById('veil').classList.contains('on')
                              && /Binance/.test(document.getElementById('veil-w').textContent), null, {timeout:20000});
  const bad2 = await pg.evaluate(()=>({on:document.getElementById('veil').classList.contains('on'),
                                       w:document.getElementById('veil-w').textContent}));
  ck('unknown crypto pair shows explicit failure', bad2.on && /Binance/.test(bad2.w), bad2);

  // ═══ too little history to grade: say so, and do not keep the last symbol's score ═══
  await loadSym('ORCL');
  const SH = await pg.evaluate(()=>{
    const keep = window.__BARS;
    const techBefore = window.__TECH && window.__TECH.passed;
    window.__setBARS(keep.slice(0, 200)); window.__paintSeries(); window.__renderAssessment();
    const out = { techBefore, tech:window.__TECH,
                  st:document.getElementById('st').textContent.replace(/\s+/g,' ').trim(),
                  sub:document.getElementById('st-sub').textContent.trim(),
                  marks:window.__markers.markers().length };
    window.__setBARS(keep); window.__paintSeries(); window.__renderAssessment();
    return out;
  });
  console.log('short-history:', JSON.stringify(SH).slice(0,300));
  ck('a symbol with too little history explains itself instead of showing an empty strip',
     /צריך לפחות 257 נרות/.test(SH.st) && /יש 200/.test(SH.st), SH.st.slice(0,140));
  ck('NO CROSS-SYMBOL LEAK: TECH, the sub-line and the ribbon markers are cleared with it',
     SH.techBefore!==null && SH.tech===null && SH.sub==='' && SH.marks===0, SH);

  // ═══ two loads in flight: the last one requested is the one that paints ═══
  const RC = await pg.evaluate(async ()=>{
    window.__clearFundCache();
    const a = window.__load('ORCL');      // deliberately not awaited before the next
    const b = window.__load('CULP');
    await Promise.all([a,b]);
    await new Promise(r=>setTimeout(r,1500));
    return { qsym:document.getElementById('qsym').textContent,
             fu:document.getElementById('fu').textContent.replace(/\s+/g,' ').trim().slice(0,140) };
  });
  console.log('race:', JSON.stringify(RC));
  ck('RACE: a superseded load never paints over the one that followed it',
     RC.qsym==='CULP' && /stockanalysis \(חי\)/.test(RC.fu) && !/הפייפליין/.test(RC.fu), RC);

  // ═══ the chart library is the one hard dependency: its absence must be explained ═══
  const nolib = await browser.newPage({ viewport:{ width:1200, height:800 } });
  const nolibErrs = [];
  nolib.on('pageerror', e => nolibErrs.push(e.message));
  await nolib.goto(`${BASE}/no-lib.html`);
  await nolib.waitForFunction(()=>document.getElementById('veil').classList.contains('on'),
                              null, {timeout:15000}).catch(()=>{});
  const NL = await nolib.evaluate(()=>({
    on:document.getElementById('veil').classList.contains('on'),
    t:document.getElementById('veil-t').textContent,
    w:document.getElementById('veil-w').textContent,
  }));
  await nolib.close();
  console.log('no-lib page:', JSON.stringify(NL));
  ck('a missing/unverifiable chart library shows an explanation, not a blank page',
     NL.on && /ספריית הגרפים לא נטענה/.test(NL.t) && /SRI/.test(NL.w), NL);
  ck('and it says so on screen rather than only in the console',
     NL.w.length>60, NL.w.length);

  // ---- the run as a whole must be clean, not only its first half ----
  ck('no page errors across the WHOLE run', errs.length===0, errs.slice(0,6));
})()
  .catch(e => {
    fail++;
    console.error('\nSUITE CRASHED — the remaining assertions never ran:');
    console.error(e && e.stack || e);
  })
  .finally(async () => {
    /* Without this, a mid-suite rejection left chromium orphaned and the summary
       unprinted, so the exit code was the only surviving signal of what happened. */
    try { if (browser) await browser.close(); } catch (e){}
    server.close();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
});
