'use strict';
// 活动核算：粗算 / 精算。数据只取自 ec_dw，不生成任何推测值。
// 门槛价格 = 平台补贴要求达到的到手价（补贴门槛），不是当前售价。
const COLD = /替尔泊肽|瑞佰安|瑞百安|诺和盈|诺和泰/;
const LOSS = 0.1;            // 固定损耗费
const PACK_LOW = 0.33;       // 订购盒数 <= 4 的包装费
const PACK_HIGH = 0.6;       // 订购盒数 > 4 的包装费
const COLD_FEE = 4.7;        // 冷链费
const POST_FREE_AT = 29;     // 买家实付达到该值，买家付邮费 0.12，否则 3.12
const POST_PAID = 0.12;
const POST_UNPAID = 3.12;
const ROUGH_FREIGHT = 3;      // 粗算固定运费
const ROUGH_COLD_FREIGHT = 20; // 粗算冷链固定运费

const N = (v) => (v == null || v === '' ? null : Number(v));
const n0 = (v) => (v == null ? 0 : Number(v));
const r4 = (v) => Math.round(v * 10000) / 10000;

// Use the original counts instead of summing four-decimal rounded probabilities.
function freightProbabilities(rows) {
  const total = Number(rows[0]?.total_orders);
  const counts = rows.map(r => Number(r.orders));
  const hasCounts = rows.length && Number.isSafeInteger(total) && total > 0
    && rows.every((r,i) => r.orders != null && Number(r.total_orders) === total && Number.isSafeInteger(counts[i]) && counts[i] >= 0)
    && counts.reduce((a,b) => a+b,0) <= total;
  return rows.map((r,i) => ({...r,prob:hasCounts ? counts[i]/total : r.prob}));
}

async function stores(pool, platform) {
  const [rows] = await pool.query(
    `SELECT 客户 client, MAX(修改日期) day, COUNT(*) records, SUM(门槛价格 > 0) priced
       FROM ec_dw.subsidy
      WHERE 平台 = ? AND 客户 IS NOT NULL
      GROUP BY 客户 ORDER BY 客户`, [platform]);
  return rows.map((r) => ({ client: r.client, day: r.day, records: Number(r.records), priced: Number(r.priced) }));
}

async function rates(pool, client, platform, day) {
  const [rows] = await pool.query(
    `SELECT 平台扣点 fee, 利润点 profit, 代运营费率 agency, 生效日期 since
       FROM ec_dw.merchant_profit_setting
      WHERE 客户 = ? AND 平台 = ? AND 生效日期 <= ?
        AND (失效日期 IS NULL OR 失效日期 >= ?)
      ORDER BY 生效日期 DESC LIMIT 1`, [client, platform, day, day]);
  if (!rows.length) return null;
  return { fee: Number(rows[0].fee), profit: Number(rows[0].profit), agency: Number(rows[0].agency), since: rows[0].since };
}

// 买家实付走哪一支：多盒 / 折扣 / 其他
function playOf(actType, activity, threshold) {
  const t = String(actType || '') + String(activity || '');
  if (/多盒/.test(t) || threshold > 1) return '多盒';
  if (/折扣|立减|直降/.test(t)) return '折扣';
  if (/单盒/.test(t)) return '单盒';
  return '其他';
}

