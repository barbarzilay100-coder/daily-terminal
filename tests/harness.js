/* Builds an offline copy of index.html for the e2e test.
 *
 * Two substitutions, and nothing else — the app code under test is byte-identical
 * to what ships:
 *   1. the Lightweight Charts CDN <script> is repointed at the vendored copy
 *   2. window.fetch is wrapped so every outbound URL resolves to a captured
 *      fixture instead of the network
 *
 * The fixtures are real recorded API responses (see fixtures/data/), so the test
 * exercises the actual payload shapes — including the awkward ones, like CULP's
 * P/E whose newest value is from 2022.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CDN = 'https://unpkg.com/lightweight-charts@5.2.0/dist/lightweight-charts.standalone.production.js';

const STUB = `<script>
(function(){
  const real = window.fetch;
  const HISTORY = { ORCL:'./data/orcl-history.json', CULP:'./data/culp-history.json',
                    PLBC:'./data/plbc-history.json' };
  const LIVE    = { CULP:'culp', PLBC:'plbc' };          // tickers with captured fundamentals
  const BY_CIK  = { '0000723603':'culp', '0001168455':'plbc' };
  window.__net = [];

  const ok   = p => real(p).then(r => r.json()).then(j => ({ ok:true, status:200, json:()=>Promise.resolve(j) }));
  const miss = s => Promise.resolve({ ok:false, status:s, json:()=>Promise.resolve({}) });

  window.fetch = function(u){
    u = String(u); window.__net.push(u);
    let m;
    if (u.includes('/history?')){
      const t = decodeURIComponent(u.match(/symbol\\/s\\/([^\\/]+)\\//)[1]).toUpperCase();
      return HISTORY[t] ? ok(HISTORY[t]) : miss(404);
    }
    if (u.includes('binance'))                             return u.includes('BTCUSDT') ? ok('./data/btc-klines.json') : miss(400);
    if (u.includes('equity-research-terminal/data.json'))   return ok('./data/universe-trimmed.json');
    if ((m = u.match(/\\/api\\/timeseries\\/s\\/([^\\/]+)\\/([^\\/?]+)/))){
      const d = LIVE[decodeURIComponent(m[1]).toUpperCase()];
      return d ? ok('./data/'+d+'/'+m[2]+'.json') : miss(404);
    }
    if ((m = u.match(/\\/api\\/quotes\\/s\\/([^\\/?]+)/))){
      const d = LIVE[decodeURIComponent(m[1]).toUpperCase()];
      return d ? ok('./data/'+d+'/quotes.json') : miss(404);
    }
    if ((m = u.match(/\\/api\\/symbol\\/s\\/([^\\/]+)\\/info/))){
      const d = LIVE[decodeURIComponent(m[1]).toUpperCase()];
      return d ? ok('./data/'+d+'/info.json') : miss(404);
    }
    if ((m = u.match(/data\\.sec\\.gov\\/submissions\\/CIK(\\d+)\\.json/)))
      return BY_CIK[m[1]] ? ok('./data/'+BY_CIK[m[1]]+'/sec.json') : miss(404);
    return miss(0);
  };

  /* Top-level let/const bindings are not properties of window, so the test
     cannot see them. Publish read-only views of the ones it asserts on. */
  window.addEventListener('load', () => setTimeout(() => { try {
    const get = (n, f) => Object.defineProperty(window, n, { get:f, configurable:true });
    get('__BARS', ()=>BARS); get('__IND', ()=>IND); get('__TECH', ()=>TECH);
    get('__lines', ()=>priceLines); get('__fundCache', ()=>fundCache);
    Object.assign(window, {
      __chart:chart, __markers:markers, __brkMarkers:brkMarkers,
      __sma:sma, __ema:ema, __rsi:rsi, __profileLevels:profileLevels,
      __crossovers:crossovers, __trendState:trendState, __gateOpen:gateOpen,
      __lastLevelBreak:lastLevelBreak, __freshUpFlags:freshUpFlags,
      __evalConditions:evalConditions, __scoreAll:scoreAll, __buildHistory:buildHistory,
      __median:median, __pctlOf:pctlOf, __heDate:heDate,
      __garp:garp, __criterionApplies:criterionApplies, __verdictOf:verdictOf, __freshVal:freshVal,
      __COND:COND, __LEVEL_COLOR:LEVEL_COLOR,
      __PROFILE_LOOKBACK:PROFILE_LOOKBACK, __FRESH_DAYS:FRESH_DAYS,
      __setBARS:v => { BARS = v; }, __paintSeries:paintSeries,
    });
  } catch (e){ window.__hookErr = e.message; } }, 50));
})();
</script>
`;

function build(outDir){
  fs.mkdirSync(outDir, { recursive: true });
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  if (!html.includes(CDN)) throw new Error('CDN script tag not found in index.html — did the version change?');
  html = html.replace(CDN, './lwc.js');
  const tag = '<script src="./lwc.js"></script>';
  if (!html.includes(tag)) throw new Error('could not anchor the fetch stub');
  html = html.replace(tag, tag + '\n' + STUB);
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'lwc.js'), path.join(outDir, 'lwc.js'));
  fs.writeFileSync(path.join(outDir, 'favicon.ico'), '');
  // symlink the fixtures so the served tree can reach them without copying 1MB
  const link = path.join(outDir, 'data');
  if (!fs.existsSync(link)) fs.symlinkSync(path.join(__dirname, 'fixtures', 'data'), link, 'dir');
  return outDir;
}

module.exports = { build };
