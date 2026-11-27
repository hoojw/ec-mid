const mysql = require('mysql2/promise');
const {spawn} = require('child_process');
const {randomUUID,createHash} = require('crypto');
const path = require('path');

function parseFile(filename,content) {
  return new Promise((resolve,reject) => {
    const child = spawn(process.env.COST_PYTHON || '/opt/subsidy/venv/bin/python', [path.join(__dirname,'parse_cost.py')], {stdio:['pipe','pipe','pipe']});
    let result='';
    const timer=setTimeout(()=>{child.kill();reject(new Error('文件解析超时，请减少行数后重试'));},15000);
    child.stdout.on('data',b=>{result+=b;if(result.length>3e6)child.kill();});
    child.stderr.resume();
    child.on('error',()=>{clearTimeout(timer);reject(new Error('文件解析服务暂不可用'));});
    child.stdin.on('error',()=>{});
    child.on('close',code=>{clearTimeout(timer);try {const parsed=JSON.parse(result);if(!parsed.ok)throw new Error(parsed.msg);resolve(parsed.rows);}catch(e){reject(new Error(e.message.startsWith('Unexpected')?'文件读取失败':e.message));}});
    child.stdin.end(JSON.stringify({filename,content}));
  });
}
function exportFile(data){
  return new Promise((resolve,reject)=>{
    const child=spawn(process.env.COST_PYTHON||'/opt/subsidy/venv/bin/python',[path.join(__dirname,'export_cost.py')],{stdio:['pipe','pipe','pipe']});
    let chunks=[],length=0;const timer=setTimeout(()=>{child.kill();reject(new Error('导出超时，请稍后重试'));},15000);
    child.stdout.on('data',chunk=>{chunks.push(chunk);length+=chunk.length;if(length>8*1024*1024)child.kill();});child.stderr.resume();child.stdin.on('error',()=>{});
    child.on('error',()=>{clearTimeout(timer);reject(new Error('成本表导出服务暂不可用'));});
    child.on('close',code=>{clearTimeout(timer);if(code!==0)return reject(new Error('成本表导出失败，请稍后重试'));resolve(Buffer.concat(chunks));});
    child.stdin.end(JSON.stringify(data));
  });
}

