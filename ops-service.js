const mysql=require('mysql2/promise');
const {randomUUID}=require('crypto');
const math=require('./public/activity-math');
const key=(...v)=>Buffer.from(JSON.stringify(v)).toString('base64url');
const json=v=>typeof v==='string'?JSON.parse(v):v;
function assess(p){
  if(p.price==null||!p.boxes||p.floor==null)return {...p,result:'待维护',reason:p.price==null?'缺少平台售价':!p.boxes?'缺少销售规格盒数':'尚未维护运营底价'};
  const below=math.compare(p.price,math.multiply(p.floor,p.boxes))<0;
  return {...p,result:below?'低于底价':'价格规则通过',reason:below?'平台售价低于单盒运营底价×销售盒数':'仅表示所维护的价格规则通过'};
}
function register(app,{stores:loadStores,pool:readPool},{rollbackWrites=false,database='ec_dw'}={}){
  if(!process.env.OPS_DB_USER||!process.env.OPS_DB_PASSWORD)throw new Error('Operations credentials required');
  const pool=mysql.createPool({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3307),user:process.env.OPS_DB_USER,password:process.env.OPS_DB_PASSWORD,database,dateStrings:true,charset:'utf8mb4',connectionLimit:3});
  async function storeFor(platform,code){const s=(await loadStores()).find(s=>s.platform===platform&&s.code===code);if(!s)throw new Error('请选择有效的平台和店铺');return s;}
  async function products(store){const [rows]=await pool.query(`SELECT p.平台商品ID productId,p.平台规格ID skuId,p.\`69码\` code,p.平台商品名称 name,p.平台规格名称 spec,p.盒数 boxes,p.平台售价 price,p.平台库存 stock,p.数据日期 date,
    r.商品分类 category,r.单盒运营底价 floor,r.售卖时段 sellTime,r.禁售区域 regions,r.填写人 actor,r.更新时间 ruleDate
    FROM dim_product_platform p LEFT JOIN input_store_product_rule r ON r.店铺编码=p.店铺编码 AND r.\`69码\`=p.\`69码\`
    WHERE p.店铺编码=? ORDER BY p.平台商品ID,p.平台规格ID`,[store.code]);return rows.map(r=>({...r,key:key(store.code,r.productId,r.skuId)}));}
  const actor=v=>{if(typeof v!=='string'||!v.trim()||v.length>64)throw new Error('请填写姓名，最多64字');return v.trim();};
  async function transact(work){const conn=await pool.getConnection();try{await conn.beginTransaction();const result=await work(conn);if(rollbackWrites)await conn.rollback();else await conn.commit();return result;}catch(e){await conn.rollback();throw e;}finally{conn.release();}}
  async function audit(conn,module,id,before,after,who){await conn.query('INSERT INTO ops_business_audit (`模块`,`对象键`,`变更前`,`变更后`,`填写人`) VALUES (?,?,?,?,?)',[module,id,JSON.stringify(before),JSON.stringify(after),who]);}
  function route(method,url,handler){app[method](url,async(req,res)=>{try{if(method==='post'&&(!req.is('application/json')||req.get('origin')&&new URL(req.get('origin')).host!==req.get('host')))return res.status(403).json({ok:false,msg:'请通过当前中台页面保存'});const result=await handler(req);res.json({ok:true,...result,...(rollbackWrites?{testRollback:true}:{})});}catch(e){if(e.code){console.error('operations:',e.code);return res.status(503).json({ok:false,msg:'业务数据暂时读取或保存失败'});}res.status(400).json({ok:false,msg:e.message});}});}
  route('get','/api/ops/products',async req=>{const store=await storeFor(req.query.platform,req.query.store);return {store,rows:await products(store)};});
  route('post','/api/ops/rule',async req=>{
    const b=req.body||{},store=await storeFor(b.platform,b.store),who=actor(b.actor);
    const [known]=await pool.query('SELECT 1 FROM dim_product_platform WHERE 店铺编码=? AND `69码`=? LIMIT 1',[store.code,b.code]);if(!known.length)throw new Error('该条码不属于所选店铺');
    if(!['','处方药','OTC','器械','其他'].includes(b.category)||!['','不限制','白天','晚上'].includes(b.sellTime))throw new Error('商品分类或售卖时段无效');
    let floor=null;if(b.floor!==''&&b.floor!=null){math.multiply(b.floor,1);floor=String(b.floor);}
    if(typeof b.regions!=='string'||b.regions.length>255)throw new Error('禁售区域请控制在255字以内');
    const value={category:b.category,floor,sellTime:b.sellTime,regions:b.regions.trim()};
    await transact(async conn=>{const [before]=await conn.query('SELECT * FROM input_store_product_rule WHERE 店铺编码=? AND `69码`=? FOR UPDATE',[store.code,b.code]);await conn.query('INSERT INTO input_store_product_rule (`店铺编码`,`69码`,`商品分类`,`单盒运营底价`,`售卖时段`,`禁售区域`,`填写人`) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE `商品分类`=VALUES(`商品分类`),`单盒运营底价`=VALUES(`单盒运营底价`),`售卖时段`=VALUES(`售卖时段`),`禁售区域`=VALUES(`禁售区域`),`填写人`=VALUES(`填写人`),`更新时间`=CURRENT_TIMESTAMP',[store.code,b.code,b.category||null,floor,b.sellTime||null,value.regions||null,who]);await audit(conn,'rule',key(store.code,b.code),before,value,who);});
    return {msg:'规则已保存，仅用于所选店铺的该条码',rule:value};
  });
  route('post','/api/ops/patrol',async req=>{
    const b=req.body||{},store=await storeFor(b.platform,b.store),who=actor(b.actor),rows=(await products(store)).map(assess);if(!rows.length)throw new Error('该店铺尚无商品快照，不能生成巡检报告');
    const batch=randomUUID(),risk=rows.filter(r=>r.result==='低于底价').length,missing=rows.filter(r=>r.result==='待维护').length,passed=rows.length-risk-missing;
    await transact(conn=>conn.query('INSERT INTO ops_patrol_run (`批次ID`,`店铺编码`,`检查数量`,`低价数量`,`待维护数量`,`价格通过数量`,`检查明细`,`填写人`) VALUES (?,?,?,?,?,?,?,?)',[batch,store.code,rows.length,risk,missing,passed,JSON.stringify(rows),who]));return {msg:'巡检报告已生成',batch,total:rows.length,risk,missing,passed};
  });
  route('get','/api/ops/patrol',async req=>{
    const store=await storeFor(req.query.platform,req.query.store),[history]=await pool.query('SELECT 批次ID batch,检查数量 total,低价数量 risk,待维护数量 missing,价格通过数量 passed,填写人 actor,创建时间 createdAt FROM ops_patrol_run WHERE 店铺编码=? ORDER BY 创建时间 DESC,批次ID DESC LIMIT 20',[store.code]);
    const batch=req.query.batch||history[0]?.batch;
    const [runs]=batch?await pool.query('SELECT * FROM ops_patrol_run WHERE 店铺编码=? AND 批次ID=?',[store.code,batch]):[[]];return {store,history,run:runs[0]?{...runs[0],检查明细:json(runs[0].检查明细)}:null};
  });
  async function tickets(){
    const [dw]=await readPool.query(`SELECT a.平台 platform,a.店铺编码 store,a.售后单号 caseId,a.订单号 orderId,a.售后状态 status,a.售后类型 type,a.商品信息 name,a.退款金额 amount,a.申请时间 createdAt,a.采集时间 collectedAt,s.店铺 storeName FROM fact_aftersale_ticket a JOIN dim_store s ON s.店铺编码=a.店铺编码`);
    const [tm]=await readPool.query('SELECT 售后单号 caseId,订单编号 orderId,退款状态 status,售后类型 type,商品标题 name,退款金额 amount,申请时间 createdAt,最近采集时间 collectedAt,店铺 rawStore FROM adjust_price.tmall_after_sale_all');
    const stores=await loadStores(),unmatched=[];
    for(const t of tm){const matches=stores.filter(s=>s.platform==='天猫'&&(s.name===t.rawStore||s.client===t.rawStore));if(matches.length!==1){unmatched.push(t.caseId);continue;}const s=matches[0];dw.push({...t,platform:'天猫',store:s.code,storeName:s.name});}
    const [follow]=await pool.query("SELECT `对象键` objectKey,`跟进状态` followStatus,`备注` note,`填写人` actor,`更新时间` followedAt FROM ops_followup WHERE 模块='aftersale'");const fm=new Map(follow.map(r=>[r.objectKey,r]));
    const [summary]=await readPool.query(`SELECT a.日期 date,a.平台 platform,a.店铺编码 store,s.店铺 storeName,
      a.待商家审核数量 pending,a.即将自动退售后单 imminent,a.采集时间 collectedAt
      FROM fact_store_aftersale_daily a JOIN dim_store s ON s.店铺编码=a.店铺编码
      JOIN (SELECT 店铺编码,MAX(日期) date FROM fact_store_aftersale_daily GROUP BY 店铺编码) latest
      ON latest.店铺编码=a.店铺编码 AND latest.date=a.日期 ORDER BY a.日期 DESC,a.平台,a.店铺编码`);
    return {rows:dw.map(t=>{const id=key(t.platform,t.store,t.caseId);return {...t,key:id,...fm.get(id)};}),summary,unmatched:unmatched.length};
  }
  route('get','/api/ops/aftersale',async()=>tickets());
  route('post','/api/ops/followup',async req=>{
    const b=req.body||{},who=actor(b.actor);if(!['未跟进','跟进中','已跟进'].includes(b.status)||typeof b.note!=='string'||b.note.length>500)throw new Error('跟进状态无效或备注超过500字');
    if(b.module!=='aftersale')throw new Error('不支持该跟进类型');
    if(!(await tickets()).rows.some(t=>t.key===b.key))throw new Error('售后单不存在或已无法对应店铺');
    await transact(async conn=>{const [before]=await conn.query('SELECT * FROM ops_followup WHERE 模块=? AND 对象键=? FOR UPDATE',[b.module,b.key]);const after={status:b.status,note:b.note.trim(),actor:who};await conn.query('INSERT INTO ops_followup (`模块`,`对象键`,`跟进状态`,`备注`,`填写人`) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE `跟进状态`=VALUES(`跟进状态`),`备注`=VALUES(`备注`),`填写人`=VALUES(`填写人`),`更新时间`=CURRENT_TIMESTAMP',[b.module,b.key,b.status,after.note,who]);await audit(conn,b.module,b.key,before,after,who);});return {msg:'内部跟进已保存；平台原始状态未修改'};
  });
  route('get','/api/ops/doctor',async()=>{
    const [rows]=await readPool.query('SELECT * FROM adjust_price.v_doctor_prescription ORDER BY 记录日期 DESC,店铺,医生');const stores=await loadStores();return {rows:rows.map(r=>{const match=stores.filter(s=>s.platform==='京东'&&(s.name===r.店铺||s.client===r.店铺));return {...r,store:match.length===1?match[0].code:null};}),notes:'仅展示平台处方状态与已采医生信息；缺接单、开方完成时间，无法计算平均接单时长和开方及时率。'};
  });
  route('get','/api/ops/competitors',async()=>{
    const [rows]=await readPool.query('SELECT * FROM adjust_price.bi_competitor_price ORDER BY 采集日期 DESC,平台,店铺,SKU');return {rows,dates:[...new Set(rows.map(r=>r.采集日期))].sort(),notes:'已有数据为落地页展示价，含挂号问诊服务，不是券后到手价。单个采集日只能作为底册，不能证明新上架。'};
  });
  return {products,tickets};
}
module.exports={register,assess,key};
