// Read-only presentation models. CTEs exist only for the duration of each SELECT.
// No legacy database or demo business records are created.
const empty = require('./empty-models.json');
const menu = require('./menu.json');
const literal = s => s == null ? 'NULL' : typeof s === 'number' ? String(s) : "'" + String(s).replace(/'/g, "''") + "'";
const definitions = { ...empty };
definitions.menu = menu.map(r => 'SELECT ' + r.map((v,i) => `${literal(v)} AS \`${['id','parent_id','title','href','icon_key','sort_order','is_mvp','enabled'][i]}\``).join(',')).join(' UNION ALL ');
definitions.customer = 'SELECT CRC32(`客户`) id, `客户` name, NULL contact, `创建时间` created_at FROM ec_dw.dim_client';
// 采集巡检日志：数据源为「平台/门店/采集项」，门店位即 dim_store.客户。
// 只取最近一次巡检结果判定拉取状态，不用成功记录推断登录态。
definitions.store = `SELECT CRC32(s.店铺编码) id, CRC32(s.客户) customer_id, s.平台 platform,
 s.店铺 store_name, d.商家负责人 owner, IF(s.是否在采=1,'采集中','未启用') status,
 '未知' login_status,
 CASE WHEN pl.last_result IS NULL THEN '待核验' WHEN pl.last_result='ok' THEN '正常' ELSE '失败' END pull_status,
 COALESCE(pl.last_at, d.采集时间) last_pull_at,
 pl.rows_today today_rows,
 CASE WHEN pl.last_result IS NULL THEN '尚无巡检记录'
      WHEN pl.last_result<>'ok' THEN CONCAT('最近一轮采集异常：',COALESCE(pl.last_msg,'')) END pull_note,
 s.创建时间 created_at
 FROM ec_dw.dim_store s LEFT JOIN ec_dw.fact_store_daily d
 ON d.店铺编码=s.店铺编码 AND d.日期=(SELECT MAX(x.日期) FROM ec_dw.fact_store_daily x WHERE x.店铺编码=s.店铺编码)
 LEFT JOIN (SELECT 客户, 平台, MAX(巡检时间) last_at,
   SUBSTRING_INDEX(GROUP_CONCAT(结果 ORDER BY 巡检时间 DESC),',',1) last_result,
   SUBSTRING_INDEX(GROUP_CONCAT(COALESCE(说明,'') ORDER BY 巡检时间 DESC),',',1) last_msg,
   SUM(CASE WHEN DATE(巡检时间)=CURDATE() THEN 行数 ELSE 0 END) rows_today
  FROM (SELECT SUBSTRING_INDEX(数据源,'/',1) 平台,
         SUBSTRING_INDEX(SUBSTRING_INDEX(数据源,'/',2),'/',-1) 客户,
         巡检时间, 结果, 行数, 说明
        FROM ec_dw.bi_pull_log) t
  WHERE 客户<>'全部' GROUP BY 客户, 平台) pl
 ON pl.客户 COLLATE utf8mb4_0900_ai_ci = s.客户 COLLATE utf8mb4_0900_ai_ci
 AND pl.平台 COLLATE utf8mb4_0900_ai_ci = s.平台 COLLATE utf8mb4_0900_ai_ci`;
// 12/17 点快照来自分时表（按客户+平台，与 dim_store 一一对应），数据质量非 ok 的时点不填金额。
definitions.store_daily = `SELECT CONCAT(d.店铺编码,':',d.日期) id, CRC32(d.店铺编码) store_id,
 d.日期 stat_date, d.昨日交易额 yesterday_amount,
 NULL month_amount, d.日环比平台*100 mom, d.商品动销率*100 sell_through,
 d.经营商品数量 active_sku, d.非替尔泊肽销售金额占比*100 non_tz_ratio,
 it.amt_12 today_1200, it.amt_17 today_1700, d.采集时间 stat_at
 FROM ec_dw.fact_store_daily d
 LEFT JOIN ec_dw.dim_store s ON s.店铺编码=d.店铺编码
 LEFT JOIN (SELECT 记录日期, 客户, 平台,
   MAX(CASE WHEN 时点=12 AND 数据质量='ok' THEN 当日交易额 END) amt_12,
   MAX(CASE WHEN 时点=17 AND 数据质量='ok' THEN 当日交易额 END) amt_17
  FROM ec_dw.esale_shop_intraday GROUP BY 记录日期,客户,平台) it
 ON it.记录日期=d.日期
 AND it.客户 COLLATE utf8mb4_0900_ai_ci = s.客户 COLLATE utf8mb4_0900_ai_ci
 AND it.平台 COLLATE utf8mb4_0900_ai_ci = s.平台 COLLATE utf8mb4_0900_ai_ci`;
// Calendar month totals stay empty until source semantics are verified (some old
// collectors stored rolling-30-day amounts in the monthly column).
// 禁售区域来自已采集的省级黑名单，按 69 码聚合；无记录表示未采集到，不是「不限售」。
definitions.product = `SELECT CRC32(p.商品编码) id, p.\`69码\` code69, p.货品名称 name,
 p.规格名称 spec, NULL category, NULL brand, NULL retail_price, NULL floor_price,
 NULL approval_no, IF(p.是否在营=1,'在营','停用') status,
 '待接入' sell_time_limit, rb.provinces ban_provinces
 FROM ec_dw.dim_product p
 LEFT JOIN (SELECT \`69码\`, GROUP_CONCAT(DISTINCT 省份 ORDER BY 省份) provinces
   FROM ec_dw.bi_region_ban
   WHERE \`69码\` IS NOT NULL AND \`69码\`<>'' AND 省份 IS NOT NULL AND 省份<>''
   GROUP BY \`69码\`) rb
 ON rb.\`69码\` COLLATE utf8mb4_0900_ai_ci = p.\`69码\``;
definitions.sku_mapping = `SELECT ROW_NUMBER() OVER(ORDER BY m.平台,m.店铺编码,m.平台商品ID,m.平台规格ID) id,
 CRC32(p.商品编码) product_id, m.平台 platform, m.平台商品ID platform_sku,
 NULL wdt_code FROM ec_dw.dim_product_platform m JOIN ec_dw.dim_product p
 ON m.\`69码\`=p.\`69码\` AND m.\`69码\`<>''`;
definitions.sync_log = `SELECT 批次ID id, CONCAT(COALESCE(平台,''),' / ',阶段) source,
 结束时间 sync_time, CASE 状态 WHEN 'success' THEN '成功' WHEN 'failed' THEN '失败' ELSE '部分成功' END result,
 行数 rows_count, 说明 message FROM ec_dw.ops_collect_run`;
definitions.data_source = `SELECT ROW_NUMBER() OVER(ORDER BY 平台,阶段) id,
 CONCAT(COALESCE(平台,''),' / ',阶段) name, '采集' source_type, '历史记录' status,
 '待核验' freq, MAX(结束时间) last_sync, '以同步日志为准' remark
 FROM ec_dw.ops_collect_run GROUP BY 平台,阶段`;
definitions.aftersale = `SELECT ROW_NUMBER() OVER(ORDER BY a.平台,a.店铺编码,a.售后单号) id,
 CRC32(a.店铺编码) store_id, a.订单号 order_no, a.售后类型 type,
 CASE WHEN a.售后状态 LIKE '%待%审核%' THEN '待审核' ELSE a.售后状态 END status,
 NULL handled, a.申请时间 submit_time, NULL auto_refund_at,
 a.商家审核时间 first_review_at, a.系统审核时间 final_review_at FROM ec_dw.fact_aftersale_ticket a`;
// 仓库与实物库存来自 ERP 库存导出：同一仓库同一商家编码（即 69 码）只取最新记录日一行。
// 批号/效期只在「该仓库该条码仅有唯一批次」时填写，多批次不猜选。
definitions.warehouse = `SELECT CRC32(w.仓库) id, w.仓库 name, NULL location
 FROM (SELECT DISTINCT 仓库 FROM ec_dw.bi_stock WHERE 仓库<>'测试仓库') w`;
definitions.inventory = `SELECT ROW_NUMBER() OVER(ORDER BY s.仓库, s.商家编码) id,
 CRC32(p.商品编码) product_id, CRC32(s.仓库) warehouse_id,
 b.批次 batch_no, e.有效期 expiry_date,
 s.正品库存 qty, s.锁定量 locked_qty, s.近30天净销量 net_sales_30
 FROM (SELECT x.* FROM ec_dw.bi_stock x
       WHERE x.记录日期=(SELECT MAX(y.记录日期) FROM ec_dw.bi_stock y WHERE y.仓库=x.仓库)
         AND x.仓库<>'测试仓库') s
 JOIN ec_dw.dim_product p ON p.\`69码\` = s.商家编码 COLLATE utf8mb4_0900_ai_ci
 LEFT JOIN (SELECT 仓库, 商家编码, MAX(有效期) 有效期 FROM ec_dw.bi_stock_expiry
   WHERE 商家编码 IS NOT NULL AND 商家编码<>'' AND 有效期 IS NOT NULL
   GROUP BY 仓库,商家编码) e
 ON e.仓库=s.仓库 AND e.商家编码=s.商家编码
 LEFT JOIN (SELECT 仓库, 商家编码, MIN(批次) 批次 FROM ec_dw.bi_stock_batch
   WHERE 商家编码 IS NOT NULL AND 商家编码<>'' AND 批次 IS NOT NULL AND 批次<>''
   GROUP BY 仓库,商家编码 HAVING COUNT(DISTINCT 批次)=1) b
 ON b.仓库=s.仓库 AND b.商家编码=s.商家编码`;
definitions.activity = `SELECT CRC32(CONCAT(平台,':',活动ID)) id, 平台 platform, 活动名称 name,
 NULL status, NULL signup_deadline, DATE(活动开始) start_date, DATE(活动结束) end_date,
 NULL subsidy_note FROM ec_dw.dim_campaign`;

function prepare(sql) {
  if (!/^\s*SELECT\b/i.test(sql) || /;|\b(INTO|OUTFILE|DUMPFILE|FOR\s+UPDATE)\b/i.test(sql))
    throw new Error('当前适配层仅支持只读查询');
  const names = Object.keys(definitions).filter(n => new RegExp('\\b(?:FROM|JOIN)\\s+`?'+n+'`?\\b','i').test(sql));
  if (!names.length) return sql;
  return 'WITH ' + names.map(n => '`'+n+'` AS ('+definitions[n]+')').join(',\n') + '\n' + sql;
}
module.exports = { prepare, definitions };