function register(app, {rollbackUploads=false}={}) {
  if(!process.env.COST_DB_USER || !process.env.COST_DB_PASSWORD)throw new Error('Cost upload credentials required');
  const pool=mysql.createPool({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3307),
    user:process.env.COST_DB_USER,password:process.env.COST_DB_PASSWORD,database:'ec_dw',dateStrings:true,charset:'utf8mb4',connectionLimit:3});
  const stores=async()=> {
    const [rows]=await pool.query(`SELECT 客户 client,平台 platform FROM esale_system
      UNION SELECT 客户,平台 FROM esale_product
      UNION SELECT 客户,'' FROM input_cost c WHERE NOT EXISTS (SELECT 1 FROM esale_system s WHERE s.客户=c.客户)
      AND NOT EXISTS (SELECT 1 FROM esale_product p WHERE p.客户=c.客户) ORDER BY client,platform`);
    return rows.map(s=>({...s,name:s.client,code:JSON.stringify([s.client,s.platform]),id:s.client}));
  };
  const costStores=async()=> {
    const rows=await stores();
    return [...new Set(rows.map(s=>s.client))].map(client=>({client,name:client,code:client,id:client}));
  };
  async function selected(platform,code) {
    const store=(await costStores()).find(s=>s.code===code);
    if(!store)throw new Error('请选择有效的店铺');
    return store;
  }
  async function currentCosts(store) {
    const [rows]=await pool.query(`SELECT 商品upc code,货品名称 name,成本价 cost,修改时间 updatedAt
      FROM input_cost WHERE 客户=? AND 商品upc IS NOT NULL AND 商品upc<>'' ORDER BY 商品upc`,[store.client]);
    return rows.map(r=>({...r,source:'客户成本表'}));
  }
  function rateDate(value) {
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw new Error('请选择有效的生效日期');
    return value;
  }
  async function rateScope(client,platform){
    if(!(await costStores()).some(s=>s.client===client)||!['美团','京东','天猫','拼多多'].includes(platform))throw new Error('请选择有效的客户和平台');
  }
  app.get('/api/rate/current',async(req,res)=>{
    try{
      const {client,platform,date}=req.query;await rateScope(client,platform);rateDate(date);
      const [rows]=await pool.query(`SELECT 平台扣点 fee,利润点 profit,代运营费率 agency,生效日期 since FROM merchant_profit_setting WHERE 客户=? AND 平台=? AND 生效日期<=? AND (失效日期 IS NULL OR 失效日期>=?) ORDER BY 生效日期 DESC LIMIT 1`,[client,platform,date,date]);
      res.json({ok:true,rates:rows[0]||null});
    }catch(e){res.status(e.code?503:400).json({ok:false,msg:e.code?'费率读取失败':e.message});}
  });
  app.post('/api/rate/update',async(req,res)=>{
    let conn;
    try{
      if(!req.is('application/json'))throw new Error('请通过费率调整窗口保存');
      const origin=req.get('origin');if(origin&&new URL(origin).host!==req.get('host'))return res.status(403).json({ok:false,msg:'请在当前中台页面保存'});
      const {client,platform,date,fee,profit,agency}=req.body||{};await rateScope(client,platform);rateDate(date);
      const values=[fee,profit,agency];
      if(values.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0||v>=100||Math.abs(v*10000-Math.round(v*10000))>1e-7)||values.reduce((a,b)=>a+b,0)>=100)throw new Error('费率须为非负数字，最多4位小数，合计须小于100%');
      conn=await pool.getConnection();await conn.beginTransaction();
      await conn.query(`INSERT INTO merchant_profit_setting (客户,平台,平台扣点,利润点,代运营费率,生效日期,操作人) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE 平台扣点=VALUES(平台扣点),利润点=VALUES(利润点),代运营费率=VALUES(代运营费率),失效日期=NULL,操作人=VALUES(操作人)`,[client,platform,fee/100,profit/100,agency/100,date,'中台费率调整']);
      if(rollbackUploads)await conn.rollback();else await conn.commit();
      res.json({ok:true,...(rollbackUploads?{testRollback:true}:{}),msg:'费率已保存'});
    }catch(e){if(conn)await conn.rollback();res.status(e.code?500:400).json({ok:false,msg:e.code?'费率保存失败':e.message});}
    finally{if(conn)conn.release();}
  });
  app.get('/api/cost/options',async(req,res)=>res.json({ok:true,stores:await costStores()}));
  app.get('/api/cost/current',async(req,res)=>{
    const store=await selected(req.query.platform,req.query.store);
    res.json({ok:true,store,rows:await currentCosts(store)});
  });
  async function download(req,res){
    try{
      const store=await selected(req.query.platform,req.query.store),rows=(await currentCosts(store)).filter(r=>r.cost!=null);
      if(!rows.length)return res.status(404).json({ok:false,msg:'该店铺暂无已有成本数据（未接入）'});
      const file=await exportFile({name:store.name,rows});
      res.set('Content-Disposition',"attachment; filename=existing-cost.xlsx; filename*=UTF-8''"+encodeURIComponent(store.name+'已有成本表.xlsx'));
      res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(file);
    }catch(e){console.error('cost export:',e.code||e.message);res.status(e.code?503:400).json({ok:false,msg:e.code?'成本表暂时读取失败':e.message});}
  }
  app.get('/api/cost/template',download);
  app.get('/api/cost/export',download);
  // This specific endpoint precedes the prototype's global business-write blocker.
  app.post('/api/cost/upload',async(req,res,next)=>{
    let conn,lockName;
    try {
      if(!req.is('application/json'))throw new Error('请通过成本数据更新窗口上传');
      const origin=req.get('origin');
      if(origin && new URL(origin).host!==req.get('host'))return res.status(403).json({ok:false,msg:'请在当前中台页面上传'});
      const {platform,store:code,filename,content}=req.body||{};
      if(typeof filename!=='string'||filename.length>255||/[\x00-\x1f]/.test(filename)||typeof content!=='string'||content.length>7.1e6)throw new Error('请选择不超过5MB的.xlsx或.csv文件');
      const store=await selected(platform,code);
      const rows=await parseFile(filename,content);
      conn=await pool.getConnection();
      // Serialize the input stream without granting write privileges on store metadata.
      lockName='ec-cost-'+createHash('sha256').update(store.client).digest('hex').slice(0,48);
      const [lock]=await conn.query('SELECT GET_LOCK(?,5) acquired',[lockName]);
      if(lock[0].acquired!==1)throw new Error('该店铺正在更新成本，请稍后重试');
      await conn.beginTransaction();
      const [known]=await conn.query(`SELECT 商品upc code FROM input_cost WHERE 客户=?
        UNION SELECT 条码 FROM esale_product WHERE 客户=? AND 条码 IS NOT NULL AND 条码<>''
        UNION SELECT 唯一编码 FROM esale_product WHERE 客户=?`,[store.client,store.client,store.client]);
      const valid=new Set(known.map(r=>r.code));const invalid=rows.filter(r=>!valid.has(r.code));
      if(invalid.length)throw new Error(invalid.slice(0,12).map(r=>`第${r.line}行：该编码未关联到所选客户`).join('；'));
      const [previous]=await conn.query('SELECT * FROM input_cost WHERE 客户=? AND 商品upc IN (?) FOR UPDATE',[store.client,rows.map(r=>r.code)]);
      const batch=randomUUID();
      const values=rows.map(r=>[store.client,r.code,r.name||null,r.cost]);
      await conn.query('INSERT INTO input_cost (客户,商品upc,货品名称,成本价) VALUES ? ON DUPLICATE KEY UPDATE 货品名称=COALESCE(VALUES(货品名称),货品名称),成本价=VALUES(成本价),修改时间=CURRENT_TIMESTAMP',[values]);
      await conn.query('INSERT INTO ops_import_run (`批次ID`,`文件名`,`文件摘要`,`行数`,`更新前数据`,`上传数据`) VALUES (?,?,?,?,?,?)',[batch,path.basename(filename),createHash('sha256').update(Buffer.from(content,'base64')).digest('hex'),rows.length,JSON.stringify(previous),JSON.stringify({client:store.client,rows})]);
      if(rollbackUploads)await conn.rollback();else await conn.commit();
      res.json({ok:true,count:rows.length,batch,...(rollbackUploads?{testRollback:true}:{}),msg:`${store.client}：已更新${rows.length}条成本数据`});
    }catch(e){if(conn)await conn.rollback();if(e.code){console.error('Cost upload:',e.code);return res.status(500).json({ok:false,msg:'成本数据保存失败，请稍后重试'});}res.status(400).json({ok:false,msg:e.message});}
    finally{if(conn){if(lockName)try{await conn.query('SELECT RELEASE_LOCK(?)',[lockName]);}catch(_){}conn.release();}}
  });
  return {stores,currentCosts};
}
module.exports={register,parseFile,exportFile};
