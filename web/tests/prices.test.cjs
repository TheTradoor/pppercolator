const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const root = resolve(__dirname, '../..');
const prices = [100, 80000, 3000, 150, 300, 200];
const coins = ['SOL', 'BTC', 'ETH', 'xyz:NVDA', 'xyz:TSLA', 'xyz:AAPL'];

function pageScript(path) {
  const html = readFileSync(resolve(root, path), 'utf8');
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).find(script => script.includes('const WASM_B64='));
}

function metadata(dex, values = prices) {
  const indexes = dex ? [3, 4, 5] : [0, 1, 2];
  return [
    { universe: indexes.map(i => ({ name: coins[i], maxLeverage: 10 })) },
    indexes.map(i => ({ markPx: String(values[i]), funding: '0', dayNtlVlm: '1000', prevDayPx: '100' })),
  ];
}

function harness(path) {
  const elements = new Map();
  const clock = { now: 100000 };
  const orders = [];
  const closes = [];
  const requests = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: id === 'lev' ? '2' : id === 'usd' ? '100' : '',
      textContent: '', hidden: true, disabled: false, style: {},
    });
    return elements.get(id);
  };
  const context = vm.createContext({
    document: { getElementById: element },
    window: { PPPHL: {} },
    PPPHL: {
      hasAgent: () => true,
      user: () => null,
      marketOrder: async order => { orders.push(order); return { filled: false }; },
      closePosition: async coin => { closes.push(coin); return { filled: false }; },
    },
    Date: class extends Date { static now() { return clock.now; } },
    AbortController, setTimeout, clearTimeout,
    // Keep startup suspended: these tests drive the page's price and order handlers directly.
    atob: () => '',
    WebAssembly: { instantiate: () => new Promise(() => {}) },
    fetch: async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      assert.equal(body.type, 'metaAndAssetCtxs');
      return { ok: true, json: async () => metadata(body.dex) };
    },
  });
  vm.runInContext(pageScript(path), context, { filename: path });
  const run = code => vm.runInContext(code, context);
  run(`
    S={accounts:[{equity:'1000000000',im:'0'}]};
    px=${JSON.stringify(prices.map(p => p * 1e6))};
    live=true; real=true;
    log=()=>{};
  `);
  return {
    run, clock, orders, closes, requests, element,
    read: expression => JSON.parse(run(`JSON.stringify(${expression})`)),
    respond: callback => {
      context.fetch = async (_url, options) => {
        const body = JSON.parse(options.body);
        requests.push(body);
        return { ok: true, json: async () => callback(body.dex) };
      };
    },
    fail: () => { context.fetch = async () => { throw new Error('offline'); }; },
  };
}