async function load(pool, { client, platform, date }) {
  const list = await stores(pool, platform);
  const cur = list.find((s) => s.client === client);
  if (!cur) return { list, platform, client: client || null, day: null, rates: null, tiers: [], summary: [], rough: [], kpis: null };
  const day = date || cur.day;

  const [base] = await pool.query(
    `WITH s AS (
       SELECT 商品编码 code, 商品名称 name, 活动名称 activity,
              json_unquote(json_extract(来源原始字段, '$."活动类型"')) act_type,
              门槛价格 price, 门槛数量 threshold, 商家承担 merchant, 补贴金额 discount,
              补贴后价 after_price, 当前售价 sale_price,
              json_unquote(json_extract(来源原始字段, '$."预估补贴"')) est_subsidy,
              ROW_NUMBER() OVER (PARTITION BY 商品编码, 活动名称 ORDER BY 观察时间 DESC, 补贴记录ID DESC) rn
         FROM ec_dw.subsidy
        WHERE 客户 = ? AND 平台 = ? AND 修改日期 = ? AND 门槛价格 > 0)
     SELECT code, name, activity, act_type, price, threshold, merchant, discount, after_price, sale_price, est_subsidy
       FROM s WHERE rn = 1`,
    [client, platform, day]);
  const codes = [...new Set(base.map((r) => r.code).filter(Boolean))];

  let freight = [], cost = [];
  if (codes.length) {
    const [f, c] = await Promise.all([
      pool.query(
        `SELECT 货品编号 code, 订购盒数 boxes, 出现概率百分比 prob, 订单数量 orders, 总订单数量 total_orders, 订单平均运费 avg_freight, 客户 owner
           FROM ec_dw.input_freight WHERE 客户 IN (?, '通用') AND 货品编号 IN (?)`,
        [client, codes]),
      pool.query(
        `SELECT 商品upc code, 成本价 cost, 客户 owner
           FROM ec_dw.input_cost WHERE 客户 IN (?, '通用') AND 商品upc IN (?)`,
        [client, codes]),
    ]);
    freight = f[0];
    cost = c[0];
  }
  // 同一货品同一盒数：客户专属行优先于「通用」兜底行
  const frsByCode = new Map();
  for (const r of freight) {
    const arr = frsByCode.get(r.code) || [];
    const index = arr.findIndex(x => Number(x.boxes) === Number(r.boxes));
    if (index < 0) arr.push(r);
    else if (r.owner === client && arr[index].owner !== client) arr[index] = r;
    frsByCode.set(r.code, arr);
  }
  for (const [code,rows] of frsByCode) frsByCode.set(code,freightProbabilities(rows));
  const costByCode = new Map();
  for (const r of cost) {
    const old = costByCode.get(r.code);
    if (!old || (r.owner === client && old.owner !== client)) costByCode.set(r.code, r);
  }

  const rt = await rates(pool, client, platform, day);
  const feeRate = rt ? rt.fee : null;

  const tiers = [];
  const rough = [];
  const summaryMap = new Map();

  for (const b of base) {
    const price = Number(b.price);
    const threshold = Number(b.threshold) > 0 ? Number(b.threshold) : 1;
    const merchant = n0(b.merchant);
    const salePrice = N(b.sale_price);
    const discount = b.discount != null ? Number(b.discount)
      : (b.est_subsidy != null ? Number(b.est_subsidy) : Math.max(0, price - n0(b.after_price)));
    const play = playOf(b.act_type, b.activity, threshold);
    const unitCost = costByCode.has(b.code) ? N(costByCode.get(b.code).cost) : null;
    const frs = (frsByCode.get(b.code) || []).slice().sort((x, y) => Number(y.prob) - Number(x.prob));
    const cold = COLD.test(String(b.name || '')) ? COLD_FEE : 0;
    const key = b.code + '|' + (b.activity || '');
    const sum = summaryMap.get(key) || { code: b.code, name: b.name, activity: b.activity, actType: b.act_type || '', play,
      price, salePrice, threshold, unitCost, tierCount: 0, probSum: 0, grossValue: null,
      costMissing: unitCost == null, freightMissing: frs.length === 0, rateMissing: feeRate == null };
    summaryMap.set(key, sum);

    if (!frs.length) {
      tiers.push({ code: b.code, name: b.name, activity: b.activity, actType: b.act_type || '', play, price, salePrice,
        threshold, boxes: null, prob: null, sales: null, cost: null, tech: null, cold, pack: null, loss: LOSS,
        postage: null, avgFreight: null, multi: null, profitPoint: null, agency: null, gross: null, expect: null,
        unitCost, missing: ['缺运费档位'] });
    }
    for (const f of frs) {
      const boxes = Number(f.boxes);
      const prob = n0(f.prob);            // 存的是 0~1 的小数
      const avgFreight = N(f.avg_freight);
      const sales = price * boxes;
      const multi = Math.floor(boxes / threshold) * threshold * merchant;
      const baseFee = sales - multi;
      const tech = feeRate == null ? null : baseFee * feeRate;
      const pack = boxes <= 4 ? PACK_LOW : PACK_HIGH;
      const buyer = play === '多盒' ? sales - Math.floor(boxes / threshold) * discount
        : play === '折扣' ? sales - discount * boxes : sales;
      const postage = buyer >= POST_FREE_AT ? POST_PAID : POST_UNPAID;
      const costValue = unitCost == null ? null : unitCost * boxes;
      const profitPoint = rt ? baseFee * rt.profit : null;
      const agency = rt ? baseFee * rt.agency : null;
      const missing = [];
      if (unitCost == null) missing.push('缺成本价');
      if (avgFreight == null) missing.push('缺订单平均运费');
      if (feeRate == null) missing.push('缺费率设置');
      const gross = costValue == null || tech == null || avgFreight == null
        ? null
        : sales - tech - cold - pack - LOSS + postage - avgFreight - multi - costValue - profitPoint - agency;
      const expect = gross == null ? null : gross * prob;
      if (gross != null) {
        sum.tierCount += 1;
        sum.probSum += prob;
        sum.grossValue = r4(n0(sum.grossValue) + expect);
      }
      tiers.push({ code: b.code, name: b.name, activity: b.activity, actType: b.act_type || '', play, price, salePrice,
        threshold, boxes, prob,
        sales: r4(sales), cost: costValue == null ? null : r4(costValue), tech: tech == null ? null : r4(tech),
        cold, pack, loss: LOSS, postage, avgFreight: avgFreight == null ? null : r4(avgFreight),
        multi: r4(multi), profitPoint: profitPoint == null ? null : r4(profitPoint),
        agency: agency == null ? null : r4(agency), gross: gross == null ? null : r4(gross),
        expect: expect == null ? null : r4(expect), unitCost, missing,
        merchant: r4(merchant), discount: r4(discount), buyer: r4(buyer),
        feeRate, profitRate: rt ? rt.profit : null, agencyRate: rt ? rt.agency : null });
    }
    // 粗算按单盒计算，不依赖运费档位或概率。
    const fixedFreight = cold > 0 ? ROUGH_COLD_FREIGHT : ROUGH_FREIGHT;
    const rDrug = unitCost == null ? null : r4(unitCost);
    const rTotalCost = rDrug == null ? null : r4(rDrug + fixedFreight);
    const rRateSum = rt ? r4(rt.fee + rt.profit + rt.agency) : null;
    const rRedline = rTotalCost == null || rRateSum == null || rRateSum >= 1 ? null : r4(rTotalCost / (1 - rRateSum));
    const rRevenue = r4(price);
    const roughGross = rRedline == null || rRevenue == null ? null : r4(rRevenue - rRedline);
    rough.push({ code: b.code, name: b.name, activity: b.activity, actType: b.act_type || '', play,
      price, salePrice, unitCost, cold,
      sales: rRevenue, drug: rDrug, freight: fixedFreight, totalCost: rTotalCost,
      rateSum: rRateSum, redline: rRedline, gross: roughGross,
      margin: roughGross != null && rRevenue > 0 ? r4(roughGross / rRevenue * 100) : null });
    if (summaryMap.get(key)) summaryMap.get(key).roughGross = roughGross;
  }

  const summary = [...summaryMap.values()];
  const computable = summary.filter((s) => s.grossValue != null);
  const belowCost = summary.filter((s) => s.unitCost != null && s.price < s.unitCost).length;
  const kpis = {
    products: base.length,
    tierRows: tiers.filter((t) => t.boxes != null).length,
    computable: computable.length,
    costMissing: summary.filter((s) => s.costMissing).length,
    freightMissing: summary.filter((s) => s.freightMissing).length,
    rateMissing: feeRate == null ? base.length : 0,
    grossTotal: computable.length ? r4(computable.reduce((a, s) => a + s.grossValue, 0)) : null,
    negative: computable.filter((s) => s.grossValue < 0).length,
    belowCost,
    rates: rt,
  };
  return { list, platform, client, day, rates: rt, tiers, summary, rough, kpis };
}

module.exports = { freightProbabilities, stores, rates, load, playOf, COLD, LOSS, PACK_LOW, PACK_HIGH, COLD_FEE, ROUGH_FREIGHT, ROUGH_COLD_FREIGHT };
