const math=require('./public/activity-math');
function latest(items,key,date){const map=new Map();for(const r of items){const k=key(r),old=map.get(k);if(!old||String(r[date])>String(old[date]))map.set(k,r);}return map;}
function key(row){return Buffer.from(JSON.stringify([row.productId,row.skuId])).toString('base64url');}
function assemble({store,products,costs,subsidies,freights,lowest,history}) {
  const costMap=new Map(costs.map(r=>[r.code,r]));
  const latestSubsidies=latest(subsidies,r=>[r.upc,r.sku_id,r.活动类型,r.活动名称].join('|'),'日期');
  const freightMap=latest(freights,r=>[r.code,r.boxes].join('|'),'date');
  const lowMap=latest(lowest,r=>r.code,'date');
  return products.map(p=>{
    const cost=costMap.get(p.code),box=p.boxes!=null&&Number(p.boxes)>0?Number(p.boxes):null;
    const freight=box?freightMap.get([p.code,box].join('|')):null;
    const campaigns=Array.from(latestSubsidies.values()).filter(a=>p.code && a.upc===p.code && (a.sku_id?p.skuId===a.sku_id:Number(a.门槛盒数)===box));
    const purchase=cost?.cost!=null&&box?math.multiply(cost.cost,box):null;
    // Freight source carries 6 decimals; retain four for the common monetary model.
    const freightValue=freight?.cost==null?null:Number(freight.cost).toFixed(4);
    const combined=purchase!=null&&freightValue!=null?math.sum(purchase,freightValue):null;
    return {...p,key:key(p),cost:cost?.cost??null,costSource:cost?.source??'待维护',costDate:cost?.updatedAt??null,
      purchaseCost:purchase,freight:freightValue,freightDate:freight?.date??null,combinedCost:combined,
      campaigns,activityReferences:Array.from(latestSubsidies.values()).filter(a=>p.code&&a.upc===p.code&&!campaigns.includes(a)),reference:lowMap.get(p.code)??null,
      historicalFloors:history.filter(h=>h.code===p.code).map(h=>({...h,scope:'历史表未标明店铺，仅供参考'})),
      missing:[...(cost?.cost==null?['单盒成本']:[]),...(!box?['每份盒数']:[]),...(freightValue==null?['对应盒数的快递成本']:[]),'优惠承担与服务费规则']};
  });
}
function register(app,{pool,costs}) {
  async function catalog(platform,code){
    const store=(await costs.stores()).find(s=>s.platform===platform&&s.code===code);
    if(!store)throw new Error('请选择有效的平台和店铺');
    const products=(await pool.query(`SELECT p.平台商品ID productId,p.平台规格ID skuId,p.\`69码\` code,
      p.平台商品名称 name,p.平台规格名称 spec,p.盒数 boxes,p.平台售价 price,p.平台库存 stock,p.数据日期 date,
      r.单盒运营底价 operatingFloor,r.更新时间 floorDate
      FROM dim_product_platform p LEFT JOIN input_store_product_rule r ON r.店铺编码=p.店铺编码 AND r.\`69码\`=p.\`69码\`
      WHERE p.店铺编码=? ORDER BY p.平台商品ID,p.平台规格ID`,[code]))[0];
    const codes=[...new Set(products.map(p=>p.code).filter(Boolean))];
    const [costRows,subsidies,freights,lowest,history]=await Promise.all([
      costs.currentCosts(store),
      pool.query(`SELECT * FROM fact_subsidy_status_daily WHERE 店铺编码=? AND 日期=(SELECT MAX(日期) FROM fact_subsidy_status_daily WHERE 店铺编码=?)`,[code,code]).then(r=>r[0]),
      codes.length?pool.query(`SELECT p.\`69码\` code,f.订购盒数 boxes,f.订单平均运费 cost,f.生效日期 date
        FROM dim_delivery_freight f JOIN dim_product p ON p.商品编码=f.货品编号
        WHERE f.客户=? AND f.生效日期<=CURDATE() AND p.\`69码\` IN (?)`,[store.client,codes]).then(r=>r[0]):[],
      codes.length?pool.query(`SELECT upc code,日期 date,Top3LowestDiscountPrice top3,最低售价 lowest,价格来源 source
        FROM fact_platform_lowest_price WHERE 平台=? AND upc IN (?) ORDER BY 日期 DESC`,[platform,codes]).then(r=>r[0]):[],
      platform==='京东'&&codes.length?pool.query(`SELECT DISTINCT 商品upc code,记录日期 date,策略ID campaign,活动盒数 boxes,购买件数 quantity,成本底价 floor,'历史成本底价' kind
        FROM adjust_price.jd_subsidy_daily WHERE 商品upc IN (?) AND 成本底价 IS NOT NULL
        AND 记录日期=(SELECT MAX(记录日期) FROM adjust_price.jd_subsidy_daily) ORDER BY 商品upc,策略ID,活动盒数,购买件数`,[codes]).then(r=>r[0]):platform==='天猫'&&codes.length?pool.query(`SELECT DISTINCT 商品upc code,记录日期 date,活动ID campaign,活动盒数 boxes,购买件数 quantity,成本加运费 floor,'历史成本加运费' kind
        FROM adjust_price.tmall_activity_cost_freight_daily WHERE 商品upc IN (?) AND 成本加运费 IS NOT NULL
        AND 记录日期=(SELECT MAX(记录日期) FROM adjust_price.tmall_activity_cost_freight_daily) ORDER BY 商品upc,活动ID,活动盒数,购买件数`,[codes]).then(r=>r[0]):[]
    ]);
    const rows=assemble({store,products,costs:costRows,subsidies,freights,lowest,history});
    return {store,rows,stats:{products:rows.length,costReady:rows.filter(r=>r.cost!=null).length,freightReady:rows.filter(r=>r.freight!=null).length,campaignProducts:rows.filter(r=>r.campaigns.length).length},warnings:['金额按所列快照展示；未自动假定优惠承担和技术服务费率。历史底价没有店铺归属，不自动充当本店红线。']};
  }
  app.get('/api/activity/catalog',async(req,res)=>{
    try{res.json({ok:true,...await catalog(req.query.platform,req.query.store)});}catch(e){if(e.code){console.error('activity catalog:',e.code);return res.status(503).json({ok:false,msg:'活动数据暂时读取失败'});}res.status(400).json({ok:false,msg:e.message});}
  });
  // Calculation only: this POST does not write database records.
  app.post('/api/activity/calculate',(req,res)=>{
    try {res.json({ok:true,result:math.calculate(req.body||{})});}catch(e){res.status(400).json({ok:false,msg:e.message});}
  });
  return {catalog};
}
module.exports={register,assemble};
