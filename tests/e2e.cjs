/* End-to-end test for the Daily Terminal.
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
  /* Any child of #lv, rather than a count of level items: a window with no cluster
     on one side renders fewer items and one sentence saying so, and waiting on a
     fixed count would hang on exactly the empty states this suite exists to check. */
  await pg.waitForFunction(()=>window.__BARS && window.__BARS.length>0
                              && document.getElementById('lv').children.length>0
                              && document.querySelectorAll('#fu .cell').length>0,
                           null, {timeout:30000});

  // the test hooks themselves must be installed, or every assertion below is vacuous
  const hook = await pg.evaluate(()=>({ err:window.__hookErr||null, bars:window.__BARS?window.__BARS.length:-1,
                                        frozen:window.__FROZEN_NOW||null, now:Date.now() }));
  ck('test hooks installed (no __hookErr)', !hook.err && hook.bars>0, hook);
  ck('CLOCK IS FROZEN to the fixture recording date, so the suite cannot rot with the calendar',
     hook.frozen!==null && hook.now===hook.frozen
       && new Date(hook.frozen).toISOString().slice(0,10)==='2026-07-26', [hook.frozen, hook.now]);

  // the opening range is applied and then the levels re-render off it 160ms later, so
  // read the panel once it has stopped moving rather than mid-settle
  await pg.evaluate(()=>window.__stable());
  const dflt = await pg.evaluate(()=>{ const r=window.__chart.timeScale().getVisibleLogicalRange();
    return { span: Math.round(r.to-r.from), win: document.getElementById('lv-win').textContent }; });
  /* the count is asserted as a range, not as a 3-digit pattern: the library settles
     the visible range after layout, so the exact bar count is a timing artefact and
     pinning it makes the suite fail for reasons that have nothing to do with the code */
  const dfltBars = +(dflt.win.match(/· (\d+) bars/) || [])[1];
  console.log('default viewport span (bars):', dflt.span, '| bars in window:', dfltBars, '|', dflt.win);
  ck('window line shows an unambiguous, spelled-month date range',
     /^\d{1,2} \w{3} \d{4} to \d{1,2} \w{3} \d{4} · /.test(dflt.win) && dfltBars>110 && dfltBars<170,
     [dflt.win, dfltBars]);
  // the opening view is a legibility choice: ~250 candles across one screen are two
  // pixels wide, and the bodies stop being readable long before the year is up
  ck('opens on a window you can actually read, not on all five years',
     dflt.span>110 && dflt.span<170, dflt.span);
  ck('quote change formats cleanly (no toPrecision artefact)',
     /^-5\.05 \(-4\.21%\)$/.test(await pg.evaluate(()=>document.getElementById('qch').textContent)),
     await pg.evaluate(()=>document.getElementById('qch').textContent));

  /* ═══ the forming bar is display only — the analysis never sees it ═══
     applyQuote is driven directly rather than through a fixture: ORCL has no quote
     fixture on purpose, so every other assertion keeps running with no live bar. */
  const LQ = await pg.evaluate(async ()=>{
    const before = { tech: JSON.stringify(window.__TECH), n: window.__BARS.length };
    window.__applyQuote({ td:'2026-07-27', o:118, h:121.99, l:116.8, p:120.46, cl:114.99,
                          v:12445350, ms:'open', u:'Jul 27, 2026, 10:52 AM EDT' });
    await window.__stable();
    return { before,
      qpx:   document.getElementById('qpx').textContent,
      qch:   document.getElementById('qch').textContent,
      qlive: document.getElementById('qlive').textContent,
      lvwin: document.getElementById('lv-win').textContent,
      liveBar: window.__LIVE_BAR ? window.__LIVE_BAR.t : null,
      after: { tech: JSON.stringify(window.__TECH), n: window.__BARS.length,
               last: window.__BARS[window.__BARS.length-1].t } };
  });
  ck('live quote: the header price is the live one', LQ.qpx==='120.46', LQ.qpx);
  ck('live quote: change is measured against the last close',
     /^\+5\.47 \(\+4\.76%\)$/.test(LQ.qch), LQ.qch);
  ck('live quote: marked live, with the source timestamp',
     /^live/.test(LQ.qlive) && /10:52/.test(LQ.qlive), LQ.qlive);
  ck('live quote: BARS still end on the closed bar',
     LQ.liveBar==='2026-07-27' && LQ.after.last==='2026-07-24' && LQ.after.n===LQ.before.n,
     [LQ.liveBar, LQ.after]);
  ck('live quote: the technical score never saw the forming bar',
     LQ.after.tech===LQ.before.tech);
  ck('live quote: the levels line says the forming bar is not counted',
     /forming bar is not counted/.test(LQ.lvwin), LQ.lvwin);

  /* a quote for a day the history already has must be a no-op, or the candle
     would be drawn twice the moment the daily endpoint catches up */
  const LQ2 = await pg.evaluate(async ()=>{
    window.__applyQuote({ td:'2026-07-24', o:122.47, h:123.08, l:114.75, p:114.99,
                          v:44859923, ms:'closed', u:'Jul 24, 2026, 4:00 PM EDT' });
    await window.__stable();
    return { liveBar: window.__LIVE_BAR,
             qpx: document.getElementById('qpx').textContent,
             qlive: document.getElementById('qlive').textContent };
  });
  ck('a quote for a bar the history already has is a no-op',
     LQ2.liveBar===null && LQ2.qpx==='114.99' && LQ2.qlive==='', LQ2);

  /* the quote names its own previous close; when it does not match the last bar we
     hold, the history is lagging and the change % would be measured against the
     wrong close — the live bar must be refused, not displayed wrong */
  const LQ3 = await pg.evaluate(async ()=>{
    window.__applyQuote({ td:'2026-07-28', o:120, h:121, l:119, p:120.5, cl:119.80,
                          v:1000, ms:'open', u:'Jul 28, 2026, 10:00 AM EDT' });
    await window.__stable();
    return { liveBar: window.__LIVE_BAR, qpx: document.getElementById('qpx').textContent,
             qlive: document.getElementById('qlive').textContent };
  });
  ck('a quote whose previous close disagrees with our history is refused',
     LQ3.liveBar===null && LQ3.qpx==='114.99' && LQ3.qlive==='', LQ3);

  /* Zoom all the way out for the 5Y golden checks, and wait for the FULL window to
     be the one on screen. Waiting merely for "the text changed" catches an
     intermediate range mid-animation and measures the golden levels on the wrong
     window, which is how this produced a level set that legitimately had no support
     below the price. */
  await pg.evaluate(()=>window.__chart.timeScale().fitContent());
  await pg.waitForFunction(()=>{
    const m = document.getElementById('lv-win').textContent.match(/· (\d+) bars/);
    return m && +m[1] > 1200;
  }, null, {timeout:20000});

  const s = await pg.evaluate(()=>({
    veil: document.getElementById('veil').classList.contains('on'),
    qsym: document.getElementById('qsym').textContent,
    qpx:  document.getElementById('qpx').textContent,
    qch:  document.getElementById('qch').textContent,
    qcls: document.getElementById('qch').className,
    win:  document.getElementById('lv-win').textContent,
    cells:[...document.querySelectorAll('#lv .it')].map(c=>({
      k:c.querySelector('.k').textContent.trim(),
      p:c.querySelector('.p').textContent.trim(),
      txt:c.textContent.replace(/\s+/g,' ').trim() })),
    say: (document.querySelector('#lv .say')||{}).textContent || '',
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
  ck('exactly 2 level items', s.cells.length===2, s.cells.length);
  ck('window line reports bars + nodes', /bars/.test(s.win) && /clusters/.test(s.win), s.win);

  /* The 2022 band at 104.71 used to be the support on this window. Time decay ends it:
     it sits about seven half-lives back, so it carries under 1% of a recent bar's weight
     and no longer clears the mean bin. The point of the assertion is unchanged — the
     panel must SAY the support is missing rather than leave a strip that looks complete. */
  ck('the decayed-away support is stated, not silently dropped',
     /No volume cluster below the price/.test(s.say), s.say);
  ck('two resistance items are real levels, labelled and priced',
     /^Resistance 1$/.test(s.cells[0].k) && /^Resistance 2$/.test(s.cells[1].k)
       && /\d/.test(s.cells[0].p) && /\d/.test(s.cells[1].p), [s.cells[0],s.cells[1]]);
  ck('price lines drawn = number of real levels (2)', s.lines===2, s.lines);

  /* Was parity with a Python golden run. Volatility-scaled separation and time decay
     changed the algorithm deliberately, and there is no Python side to re-run, so these
     are the JS output frozen at that change. They still do the original job: if an edit
     that claims to touch only the drawing moves these three, the maths moved with it. */
  const g = await pg.evaluate(()=>{
    const bars = window.__BARS, price = bars[bars.length-1].c;
    const r = window.__profileLevels(bars, price);
    return { price, nodes:r.nodes.map(n=>+n.p.toFixed(2)), res:r.res.map(n=>+n.p.toFixed(2)), sup:r.sup?+r.sup.p.toFixed(2):null };
  });
  console.log('\nJS profile on full 5Y:', JSON.stringify(g));
  ck('golden R1=123.70 on the full window', Math.abs(g.res[0]-123.70)<0.02, g.res[0]);
  ck('golden R2=130.83 on the full window', Math.abs(g.res[1]-130.83)<0.02, g.res[1]);
  ck('golden: nothing below the price survives the decay, so there is no support',
     g.sup===null, g.sup);

  /* The up/down split feeds only the drawing. If it ever leaked into hist the three
     golden assertions above would move, so those are the real guard — these check
     the split itself is a split and not a relabelling of the whole bar. */
  const SP = await pg.evaluate(()=>{
    const bars = window.__BARS;
    const r = window.__profileLevels(bars, bars[bars.length-1].c);
    let sumAll = 0, sumUp = 0, over = 0;
    for (let i = 0; i < r.hist.length; i++){
      sumAll += r.hist[i]; sumUp += r.histUp[i];
      if (r.histUp[i] > r.hist[i] + 1e-6) over++;
    }
    return { sumAll, sumUp, over, total:r.total, bins:r.hist.length, upBins:r.histUp.length };
  });
  console.log('profile split:', JSON.stringify({...SP, share:+(SP.sumUp/SP.sumAll).toFixed(3)}));
  ck('the up half never exceeds the whole at any level', SP.over===0, SP.over);
  ck('both sides carry volume, so the bar really is split',
     SP.sumUp>0 && SP.sumUp<SP.sumAll, [SP.sumUp, SP.sumAll]);
  ck('splitting did not change the total the levels are found from',
     Math.abs(SP.sumAll-SP.total)/SP.total<1e-9 && SP.upBins===SP.bins, [SP.sumAll, SP.total]);

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
    const out = { items:document.querySelectorAll('#lv .it').length,
                  say:(document.querySelector('#lv .say')||{}).textContent||'',
                  ink:window.__vpInk(),
                  lines:window.__lines.length };
    window.__setBARS(keep); window.__paintSeries(); window.__renderLevels();
    return out;
  });
  ck('the panel says WHY there are no levels instead of showing a bare empty card',
     NVUI.items===0 && /No volume in this window/.test(NVUI.say) && NVUI.lines===0, NVUI);
  /* The histogram is the page's main claim, so an empty profile must leave an empty
     canvas. Drawing the previous symbol's shape under a "no volume" sentence would
     be the worst failure this redesign can have. */
  ck('no volume -> the profile canvas is blank, not the last shape drawn',
     NVUI.ink===0, NVUI.ink);

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
  ck('score card states X of Y', /\d+ of \d+ conditions/.test(A.txt), A.txt.slice(0,60));
  ck('both percentile windows are shown', /1y percentile/.test(A.txt) && /2y percentile/.test(A.txt), null);
  ck("the median is a share of conditions, not a fabricated X-of-today's-Y",
     /median \d+%/.test(A.txt) && !/median \d+ of \d+/.test(A.txt), A.txt.slice(0,220));
  ck('all four categories are profiled',
     ['Trend','Trigger','Momentum','Geometry'].every(x=>A.txt.includes(x)), null);
  ck('sub-line reports trend + last trigger age',
     /Trend:/.test(A.sub) && /trading days ago/.test(A.sub), A.sub);

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

  /* freshness is recency AND price: a cross four days back that price has already run
     away from is a chase, and the entry it offered is gone */
  const CH = await pg.evaluate(()=>{
    const B=window.__BARS, F=window.__FRESH_DAYS, CAP=window.__MAX_CHASE_PCT;
    const fresh=window.__freshUpFlags();
    const up=new Array(B.length).fill(false);
    for (const x of window.__crossovers(window.__IND.ema9, window.__IND.ema21)) if (x.dir>0) up[x.i]=true;
    let chased=null, near=null;
    for (let i=B.length-1; i>0 && (chased===null || near===null); i--){
      const js=[];
      for (let j=Math.max(0,i-F+1); j<=i; j++) if (up[j]) js.push(j);
      if (!js.length) continue;
      const runs=js.map(j=>+((B[i].c-B[j].c)/B[j].c*100).toFixed(2));
      if (chased===null && runs.every(r=>r>CAP)) chased={i, runs, fresh:fresh[i]};
      if (near===null   && runs.some(r=>r<=CAP)) near  ={i, runs, fresh:fresh[i]};
    }
    return {chased, near, cap:CAP};
  });
  console.log('anti-chase:', JSON.stringify(CH));
  ck('a cross within the window still fails freshness once price has run past the cap',
     CH.chased!==null && CH.chased.fresh===false, CH.chased);
  ck('a cross the price has NOT run away from still counts as fresh',
     CH.near!==null && CH.near.fresh===true, CH.near);

  // a heavy DOWN bar is the market leaving: it must not collect the volume point
  const VD = await pg.evaluate(()=>{
    const B=window.__BARS, A=window.__IND.volAvg, fresh=window.__freshUpFlags(), lv={res:[],sup:null};
    let dn=null, up=null;
    for (let i=B.length-1; i>0 && (dn===null || up===null); i--){
      if (A[i]==null || !(B[i].v > A[i])) continue;
      if (B[i].c < B[i-1].c){ if (dn===null) dn=i; } else if (up===null) up=i;
    }
    return { dn, up,
             dnVol: dn===null ? 'no such bar' : window.__evalConditions(dn,fresh,lv).vol,
             upVol: up===null ? 'no such bar' : window.__evalConditions(up,fresh,lv).vol };
  });
  console.log('volume direction:', JSON.stringify(VD));
  ck('above-average volume scores on an up bar and fails on a down bar',
     VD.dnVol===false && VD.upVol===true, VD);

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
  /* room and R:R are both derived from the distance overhead, so "nothing overhead"
     used to pass both and pay for one fact twice. Room keeps the point; R:R drops out. */
  ck('unlimited room is scored once: R:R reads n/a rather than taking a second point',
     RM.noneRR===null, RM);
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
  ck('the reference set ends on the bar BEFORE today, so today is not in its own comparison',
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
       return /no sight of what came after/.test(t) && /not independent/.test(t) && /n\/a/.test(t) && /252/.test(t);}), null);

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
     /measured against the .* close of/.test(AN.win) && Math.abs(AN.anchorC-AN.todayC)>0.01, AN.win.slice(0,160));
  ck('returning to the live window drops the anchor note again',
     !/measured against the/.test(AN.backToLive), AN.backToLive.slice(0,120));

  const leg = await pg.evaluate(()=>[...document.querySelectorAll('.legend > span')].map(x=>x.textContent.replace(/\s+/g,' ').trim()));
  console.log('\ntop legend:', JSON.stringify(leg));
  ck('top legend = 4 MAs + Volume + the trigger key',
     leg.length===6 && leg.slice(0,5).join('|')==='EMA 9|EMA 21|SMA 50|SMA 100|Volume', leg);
  ck('legend documents what the arrow means',
     /9\/21/.test(leg[5]) && /entry/.test(leg[5]) && /exit/.test(leg[5]), leg[5]);
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
     rsiPane.n===2 && rsiPane.colors.includes('#8b82c4') && rsiPane.colors.includes('#c9a94a')
       && rsiPane.pricePane===5, rsiPane);
  const col = await pg.evaluate(()=>{
    const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    return {
      lvl: window.__LEVEL_COLOR,
      lineColours: window.__lines.map(l => l.options().color),
      ribbon: window.__MAS.map(m => m.color),
      profile: [css('--vp-up'), css('--vp-dn')],
      declared: css('--level'),
      candleUp: css('--up'), candleDown: css('--down'),
    };
  });
  console.log('\ncolours:', JSON.stringify(col));
  ck('level colour is blue #2962ff and matches the stylesheet',
     col.lvl==='#2962ff' && col.declared==='#2962ff', [col.lvl, col.declared]);
  /* Support and resistance are one flat blue, on purpose: a level is a level, and
     colouring them apart would imply a difference the maths does not make. */
  ck('every drawn level line carries that same blue, support and resistance alike',
     col.lineColours.length>=2 && col.lineColours.every(c=>c===col.lvl), col.lineColours);
  ck('nothing else on the chart is that blue',
     !col.ribbon.includes(col.lvl) && !col.profile.includes(col.lvl)
       && col.candleUp!==col.lvl && col.candleDown!==col.lvl,
     [col.ribbon, col.profile, col.candleUp, col.candleDown]);
  /* The profile's pair has to be brighter than the ribbon's, or the two greens and
     the two reds are the same colour and the profile stops being the loud thing. */
  ck('the profile green/red are their own pair, not the ribbon\'s',
     col.profile[0]!==col.candleUp && col.profile[1]!==col.candleDown
       && !col.ribbon.includes(col.profile[0]) && !col.ribbon.includes(col.profile[1]),
     [col.profile, col.ribbon]);
  ck('candles keep red/green', col.candleUp==='#4e9e7e' && col.candleDown==='#c06a5c',
     [col.candleUp, col.candleDown]);

  // ─────────── dates, trend row, triggers ───────────
  const dt = await pg.evaluate(()=>({
    win: document.getElementById('lv-win').textContent,
    he:  [window.__fmtDate('2025-07-24'), window.__fmtDate('2026-01-05')],
    lbl: [window.__dateLabel('Jul 25, 2026'), window.__dateLabel('2026-01-05'),
          window.__dateLabel('2026-12-31'), window.__dateLabel('nonsense')],
    tz:  Intl.DateTimeFormat().resolvedOptions().timeZone,
  }));
  ck('panel window line spells the month',
     /^\d{1,2} \w{3} \d{4} to \d{1,2} \w{3} \d{4}/.test(dt.win), dt.win);
  ck('no raw ISO dates left in the panel line', !/\d{4}-\d{2}-\d{2}/.test(dt.win), dt.win);
  ck('the month is spelled, so the date cannot be read two ways',
     dt.he[0]==='24 Jul 2025' && dt.he[1]==='5 Jan 2026', dt.he);
  /* This page runs in Asia/Jerusalem (see newPage above). "Jul 25, 2026" parses as
     local midnight and "2026-01-05" as UTC midnight, so a single ISO round-trip
     shifted one of them by a day. Both must read back exactly as written. */
  ck("the pipeline's own date format is normalised to the same one, with no timezone shift",
     dt.lbl[0]==='25 Jul 2026' && dt.lbl[1]==='5 Jan 2026', [dt.lbl, dt.tz]);
  ck('a year boundary does not roll over either, and an unreadable date is passed through',
     dt.lbl[2]==='31 Dec 2026' && dt.lbl[3]==='nonsense', dt.lbl);
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
     /SMA 50 above SMA 100/.test(await pg.evaluate(()=>document.getElementById('st').textContent)), null);
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
  /* The first card is the SCORE card, so its accent tracks the ratio bands, not the
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
  /* An exit is an exit FROM something. Down-crosses closing a position the gate never
     let us open were being drawn as sell signals for trades this system was never in,
     so the arrows have to alternate, starting with an entry. */
  ck('every exit marker closes an entry: the arrows alternate, up first',
     mk.length>0 && mk[0].shape==='arrowUp'
       && mk.every((m,i)=>i===0 || m.shape!==mk[i-1].shape), mk.map(m=>m.shape).join(','));
  ck('no level-break marker on the ribbon series', mk.every(m=>m.shape!=='circle'), mk.filter(m=>m.shape==='circle'));
  ck('at most one level-break marker, on the candle series',
     (await pg.evaluate(()=>window.__brkMarkers.markers().length))<=1, null);
  ck('every trigger arrow is white and labelled 9/21',
     mk.every(m=>m.color==='#ffffff' && m.text==='9/21'), mk.slice(0,3));
  ck('trigger arrows carry no red/green (that was the clash)',
     !mk.some(m=>/c06a5c|4e9e7e/i.test(m.color||'')), mk.slice(0,3));

  // the level break must be a real close-through of a level that is actually displayed
  const brk = await pg.evaluate(()=>{
    const B=window.__BARS, idx={}; B.forEach((b,i)=>idx[b.t]=i);
    const m = window.__brkMarkers.markers()[0];
    if(!m) return null;
    const i = idx[m.time];
    const shown = [...document.querySelectorAll('#lv .it .p')]
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
     !!brk && /last break \d{1,2} \w{3} \d{4}, closed (above|below)/.test(brk.line), brk && brk.line);

  await pg.screenshot({ path: path.join(__dirname, '.tmp', 'shot-orcl.png') });

  // ---- zoom changes the window and therefore the levels ----
  const before = await pg.evaluate(()=>document.getElementById('lv-win').textContent);
  await pg.evaluate(()=>{ const n=window.__BARS.length; window.__chart.timeScale().setVisibleLogicalRange({from:n-260,to:n-1}); });
  await pg.waitForFunction(w=>document.getElementById('lv-win').textContent!==w, before, {timeout:15000});
  const after = await pg.evaluate(()=>({ win:document.getElementById('lv-win').textContent,
    items:[...document.querySelectorAll('#lv .it')].map(c=>c.textContent.replace(/\s+/g,' ').trim()),
    say:(document.querySelector('#lv .say')||{}).textContent||'',
    ink:window.__vpInk(),
    lines:window.__lines.length }));
  console.log('\nwindow before:', before, '\nwindow after :', after.win, '\nitems after  :', JSON.stringify(after.items));
  ck('levels recompute on visible-range change', before!==after.win, [before, after.win]);
  ck('narrow window -> honest empty support state (no node below price)',
     /No volume cluster below the price/.test(after.say) && after.items.length===2, after);
  ck('narrow window -> only the 2 resistance lines are drawn', after.lines===2, after.lines);
  /* A window with no support still has a profile, so the histogram must still be
     drawn — the empty state is about one missing level, not about the shape. */
  ck('the profile is still drawn when only one side is missing', after.ink>0, after.ink);

  // a range too narrow to compute must clear what it cannot replace
  const TN = await pg.evaluate(async ()=>{
    const n=window.__BARS.length;
    window.__chart.timeScale().setVisibleLogicalRange({from:n-6,to:n-1});
    await window.__stable();
    const out = { win:document.getElementById('lv-win').textContent,
                  cells:document.getElementById('lv').children.length,
                  ink:window.__vpInk(),
                  lines:window.__lines.length, brk:window.__brkMarkers.markers().length };
    window.__chart.timeScale().fitContent();
    await window.__stable();
    return out;
  });
  ck('a too-narrow range clears the stale levels instead of leaving them drawn',
     /Range too narrow/.test(TN.win) && TN.cells===0 && TN.lines===0 && TN.brk===0, TN);
  ck('a too-narrow range clears the profile canvas too', TN.ink===0, TN.ink);
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
     /committed pipeline/.test(F1.txt) && !/stockanalysis/.test(F1.txt.slice(0,200)), F1.txt.slice(0,90));
  ck('GARP verdict + score shown', /5 of 8 · Solid/.test(F1.txt), F1.txt.slice(0,80));
  ck('all 8 GARP criteria listed',
     ['Revenue Growth','Rule of 40','FCF Margin','Net Margin','Return on Equity','Valuation (PEG)','Fwd Multiple','Balance Sheet']
       .every(n=>F1.txt.includes(n)), null);
  ck('implied value from your pipeline is shown for a covered name', /262\.55/.test(F1.txt), null);
  ck('quality x timing statement present', /Good business|Weak business/.test(F1.sub), F1.sub);
  ck('RECONCILIATION: the two price sources are compared', /prices agree|prices .* apart/.test(F1.sub), F1.sub);
  ck('timing axis uses the ABSOLUTE technical score, not the percentile',
     new RegExp(`technical ${F1.tech.passed}/${F1.tech.applicable}`).test(F1.sub) && /poor timing/.test(F1.sub), F1.sub);
  ck('caveats documented (denominator + staleness)',
     /leaves the denominator/.test(F1.note) && /freshness rule/.test(F1.note), F1.note.slice(0,160));
  ck("the snapshot's build date is shown, in the same format as every other date, with its age",
     /25 Jul 2026/.test(F1.txt) && /\d+ days? ago/.test(F1.txt), F1.txt.slice(0,220));

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
     SG.pegSt==='fail' && /no positive earnings or growth/.test(SG.pegDisp), SG);
  ck('two negative multiples fail Fwd-vs-Trailing instead of being ranked against each other',
     SG.fwdSt==='fail' && /negative multiple/.test(SG.fwdDisp), SG);
  ck('NEGATIVE EQUITY fails the balance sheet instead of reading as no data',
     SG.bsSt==='fail' && /negative equity/.test(SG.bsDisp), SG);
  ck('all three stay IN the denominator, because dropping them used to raise the score',
     SG.lossCounted===SG.goodCounted, [SG.lossCounted, SG.goodCounted]);
  ck('a healthy positive PEG still passes', SG.goodPeg==='pass', SG.goodPeg);
  ck('a NEGATIVE D/E, which is how the pipeline reports negative equity, fails too',
     SG.negDESt==='fail' && /negative equity/.test(SG.negDEDisp) && SG.negDECounted===8, SG);

  // ---- live path: a ticker outside the universe ----
  await loadSym('CULP');
  const FC = await pg.evaluate(()=>({
    sub:document.getElementById('fu-sub').textContent.replace(/\s+/g,' ').trim(),
    txt:document.getElementById('fu').textContent.replace(/\s+/g,' ').trim(),
    note:document.getElementById('fu-note').textContent,
  }));
  console.log('\nCULP:', FC.txt.slice(0,230));
  ck('LIVE PATH works for a ticker outside your 126', /stockanalysis \(live\)/.test(FC.txt), FC.txt.slice(0,60));
  ck('sector recovered from SEC SIC', /sector via SEC SIC 2211/.test(FC.txt), FC.txt.slice(0,150));
  ck('the out-of-bucket sector is spelled out with its reason, not printed as the raw token "other"',
     /Sector\s+Other \(not financial, not a growth sector\)/.test(FC.txt) && !/Sector\s+other\b/.test(FC.txt),
     FC.txt.slice(0,180));
  ck('a textile mill is not a growth sector, so Rule of 40 is skipped',
     /Rule of 40\s+n\/a for sector/.test(FC.txt), null);
  ck("CULP's stale 2022 P/E does not leak in, so PEG and Fwd Multiple read as missing",
     /Valuation \(PEG\)\s+no data/.test(FC.txt) && /Fwd Multiple\s+no data/.test(FC.txt), null);
  ck('implied value is n/a on the live path (needs the whole universe)',
     /Implied value\s+n\/a/.test(FC.txt), null);
  ck('the live path is flagged as an undocumented API in the note',
     /no documentation/.test(FC.note), FC.note.slice(0,120));
  ck('no price reconciliation claimed when there is only one source',
     !/prices agree|prices .* apart/.test(FC.sub), FC.sub);

  // ---- live path on a BANK: the applicability rules must fire off SEC data ----
  await loadSym('PLBC');
  const FB = await pg.evaluate(()=>document.getElementById('fu').textContent.replace(/\s+/g,' ').trim());
  console.log('PLBC:', FB.slice(0,280));
  ck('a bank is identified as Financial Services from its SIC',
     /Financial Services\s+sector via SEC SIC 6153/.test(FB), FB.slice(0,150));
  ck('the bank skips exactly Rule of 40, FCF margin and balance sheet',
     /Rule of 40\s+n\/a for sector/.test(FB) && /FCF Margin\s+n\/a for sector/.test(FB) && /Balance Sheet\s+n\/a for sector/.test(FB), null);
  // shrinking EPS makes PEG a FAILED test rather than an absent one, so the bank is out of 5
  ck('PLBC has shrinking EPS, so its PEG reads as an explicit failure, not as no-data',
     /Valuation \(PEG\)\s+no positive earnings or growth/.test(FB), FB.slice(0,280));
  ck('the bank is therefore scored out of 5: 4 sector-applicable criteria plus the failed PEG',
     /3 of 5/.test(FB), FB.slice(0,80));

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
     /needs at least 257 bars/.test(SH.st) && /has 200/.test(SH.st), SH.st.slice(0,140));
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
     RC.qsym==='CULP' && /stockanalysis \(live\)/.test(RC.fu) && !/committed pipeline/.test(RC.fu), RC);

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
     NL.on && /chart library did not load/.test(NL.t) && /checks it against a hash/.test(NL.w), NL);
  ck('and it says so on screen rather than only in the console',
     NL.w.length>60, NL.w.length);

  // ---- the run as a whole must be clean, not only its first half ----
  ck('no page errors across the WHOLE run', errs.length===0, errs.slice(0,6));
})()
  .catch(e => {
    fail++;
    console.error('\nSUITE CRASHED. The remaining assertions never ran:');
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