for (const path of ['web/index.src.html', 'site/index.html']) {
  test(`${path}: a complete snapshot updates all prices and the freshness timestamp`, async () => {
    const h = harness(path);
    await h.run('pullPrices()');
    assert.deepEqual(h.read('latest'), prices.map(p => p * 1e6));
    assert.equal(h.run('lastOk'), h.clock.now);
    assert.equal(h.read('info').length, coins.length);
    assert.deepEqual(h.requests.map(r => r.dex || '').sort(), ['', 'xyz']);
  });

  test(`${path}: an outage does not refresh cached prices`, async () => {
    const h = harness(path);
    await h.run('pullPrices()');
    const before = h.read('[latest,info,lastOk]');
    h.clock.now += 16000;
    h.fail();
    await assert.rejects(h.run('pullPrices()'), /offline/);
    assert.deepEqual(h.read('[latest,info,lastOk]'), before);
  });

  for (const failedDex of ['', 'xyz']) {
    test(`${path}: a ${failedDex || 'crypto'} outage cannot publish a partial snapshot`, async () => {
      const h = harness(path);
      await h.run('pullPrices()');
      const before = h.read('[latest,info,lastOk]');
      h.clock.now += 16000;
      h.respond(dex => {
        if ((dex || '') === failedDex) throw new Error('venue unavailable');
        return metadata(dex, prices.map(p => p * 2));
      });
      await assert.rejects(h.run('pullPrices()'), /venue unavailable/);
      assert.deepEqual(h.read('[latest,info,lastOk]'), before);
    });
  }

  for (const badPrice of ['0', '-1', 'NaN', 'Infinity', '', '1e308', '1e-10']) {
    test(`${path}: an invalid mark (${JSON.stringify(badPrice)}) cannot reuse the old price`, async () => {
      const h = harness(path);
      await h.run('pullPrices()');
      const before = h.read('[latest,info,lastOk]');
      h.clock.now += 1000;
      h.respond(dex => {
        const result = metadata(dex, prices.map(p => p * 2));
        if (!dex) result[1][0].markPx = badPrice;
        return result;
      });
      await assert.rejects(h.run('pullPrices()'));
      assert.deepEqual(h.read('[latest,info,lastOk]'), before);
    });
  }

  test(`${path}: a missing market cannot reuse its old price`, async () => {
    const h = harness(path);
    await h.run('pullPrices()');
    const before = h.read('[latest,info,lastOk]');
    h.respond(dex => {
      const result = metadata(dex);
      if (!dex) { result[0].universe.shift(); result[1].shift(); }
      return result;
    });
    await assert.rejects(h.run('pullPrices()'));
    assert.deepEqual(h.read('[latest,info,lastOk]'), before);
  });

  test(`${path}: an expired quote cannot open an order review`, async () => {
    const h = harness(path);
    await h.run('pullPrices()');
    h.clock.now += 15001;
    h.element('bGo').onclick();
    assert.equal(h.run('pending'), null);
    assert.equal(h.element('confirm').hidden, true);
    assert.match(h.element('msg').textContent, /stale|fresh|stalled/i);
  });

  test(`${path}: a quote that expires during review cannot submit a new order`, async () => {
    const h = harness(path);
    await h.run('pullPrices()');
    h.element('bGo').onclick();
    assert.equal(h.element('confirm').hidden, false);
    h.clock.now += 15001;
    await h.element('bSend').onclick();
    assert.equal(h.orders.length, 0);
    assert.equal(h.run('pending'), null);
    assert.equal(h.element('confirm').hidden, true);
  });

  test(`${path}: stale prices disable opening, and recovery restores it`, async () => {
    const h = harness(path);
    await h.run('pullPrices()');
    h.clock.now += 15001;
    h.run('ticket()');
    assert.equal(h.element('bGo').disabled, true);
    await h.run('pullPrices()');
    h.run('ticket()');
    assert.equal(h.element('bGo').disabled, false);
  });

  test(`${path}: recovery cannot revive an expired order confirmation`, async () => {
    const h = harness(path);
    await h.run('pullPrices()');
    h.element('bGo').onclick();
    h.clock.now += 15001;
    await h.run('pullPrices()');
    await h.element('bSend').onclick();
    assert.equal(h.orders.length, 0);
    assert.match(h.element('msg').textContent, /expired/);
    h.element('bGo').onclick();
    await h.element('bSend').onclick();
    assert.equal(h.orders.length, 1);
  });

  test(`${path}: freshness expires after the existing 15-second limit`, async () => {
    const h = harness(path);
    await h.run('pullPrices()');
    h.clock.now += 15000;
    h.element('bGo').onclick();
    await h.element('bSend').onclick();
    assert.equal(h.orders.length, 1);
    h.clock.now++;
    h.element('bGo').onclick();
    assert.equal(h.run('pending'), null);
  });

  test(`${path}: failed initial prices do not enable live mode`, async () => {
    const h = harness(path);
    h.fail();
    assert.equal(await h.run('goLive()'), false);
    assert.equal(h.run('latest'), null);
    assert.equal(h.run('lastOk'), 0);
  });

  test(`${path}: closing stays available during a display-feed outage`, async () => {
    const h = harness(path);
    await h.run('pullPrices()');
    h.clock.now += 15001;
    h.run("review({close:true,coin:'SOL',size:1,isBuy:false})");
    await h.element('bSend').onclick();
    assert.deepEqual(h.closes, ['SOL']);
    assert.equal(h.orders.length, 0);
  });

  test(`${path}: real orders use the fresh mark even while paper prices lag`, async () => {
    const h = harness(path);
    h.respond(dex => metadata(dex, prices.map(p => p * 2)));
    await h.run('pullPrices()');
    h.element('bGo').onclick();
    assert.equal(h.run('pending.size'), 1); // $100 margin * 2x / the fresh $200 mark.
    await h.element('bSend').onclick();
    assert.equal(h.orders.length, 1);
    assert.equal(h.orders[0].size, 1);
    h.run('ticket()');
    assert.equal(h.element('oSize').textContent, '1.0000 SOL');
  });

  test(`${path}: paper tickets keep using the engine price`, async () => {
    const h = harness(path);
    h.respond(dex => metadata(dex, prices.map(p => p * 2)));
    await h.run('pullPrices()');
    h.clock.now += 15001;
    h.run('real=false;ticket()');
    assert.equal(h.element('oSize').textContent, '2.0000 SOL');
    assert.equal(h.element('bGo').disabled, false);
  });
}

test('the deployed page and source use the same terminal logic', () => {
  const normalize = script => script.replace(/const WASM_B64="[^"]+"/, 'const WASM_B64="__WASM__"');
  assert.equal(normalize(pageScript('site/index.html')), normalize(pageScript('web/index.src.html')));
});
