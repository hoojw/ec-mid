// 医药电商智能运营中台（Node + Express + MySQL）
const express = require("express");
const mysql = require("mysql2/promise");
const path = require("path");
const fs = require("fs");

const app = express();
const originalGet = app.get.bind(app);
app.get = (route, ...handlers) => {
 if (!handlers.length) return originalGet(route);
 return originalGet(route, ...handlers.map(fn => (req,res,next) => Promise.resolve().then(() => fn(req,res,next)).catch(next)));
};
app.use(express.json({ limit: "12mb" }));
// 调试期禁用缓存，保证刷新即生效（v10：避免浏览器缓存旧版 css/js）
app.use((req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  next();
});
app.use(express.static(path.join(__dirname, "public")));

if (!process.env.DB_USER || !process.env.DB_PASSWORD) throw new Error("Database credentials required");
const { prepare } = require('./warehouse');
const { ratiosAt } = require('./metrics');
const pool = mysql.createPool({
 host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3307),
 user: process.env.DB_USER, password: process.env.DB_PASSWORD,
 database: 'ec_dw', charset: 'utf8mb4', dateStrings: true, connectionLimit: 10,
});
const q = async (sql, params=[]) => { const [rows]=await pool.query(prepare(sql),params); return rows; };
// 直连查询：不经过 prepare 适配层，用于显式写全库名的取数（ec_dw / ec_mid）
const qx = async (sql, params=[]) => { const [rows]=await pool.query(sql, params); return rows; };
// 默认数据日期取最近 10 天内「覆盖店铺数达到半数」的最新一天。
// 各平台分批落库，直接用 MAX(日期) 会停在只有一两家店刚到数的那天；但也不能退到覆盖更全的旧日期。
async function latestFullDate() {
  const rows = await qx(`SELECT 日期 d, COUNT(DISTINCT CONCAT(客户,'|',平台)) c FROM ec_dw.esale_system
    WHERE 时间窗口='原面板' AND 日期 >= DATE_SUB(CURDATE(), INTERVAL 10 DAY)
    GROUP BY 日期 ORDER BY 日期 DESC`);
  if (!rows.length) return null;
  const total = Number((await qx(`SELECT COUNT(DISTINCT CONCAT(客户,'|',平台)) c
    FROM ec_dw.esale_system WHERE 时间窗口='原面板'`))[0].c) || 0;
  const need = Math.max(2, Math.ceil(total / 2));
  return (rows.find(r => Number(r.c) >= need) || rows[0]).d;
}
app.get('/healthz', async (req,res) => {
 try { await q('SELECT 1'); res.json({status:'ok',database:'ec_dw',readOnly:false,costUpload:true,ui:'prototype'}); }
 catch(e) { res.status(503).json({status:'database_unavailable'}); }
});
const costUploads = require('./cost-upload').register(app);
require('./activity-data').register(app,{pool,costs:costUploads});
require('./ops-service').register(app,{pool,stores:costUploads.stores});
app.use((req,res,next) => {
 if (!['GET','HEAD'].includes(req.method)) return res.status(409).json({ok:false,msg:'该操作未接入业务接口，该操作尚未开放'});
 next();
});
/* ---------- 通用助手 ---------- */
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pad = (n) => String(n).padStart(2, "0");
const fmtDate = (d) => {
  if (!d) return "未接入";
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
};
const fmtDT = (d) => {
  if (!d) return "未接入";
  const dt = d instanceof Date ? d : new Date(d);
  return `${fmtDate(dt)} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
};
const money = (n) => n == null ? "未接入" : Number(n).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
// 通用「i」说明图标：hover / focus 显示计算逻辑或口径，让每个数字都能解释
const tip = (t, down) => `<span class="tip${down ? " down" : ""}" tabindex="0" data-tip="${esc(t)}">i</span>`;const money2 = (n) => n == null ? "未接入" : Number(n).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = (n) => n == null ? "未接入" : Number(n).toLocaleString("zh-CN");
const pct = (n) => n == null ? "未接入" : Number(n).toFixed(1) + "%";
const momHtml = (n) => n == null ? "未接入" : `<span class="mom ${Number(n) > 0 ? "up" : Number(n) < 0 ? "down" : ""}">${Number(n) > 0 ? "▲" : Number(n) < 0 ? "▼" : "—"} ${Math.abs(Number(n)).toFixed(1)}%</span>`;
const badge = (t, type) => `<span class="badge b-${type}">${esc(t)}</span>`;
const levelBadge = (lv) => ({ "优秀": "ok", "良好": "teal", "预警": "warn", "高风险": "danger" }[lv] || "gray");
const sevBadge = (s) => ({ "紧急": "danger", "重要": "warn", "优化": "info" }[s] || "gray");
const taskBadge = (s) => ({ "待处理": "gray", "处理中": "info", "已提交": "teal", "已验证": "ok", "已驳回": "danger" }[s] || "gray");
const chkBadge = (r) => ({ "通过": "ok", "预警": "warn", "拦截": "danger" }[r] || "gray");
const loginBadge = (s) => s === "正常" ? badge("正常", "ok") : s === "掉线" ? badge("掉线", "danger") : badge("未接入", "gray");
const pullBadge = (s) => s === "正常" ? badge("正常", "ok") : s === "失败" ? badge("失败", "danger") : badge("待核验", "gray");

const PF_CLASS = { "京东": "pf-jd", "天猫": "pf-tm", "美团": "pf-mt", "拼多多": "pf-pdd" };

/* 平台官方 logo（iconfont path 内联，无外部依赖、不会过期；viewBox 1024） */
const PF_LOGO = {
  "京东": `<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><path d="M926.72 18.285714H97.28A78.994286 78.994286 0 0 0 18.285714 97.28v829.44a78.994286 78.994286 0 0 0 78.994286 78.994286h829.44a78.994286 78.994286 0 0 0 78.994286-78.994286V97.28A78.994286 78.994286 0 0 0 926.72 18.285714zM315.501714 248.758857h73.069715l0.987428 342.637714c0 61.001143-17.956571 106.642286-52.150857 136.850286a217.344 217.344 0 0 1-69.888 34.56l-93.988571 12.434286h-6.144V709.485714l66.925714-7.68a127.634286 127.634286 0 0 0 48.786286-23.515428 59.245714 59.245714 0 0 0 24.685714-35.949715 249.636571 249.636571 0 0 0 7.716571-75.849142V248.758857z m522.349715 148.48A313.709714 313.709714 0 0 1 857.6 512a306.432 306.432 0 0 1-18.944 113.956571 191.561143 191.561143 0 0 1-56.100571 82.139429c-49.737143 44.251429-121.453714 67.145143-215.442286 67.145143h-107.264V249.344h107.264c93.988571 0 165.668571 21.942857 215.442286 65.170286a216.027429 216.027429 0 0 1 55.296 82.761143z m-102.692572-35.108571a134.217143 134.217143 0 0 1 37.924572 61.403428A256.731429 256.731429 0 0 1 787.309714 512a243.309714 243.309714 0 0 1-14.262857 86.308571 128.365714 128.365714 0 0 1-37.888 61.44c-35.547429 33.938286-89.234286 49.737143-159.561143 49.737143h-46.445714V312.539429h46.445714c70.290286 0 124.013714 16.786286 159.561143 50.358857v-0.804572z" fill="#E40000"/></svg>`,
  "天猫": `<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><path d="M882.346391 0.001707H138.377497A137.72777 137.72777 0 0 0 0.001195 137.080945V880.23064a137.72777 137.72777 0 0 0 137.52297 137.93257H883.370389a137.72777 137.72777 0 0 0 138.376303-137.079238V138.582809A137.72777 137.72777 0 0 0 884.906386 0.001707h-2.559995z" fill="#FF002B"/><path d="M925.559119 1012.22402c-13.038912 3.891194-26.623956 5.905057-40.243133 5.93919a154.760275 154.760275 0 0 0 40.277266-5.93919z" fill="#FFFFFF"/><path d="M933.443906 967.304628a111.957147 111.957147 0 0 0-106.427556-111.957147 7.031455 7.031455 0 0 0-5.973324-2.150396 6.826655 6.826655 0 0 0-5.973323 2.116263h12.970645c17.066638 7.884787 30.037283 54.954575 30.037283 111.957147-0.136533 17.066638-1.467731 34.06501-4.027726 50.892715h30.207949c13.585044 0.2048 27.101821-1.809064 40.038334-5.93919 6.314656-14.131176 9.352518-29.491151 8.942918-44.919392h0.2048z" fill="#FFFFFF"/><path d="M206.507517 858.863209c-3.481594-7.577587-8.465053-7.577587-11.946647 0h11.946647z" fill="#111111"/><path d="M193.502739 855.313348a111.957147 111.957147 0 0 0-106.427556 111.957147c0.341333 15.633041 4.095993 30.958882 11.059181 44.953525 12.970645 4.095993 26.453289 6.109856 40.038334 5.93919h30.207949c-2.389329-16.861839-3.652261-33.826077-3.822927-50.858582-1.058132-57.070838 11.946647-104.106493 28.945019-111.957147z m620.747765 0a111.957147 111.957147 0 0 0-106.461689 111.957147 96.870239 96.870239 0 0 0 12.970645 50.892715h68.13002a388.470819 388.470819 0 0 1-4.027727-50.858582c0-57.070838 12.117313-104.106493 29.149818-111.957147h0.238933z m-282.077396 88.985452h-42.564196c-13.209578 0-17.032505 5.973323-11.059182 14.916241l12.970645 17.032505c4.06186 5.93919 11.059182 14.882109 12.970646 18.943969 1.945597 4.027727 2.150396 1.911463 6.178123 1.911463a8.738119 8.738119 0 0 0 5.973323-1.911463c4.027727-4.06186 8.089587-12.970645 12.970645-18.943969l11.093315-17.066638c8.089587-8.908785 4.027727-14.882109-8.942919-14.882108h0.4096zM206.507517 855.313348c17.066638 7.884787 32.153546 54.954575 32.153547 111.957147-0.273066 17.066638-1.740797 34.06501-4.437326 50.892715h68.300686c8.533319-15.598907 12.970645-33.109278 12.970645-50.858582a117.077138 117.077138 0 0 0-108.987552-111.957147z m719.085735 156.910672a154.111743 154.111743 0 0 0 53.657511-30.037284c-16.04264 12.629312-33.928477 22.732762-53.008979 30.037284h-0.648532z" fill="#FFFFFF"/><path d="M47.03685 982.186736A139.639234 139.639234 0 0 1 0.001195 880.23064a133.051512 133.051512 0 0 0 47.035655 101.956096z m48.127919 30.037284a120.900065 120.900065 0 0 1-51.097514-30.037284 210.943648 210.943648 0 0 0 51.097514 30.037284z" fill="#111111"/><path d="M975.598502 681.199505c-38.980202-22.766895-81.544397 19.148768-87.073988 28.091686-53.247911 61.098565-112.400879 134.962975-218.623636 134.962975h-319.282668c-106.461689 0-163.498394-75.980673-218.623635-135.816307-7.679987-8.089587-46.830855-51.097515-86.869189-27.238354C8.944113 702.498669 2.56119 769.126825 0.001195 813.192885v70.00735a133.051512 133.051512 0 0 0 47.035655 101.751297 161.79173 161.79173 0 0 0 51.302314 30.037283 103.662761 103.662761 0 0 1-11.059181-44.919392 112.19608 112.19608 0 0 1 106.427555-111.957147 7.679987 7.679987 0 0 1 5.973324-1.945596 7.850654 7.850654 0 0 1 6.14399 1.911463 112.400879 112.400879 0 0 1 106.461689 111.957147 98.13317 98.13317 0 0 1-12.970645 51.131648h420.624365a106.427556 106.427556 0 0 1-12.970645-51.097515 112.19608 112.19608 0 0 1 106.427556-111.957147 7.850654 7.850654 0 0 1 6.14399-1.945596 7.441054 7.441054 0 0 1 5.973323 1.945596 112.19608 112.19608 0 0 1 106.427556 111.957147c-0.341333 15.598907-4.095993 30.924748-11.059181 44.919392a151.551747 151.551747 0 0 0 53.247911-30.037283 133.017378 133.017378 0 0 0 45.090058-99.805701v-70.894815c0-45.977523-6.997322-111.957147-42.564195-132.846712l-1.058132-0.204799zM542.378957 959.215041l-10.854382 15.121042a78.984402 78.984402 0 0 0-13.209578 18.943968 10.239983 10.239983 0 0 1-7.850653 4.027727 9.147718 9.147718 0 0 1-6.212256-2.116263c-3.822927-4.06186-7.850654-12.970645-12.970645-18.943969l-12.970646-17.066638c-5.973323-7.850654 0-14.882109 11.059182-14.882108h42.564196c12.970645 0 17.032505 5.973323 10.854382 14.916241h-0.4096z" fill="#111111"/><path d="M827.221149 855.313348h-12.970645c-17.066638 7.884787-30.037283 54.954575-30.037283 111.957147 0.034133 17.032505 1.160531 34.030877 3.413328 50.892715h66.218556c2.559996-16.827705 3.891194-33.826077 4.027727-50.858582 0-57.070838-14.06291-104.106493-31.061282-111.957147h0.409599z m-620.747765 0h-12.970645c-17.032505 7.884787-32.153546 54.954575-32.153547 111.957147 0.238933 17.066638 1.604264 34.06501 4.06186 50.892715h66.218557c2.559996-16.827705 3.891194-33.826077 4.027726-50.858582 0-57.070838-12.151446-104.106493-29.183951-111.957147z" fill="#111111"/><path d="M340.583027 352.530186h146.465889V314.437449H335.906768V234.155983h136.464839V193.537384H161.349192v38.092737h136.669639v80.895865h-151.551747v37.887937h146.226956c-14.882109 57.002572-61.098565 106.427556-146.226956 154.965075l18.943968 34.030876c53.213778-30.00315 119.398201-74.06921 153.463211-141.99443 8.874652 18.602636 20.343433 35.805807 34.06501 51.131648a447.009388 447.009388 0 0 0 119.432334 90.862782l18.943969-34.030876c-89.190251-46.830855-136.464839-95.812107-151.346948-152.848812h0.614399z m338.909302-65.979624h38.092736v-31.095414h83.251062v31.948746h38.092736v-31.948746h38.092737V216.509079H838.314464v-23.005828h-38.092736v25.122091h-83.251062V193.537384h-38.092736v25.122092h-36.181273v37.887936h36.181273l0.648532 30.037284z m-77.92627-73.65961a93.456911 93.456911 0 0 0-74.06921-19.182902h-4.06186v38.12687h5.973323c16.179173-1.399464 32.426613 1.297065 47.274588 7.850654 4.676259 5.119991 6.826655 12.08318 5.93919 18.978102v12.970645l-59.187101 35.976473 18.978102 34.06501 40.208999-22.357296v42.564196l-59.187101 35.976473 19.182901 34.06501 40.0042-22.971695v31.914613c-0.341333 10.922648-4.198393 21.503964-11.059181 30.037283-14.199443 15.803707-30.788215 29.354618-49.151918 40.0042l19.114634 34.06501a191.590081 191.590081 0 0 0 59.187102-49.186051 97.72357 97.72357 0 0 0 18.943968-54.920442V261.633271a76.629206 76.629206 0 0 0-18.090636-48.947119v0.2048z m40.243133 99.839833v173.909044a56.422306 56.422306 0 0 0 57.036705 57.036705h119.432334a56.422306 56.422306 0 0 0 57.036705-57.036705V312.491853l-233.505744 0.238932z m98.133169 191.555948h-40.0042a18.534369 18.534369 0 0 1-19.182901-18.943969v-38.297536h59.187101v57.241505z m0-95.982774h-58.743368v-57.685237h59.152968l-0.4096 57.685237z m98.33797 78.984402a18.295436 18.295436 0 0 1-18.943969 18.943969h-40.243132v-59.187102h59.187101v40.243133z m0-78.984402h-59.187101v-57.685237h59.187101v57.685237z" fill="#FFFFFF"/></svg>`,
  "美团": `<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><path d="M0 0m102.4 0l819.2 0q102.4 0 102.4 102.4l0 819.2q0 102.4-102.4 102.4l-819.2 0q-102.4 0-102.4-102.4l0-819.2q0-102.4 102.4-102.4Z" fill="#FFC300"/><path d="M203.0848 0h617.856C956.288 0 1024 67.6864 1024 203.0848v617.856C1024 956.288 956.3136 1024 820.9408 1024H203.0848C67.712 1024 0 956.3136 0 820.9408V203.0848C0 67.712 67.6864 0 203.0848 0z" fill="#FFC300"/><path d="M431.2064 322.56h-41.1904c-7.4752 22.1696-10.0096 31.0784-10.0096 31.0784H219.648s-2.3808-8.9088-10.0096-31.0784H168.576v31.0784H119.4496v37.1456h156.928v30.6944H127.1808v39.9616h149.1968v28.2624H127.1808v39.9616h149.1968v28.8512h-156.928v39.3728h142.3104s-40.0896 51.3536-144 56.064v41.9584s112.8448 10.88 182.0928-79.232c0 0 47.1808 77.6192 180.3776 79.36v-43.5968s-89.4208 2.688-141.2352-54.656h141.2352v-39.3472h-155.7504V529.664h148.224v-39.9616h-148.224v-28.2624h148.224v-40.0128h-148.224v-30.6432h155.7504v-37.1456H431.104l0.1024-31.0784z m191.5136 303.0528h47.8976a502.8096 502.8096 0 0 0 50.8928-160.6912h41.6768v100.992c-0.7168 20.1472-2.9696 40.192-6.7072 59.9808h44.2112c3.328-19.84 5.0432-39.8848 5.12-59.9808v-100.9664H834.56v-39.0144h-28.672v-32.3328h-42.5728v32.5888h-154.112v38.912h67.328a426.3936 426.3936 0 0 1-53.8112 160.4608v0.0512z" fill="#000000"/><path d="M542.72 332.8v368.64h310.9376a52.736 52.736 0 0 0 52.5824-52.8128V332.8H542.72z m323.0208 315.8272a12.8 12.8 0 0 1-12.8 12.8768h-270.08V372.3264h282.88v276.3008z" fill="#000000"/></svg>`,
  "拼多多": `<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><path d="M854 1024H170C76.1 1024 0 947.9 0 854V170C0 76.1 76.1 0 170 0h684c93.9 0 170 76.1 170 170v684c0 93.9-76.1 170-170 170z" fill="#F40009"/><path d="M291.8 149L97.1 286.4 291.8 429V149z m15.3 0v280l200.6-138.7L307.1 149z m-210 157.3v278l191.3-139-191.3-139z m194.7 153.3v278.7L97.1 596l194.7-136.4z m15.3 0v278.7l191-139.3-191-139.4z m6.7 290.7l197.3 142-1-280.3-196.3 138.3z m210-138.3v280.3L720.4 750 523.8 612z m12-12l191.7-141.3 1 279.6L535.8 600z m205.3-141.3v279.6l196.7-140.8-196.7-138.8z m4.7-14.4l192 140v-279l-192 139zM741.1 149v280l196.7-142-196.7-138z m-12.6 0L524.8 291l203.7 138V149z" fill="#FFFFFF"/><path d="M392.3 239.8c-0.4 6.9-6.8 12.4-14.7 12.4-7.9 0-14.3-5.5-14.7-12.4-16.6 2.8-22.6 8-35.4 14.5-1.6 0.8-2 3-0.7 4.3l10.4 15.4 5.4-5.5v55.1c0 3.1 2.5 5.6 5.6 5.6h58.2c3.3 0 6.1-2.7 6.1-6.1v-54.7l5.4 5.5 9.7-12.7c1.6-1.6 2.2-6.4 0.1-7.4-12.3-6.2-20.2-12.1-35.4-14z m-187.4 86.9c0.2 0.4 4.1 6.7 11.5 7 6 0.2 9.9-3.8 10.5-4.4 0.7 0.7 5.6 4.6 12.5 3.7 6.4-0.9 9.9-5.4 10.5-6.3 0.5 0.4 6.3 3.9 11.3 1.5 5.4-2.7 6-9.9 5-14.2-0.6-2.5-1.6-3.3-4.5-7.5-0.7-1-3.5-5.8-9.1-15.5-2.3-3.9-5-8.7-8.2-14.3 1.3-6 2.4-10.8 3.3-14 1.3-5.1 2.1-7.4 1-10.2-0.4-0.9-0.7-1.5-3.8-6.3 2.2-4.5 2.1-8.5 0.2-9.8-1.1-0.8-2.7-0.3-3-0.2-2.6 0.8-4.5 4.1-4.5 8.2-1.3 0.1-4.1 0.4-6.7 2.3-1.7 1.2-2.9 2.6-3.5 3.5-1-1.2-2.9-3.5-6.3-4.8-1.7-0.7-3.3-1-4.5-1 0.2-3.9-1.4-7-4-8-0.4-0.1-1.8-0.7-3-0.1-2 1.1-2.5 5.1-0.7 10.1-1 1.6-2.2 4.2-2.7 7.5-0.8 4.9 0.2 9.1 1 12 1.4 5.4 2.9 6.6 2.5 9.8-0.4 2.9-2 5.1-3.3 6.5-6.2 11.1-12.3 22.3-18.5 33.5-1 4.6 1 9.4 5 11.7 3.7 2.3 8.4 2 12-0.7zM148.6 416c0.8-10.6 8.9-19 18.5-20 11.1-1.2 22 7.6 23 20 3.2 0.4 8.3 1.5 12.6 5.4 1.9 1.8 4.6 4.9 7.3 16.7 2.3 10 2.8 18.4 3.6 31.8-0.4 1.4-1.4 5.2-5 8.5-3.7 3.4-7.8 4.1-9.2 4.2h-59.5c-1.5-0.2-6.3-1.1-10.2-5.2-3.5-3.6-4.5-7.6-4.8-9.2-0.1-2.3-1-26.4 6-39.3 1.1-1.9 3-5.5 7-8.5 4-2.9 8.2-4 10.7-4.4z" fill="#F40009"/><path d="M155.9 415.7h27.5s-2.7-12-13.8-12-13.7 12-13.7 12z" fill="#FFFFFF"/><path d="M258.9 636.5h6.5s-0.8-29.4 0-34c1.7-10 11.1-27 10-33.2-2.3-13.2-14.8-21.5-16.5-20.7s-16.5 17.3-21 29.5-12.7 29.2-14 29.5-14.5 2-26.5 6.5c-11.1 4.2-20 8.5-18 12.5s13.8 10 30.3 10c19.8 0 26.5-1.3 30-16 3.5-14.5 3.8-21.3 10.2-28 0.5-0.5 4.1-4.2 6.3-3.3 0 0 0.5 0.2 2.5 3.3l0.2 43.9z m75.2-3.5h87.3c0.7-0.2 1.8-0.5 3-1.5 1.8-1.5 2.4-3.6 2.5-4.2V569c-0.4-0.8-1.1-2.3-2.5-3.5-2.3-2-4.9-2.2-5.8-2.3h-13.5c-0.9-2-2.5-3-6.3-8.2-1.4-1.9-3.6-2.4-5-3h-32.2c-1.1 0.6-3 1-3.8 2.5-2.7 5.2-5.2 6.6-6 8.8-5.9 0.2-11.9 0.5-17.8 0.8-0.7 0.1-2 0.5-3.3 1.7-1.7 1.7-2 3.7-2 4.2v57.7c0.1 0.7 0.7 2.4 2.3 3.8 1.3 1 2.5 1.4 3.1 1.5zM443.4 690l-5.2 6.7h10.7l-5.5-6.7z m-54.5 58.5c0.5-3.8 3.6-24.4 22.3-38 16.5-12 37.4-12.9 51.9-7.1 9.3 3.7 16.6 10.2 17.8 11.3 4.3 3.9 8 7.3 10.8 13 6.5 13.5 4.3 20.7 6.5 20.7-2.1-1.3-7.3-4-14.5-3.8-6.1 0.2-10.7 2.5-12.7 3.8-2-1.3-6.3-3.8-12.3-4.2-4.2-0.3-7.7 0.5-9.8 1.3V788c-0.6 1.8-1.8 4.5-4.1 6.9-4.5 4.7-12 7.3-19.1 5.1-9.5-2.9-13.3-12.9-13.2-17.3 0.1-2 1-3.7 1-3.7 0.2-0.4 2.2-3.9 5.2-3.8 2.7 0.1 4.6 3.2 5.2 5 0.9 2.4-0.2 3.3 0.8 5 1.5 2.9 6.7 4.2 9.2 2.5 1.3-0.9 3.9-5.1 3-3.8l1.3-38.8c-2.3-0.7-6.5-1.6-11.7-0.8-4.8 0.8-8.3 2.7-10.2 4-2-1.2-7-3.8-13.8-3.8-6.8 0.3-11.5 2.8-13.6 4z m168.9-16.3V782c0 4.6 3.8 8.3 8.3 8.3h49c3.9 0 7-3.2 7-7v-51c0-2.9-2.4-5.4-5.4-5.4h-53.9c-2.7 0.1-5 2.4-5 5.3z m5.1-13.2h55.7c1.6 0 3-1.1 3.2-2.6 0.2-1.7-0.5-3.6-4.8-3.6h-54.1c-1.8 0-3.2 1.4-3.2 3.1-0.1 1.7 1.4 3.1 3.2 3.1z m2.5-6.3s7.2-14.5 21-14.5c26-0.1 28.8 14.5 28.8 14.5h-49.8z" fill="#F40009"/><path d="M593 703.2h-4.3c-1.5 0-2.7-1.2-2.7-2.7V695c0-1.5 1.2-2.7 2.7-2.7h4.3c1.5 0 2.7 1.2 2.7 2.7v5.5c0 1.5-1.3 2.7-2.7 2.7zM644.9 563c2.7-1.8 9-5.5 17.8-6 11-0.6 18.9 4.2 21.5 6l-4.2-15.2c-0.6-2.3-2.7-3.8-5-3.8h-21.5c-2.1 0-3.9 1.4-4.4 3.4l-4.2 15.6z m39.2 66.8c-2.7 1.8-9 5.5-17.8 6-11 0.6-18.9-4.2-21.5-6L649 645c0.6 2.3 2.7 3.8 5 3.8h21.5c2.1 0 3.9-1.4 4.4-3.4l4.2-15.6zM632.9 595.9c0 17.3 14 31.4 31.4 31.4s31.4-14 31.4-31.4c0-17.3-14-31.4-31.4-31.4s-31.4 14-31.4 31.4c0-0.1 0 0 0 0zM782.3 556.3H779c-1.3 0-2.4-1.1-2.4-2.4v-11.7c0-1.3 1.1-2.4 2.4-2.4h3.2c1.3 0 2.4 1.1 2.4 2.4v11.7c0 1.3-1 2.4-2.3 2.4z m27.8 0h-3.5c-1.4 0-2.6-1.1-2.6-2.6v-14.2c0-1.4 1.1-2.6 2.6-2.6h3.5c1.4 0 2.6 1.1 2.6 2.6v14.2c-0.1 1.4-1.2 2.6-2.6 2.6z m28 0h-3.6c-1.5 0-2.7-1.2-2.7-2.7v-11.2c0-1.5 1.2-2.7 2.7-2.7h3.6c1.5 0 2.7 1.2 2.7 2.7v11.2c0 1.5-1.2 2.7-2.7 2.7z m2.2 85.4h-63.2c-4.5 0-8-3.6-8-8v-66c0-1.8 1.4-3.2 3.2-3.2h73.4c1.6 0 2.9 1.3 2.9 2.9v66.1c0 4.5-3.7 8.2-8.3 8.2z" fill="#F40009"/><path d="M847.1 583.2s14.6 1.6 19.5 9.8c5.5 9.1 2.7 19.8-3.5 24.7-6.5 5.2-14.5 5.2-14.5 5.2v-7.5s13.8-4 12.5-13.5-14-11-14-11v-7.7z m-37-142.3c-1.4 2.4-1.3 5.4 0.1 7.9 3.3 5.7 10.8 13.9 19.4 19.5 11.4 7.5 20.7 6 20.7 6s14.2 13 18.5 14 5.5-1.3 5.5-4.8v-14s10-3.8 15.2-9 8.2-8.8 11.3-7.7 10.5 11.3 16.3 12.3 10-2.5 8-8.5-5.5-11.7-5.5-11.7 6-8.1 6-13.8c0-5.8-5.8-10.2-11-7.5s-11 12-14.5 12-10.7-9.7-17.8-12.8-8.5-4.2-8.5-4.2 1.7-15 0-17.3-8.2 0.2-12.3 3.3-11 10.2-11 10.2-12.5-0.2-27 9.8c-6.3 4.4-10.9 11.7-13.4 16.3zM766.6 292.1c0 23.6 19.1 42.7 42.6 42.7s42.7-19.1 42.7-42.6v-0.1c0-23.6-19.1-42.7-42.6-42.7s-42.7 19.1-42.7 42.7zM776.8 226s10.7-2.4 18.5 0.8c10.2 4.2 11.3 18.5 11.3 18.5s-9.5 5.5-19.5-2-10.3-17.3-10.3-17.3z m55.9 5.1s-8.1-1.8-14 0.6c-7.7 3.2-8.5 14-8.5 14s7.2 4.2 14.8-1.5 7.7-13.1 7.7-13.1z m-189.5 98.3H687c0.4 0 0.5-0.5 0.2-0.7-1.9-1.1-6.1-3.3-11.1-5.2-7-2.5-9-4.2-9-4.2v-14.9s9-7.6 15-12.2 15.7-17.4 15.7-28.1-4-27.9-4-27.9h-59.7s-4.2 23.8-2 33.8c3.8 12.7 15 22 20.7 27.2s8.5 7.5 8.5 7.5V320l-18.3 8.3c-0.5 0.2-0.4 1.1 0.2 1.1z" fill="#F40009"/><path d="M442.1 386l19.5-41.5 15 40.5 16 2v14.2l24.5-5-17.8-50.5 47.5 20-11.1 33.7 23.1-5.2 20.5-49.7 33.8 26.3-33.3 25.7 33.3-0.2 8.2 25.7H600l-7.5 31 27.3 5.7 8.8 24.5-32.5 3.8-7.5 52.2-17.8 11.6-11.3-66-21.4-1.5-13.3 56.3-18.7 11.3-2.2-64-16-1.7-6.3-19.5-7.3 9.5-10 77-39.7-28.2 25.5-7.2-4.7-37.1-14 11.8-12-40 27.8-4.5-3.3-28-8.2-1.8-13.3-24.2 19.7-7z" fill="#FFFFFF"/><path d="M484.1 407.8l-7.7 10.2-4 28.8 24-1.4-7.3 15.9 24-8.5-5.4-25-16.1-4.5-7.5-15.5z m60.2 19.7l20.3-4.5 2.8 28.5-27.5 5.3 4.4-29.3z" fill="#F40009"/></svg>`,
};
/* 平台标识：logo 图标（hover 显示平台名）；店铺列表中直接拼接到店铺名前 */
const platTag = (p) => `<span class="pf" title="${esc(p)}">${PF_LOGO[p] || esc(p)}</span>`;

const table = (headers, rows, numCols = [], sortCols = []) => {
  
  const th = headers.map((h, i) => {
    const cls = [numCols.includes(i) ? "num" : "", sortCols.includes(i) ? "sortable" : ""].filter(Boolean).join(" ");
    const dc = sortCols.includes(i) ? ` data-col="${i}"` : "";
    return `<th class="${cls}"${dc}>${h}${sortCols.includes(i) ? '<span class="sort-ind"><i class="up">▲</i><i class="down">▼</i></span>' : ""}</th>`;
  }).join("");
  const trs = rows.length ? rows.map((r) => `<tr>${r.map((c, i) => `<td class="${numCols.includes(i) ? "num" : ""}">${c}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${headers.length}" class="empty-tip">未接入</td></tr>`;
  return `<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
};
const dimBar = (label, val, weight) => `
  <div class="dim"><div class="dim-label"><span>${label}<span class="dim-w">权重 ${weight}%</span></span><span class="val">${val}</span></div>
  <div class="dim-bar"><div class="dim-fill" style="width:${Math.max(0, Math.min(100, val))}%"></div></div></div>`;
const miniBar = (v) => `<div class="mini-bar"><div class="mb-track"><div class="mb-fill" style="width:${Math.max(0, Math.min(100, v))}%"></div></div><span class="mb-val">${Number(v).toFixed(1)}</span></div>`;
const sparkline = (vals) => {
  const w = 120, h = 30, mx = Math.max(...vals), mn = Math.min(...vals);
  const pts = vals.map((v, i) => `${(i / (vals.length - 1) * w).toFixed(1)},${(h - (v - mn) / ((mx - mn) || 1) * (h - 4) - 2).toFixed(1)}`).join(" ");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="#1F5FBF" stroke-width="2" stroke-linejoin="round"/></svg>`;
};

const NAV = [
  ["/", "经营总览", "总览"], ["/analysis", "交易分析", "分析"], ["/diagnosis", "经营诊断", "诊断"],
  ["/competitor", "竞品监控", "竞品"], ["/inventory", "库存管理", "库存"],
  ["/activity", "活动管理", "活动"], ["/compliance", "风控中心", "合规"], ["/sop", "运营 SOP", "SOP"],
  ["/data", "数据与规则", "数据"], ["/about", "使用说明", ""],
];

/* 菜单 / 页签图标（内联 SVG，无外部依赖） */
const svg = (d) => `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="${d}"/></svg>`;
const ICONS = {
  "/": svg("M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"),
  "/analysis": svg("M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z"),
  "/diagnosis": svg("M7 4h10v16H7V4zM3 8h4v2H3V8zm0 6h4v2H3v-2zm14-6h4v2h-4V8zm0 6h4v2h-4v-2zM9 1h2v3H9V1zm4 0h2v3h-2V1zM9 20h2v3H9v-3zm4 0h2v3h-2v-3zM10 8h4v8h-4V8z"),
  "/competitor": svg("M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17a5 5 0 110-10 5 5 0 010 10zm0-8a3 3 0 100 6 3 3 0 000-6z"),
  "/inventory": svg("M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.81-1h12l.94 1H5.12z"),
  "/activity": svg("M20 6h-2.18c.11-.31.18-.65.18-1 0-1.66-1.34-3-3-3-1.05 0-1.96.54-2.5 1.35l-.5.67-.5-.68C10.96 2.54 10.05 2 9 2 7.34 2 6 3.34 6 5c0 .35.07.69.18 1H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-5-2c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zM9 4c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm11 15H4v-2h16v2zm0-5H4V8h5.08L7 10.83 8.62 12 11 8.76l1-1.36 1 1.36L15.38 12 17 10.83 14.92 8H20v6z"),
  "/compliance": svg("M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"),
  "/sop": svg("M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"),
  "/data": svg("M3 5h18v4H3V5zm0 5h18v4H3v-4zm0 5h18v4H3v-4z"),
  "/about": svg("M11 7h2v2h-2V7zm0 4h2v6h-2v-6zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"),
  "/menu-admin": svg("M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94L14.4 2.81c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41L9.25 5.35C8.66 5.59 8.12 5.92 7.63 6.29L5.24 5.33c-.22-.08-.47 0-.59.22L2.73 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .43-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"),
};

/* ---------- 外壳（侧栏 + 顶栏 + 多标签栏 + iframe） ---------- */
// 静态资源版本号：改前端代码后 +1，强制浏览器拉新版（防 iframe/外壳用旧缓存 js）
const ASSET_VER = "prototype-layout-cost-table-20261126-1";
// 从 menu 表渲染侧栏（两级树：父项 + 子项缩进；is_mvp 显示 MVP 角标）
async function navHtml(activeHref) {
  const rows = await q("SELECT * FROM menu WHERE enabled=1 ORDER BY parent_id, sort_order, id");
  const tops = rows.filter(r => r.parent_id === 0);
  const childrenOf = (pid) => rows.filter(r => r.parent_id === pid);
  // 待整改 / 需处理计数（子菜单角标；按确认范围：合规校验 / 售后自动退款预警 / 医生开方监控）
  const pending = {};
  // 逐项独立取数：某个数据源缺失只影响它自己那个角标，不再让四个角标一起归零
  const cnt = async (fn) => { try { const r = await fn(); return Number(r[0] && r[0].c) || 0; } catch (e) { return 0; } };
  // 售后待处理单数：原 aftersale 表随重构删除，改读 ec_dw.aftersale_case 的未完结状态
  pending[48] = await cnt(() => qx(`SELECT COUNT(*) c FROM ec_dw.aftersale_case
    WHERE 售后状态 REGEXP '待|审核中|拦截中' AND 售后状态 NOT REGEXP '退款成功|完成|驳回|不通过|失败|取消|关闭'`)); // 售后自动退款预警 = 未完结单数
  // 合规校验 / 医生开方监控 这两个子页已无数据源（原型库 ec_mid 停用），角标不再取数，固定为 0
  pending[13] = 0; // 合规校验
  pending[46] = 0; // 医生开方监控
  const childActive = (t) => childrenOf(t.id).some(c => c.href === activeHref);
  const item = (m) => {
    const mvp = m.is_mvp ? '<sup class="mvp-inline">mvp</sup>' : '';
    const bdg = pending[m.id] ? `<span class="badge-num">${pending[m.id]}</span>` : '';
    const act = m.href === activeHref ? ' active' : '';
    // MVP 上标紧跟标题；数量角标固定在最右侧（.t flex:1 撑开，各项对齐）
    return `<a href="${m.href}" data-title="${esc(m.title)}" class="sub${act}"><span class="ic"><span class="dot"></span></span><span class="t">${esc(m.title)}${mvp}</span>${bdg}</a>`;
  };
  return '<nav class="nav">' + tops.map(t => {
    const ch = childrenOf(t.id);
    const pIcon = (t.icon_key && ICONS[t.icon_key]) ? ICONS[t.icon_key] : '';
    const hasChild = ch.length > 0;
    const open = childActive(t);
    const pAct = (t.href === activeHref || open) ? ' active' : '';
    const pMvp = t.is_mvp ? '<sup class="mvp-inline">mvp</sup>' : '';
    // 一级菜单不显示数字角标；MVP 上标紧跟标题
    const label = `<span class="ic">${pIcon}</span><span class="t">${esc(t.title)}${pMvp}</span>`;
    // 有二级菜单的一级菜单：只做展开 / 收起，不打开页面
    if (hasChild) {
      return `<button type="button" class="nav-toggle${pAct}${open ? ' open' : ''}" data-nav-toggle="${t.id}">${label}<span class="caret"></span></button>` +
        `<div class="nav-children${open ? ' open' : ''}" data-nav-group="${t.id}"><div class="nav-children-inner">` + ch.map(item).join('') + '</div></div>';
    }
    return `<a href="${t.href}" data-title="${esc(t.title)}" class="${pAct}">${label}</a>`;
  }).join('') + '</nav>';
}
const shell = (title, path_, nav) => `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · 医药电商智能运营中台</title><link rel="stylesheet" href="/style.css?v=${ASSET_VER}"><link rel="stylesheet" href="/cost-upload.css?v=${ASSET_VER}"></head>
<body>
<aside class="sidebar">
  <div class="logo">医药电商智能运营中台</div>
  ${nav || ''}
</aside>
  <div class="main">
  <div class="topbar">
    <div class="tabs" id="tabs"></div>
    <div class="tb-right">
      <button class="icon-btn" id="logBtn" title="操作记录"><svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M13 3a9 9 0 00-9 9H1l3.89 3.89.07.14L9 12H6a7 7 0 117 7v2a9 9 0 000-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/></svg></button>
      <span class="tb-user"><span class="avatar"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 12c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm0 2c-3.34 0-10 1.67-10 5v3h20v-3c0-3.33-6.66-5-10-5z"/></svg></span>运营主管</span>
      <button class="logout-btn" id="logoutBtn">退出</button>
    </div>
  </div>
  <div class="main-body">
    <div class="frame-wrap" id="frameWrap"></div>
    <div class="desc-panel" id="descPanel"></div>
  </div>
  <div class="log-mask" id="logMask"></div>
  <div class="log-overlay" id="logOverlay"></div>
</div>
<script>window.__ICONS = ${JSON.stringify(ICONS)}; window.__initPath = ${JSON.stringify(path_)}; window.__initTitle = ${JSON.stringify(title)};</script>
<script src="/desc-preset.js?v=${ASSET_VER}"></script>
<script src="/app.js?v=${ASSET_VER}"></script>
</body></html>`;

const embedPage = (content) => `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/style.css?v=${ASSET_VER}"><link rel="stylesheet" href="/cost-upload.css?v=${ASSET_VER}"></head>
<body class="embed"><div class="content">${content}</div><script src="/desc-preset.js?v=${ASSET_VER}"></script>
<script src="/app.js?v=${ASSET_VER}"></script><script src="/warehouse-ui.js?v=${ASSET_VER}"></script><script src="/cost-upload.js?v=${ASSET_VER}"></script><script src="/aftersale-detail.js?v=${ASSET_VER}"></script></body></html>`;

const errEmbed = (e) => embedPage(`<div class="banner warn"><span>⚠️</span><div>页面加载失败：${esc(e.message)}<br>请确认 MySQL（ec_dw 库）正在运行。</div></div>`);

const NOTICES = {
 '/': '指标读自 ec_dw.esale_system：面板口径（昨日交易额、近30天交易额、动销率）+ 实时口径（今日至今成交金额）。仅覆盖当日有上报的店铺，缺失值显示 未接入。',
 '/analysis': '按日读 ec_dw.esale_system 面板口径（昨日交易额、近30天交易额、动销率、非替尔泊肽占比）；环比为同日对比（较前一日 / 7 天前 / 30 天前）。12 点 / 17 点分时快照与健康度无数据源，已撤列。',
 '/compliance': '售后汇总、售后单、售后节点读自 ec_dw 三张售后表；合规校验、今日巡检、医生开方监控无数据源，页面直接报错，不展示原型演示数据。',
 '/activity': '活动核算按 ec_dw 的门槛价、成本、运费档位与费率设置算粗算 / 精算，只对美团（有补贴门槛的店铺）可算；报名、活动状态与复盘未接入。',
 '/competitor': '竞品价格与竞品新品数据未接入。',
 '/diagnosis': '健康度模型、诊断、建议与任务数据未接入。',
 '/inventory': '仓库库存、批号与效期已按 ERP 库存导出接入；补货建议缺采购周期与安全库存参数。',
 '/sop': '运营清单与完成记录未接入。',
 '/data': '已接入商品映射、采集巡检与今日拉取量；登录态与运营规则未接入。',
 '/menu-admin': '恢复原型菜单结构，暂不开放菜单保存。',
};
function present(content, req, route) {
 content=content.replace(/¥未接入/g,"未接入");
 // 下列页面的 KPI 仍无数据源，保留整体置为「未接入」；有真实数据的页面不得加入。
 const unavailable = ['/diagnosis','/sop','/competitor'].includes(route);
 if (unavailable) content = content.replace(/(<div class="v">)[\s\S]*?(<\/div>)/g, '$1未接入$2');
 if (route === '/diagnosis') content = content.replace(/正常运行/g,'未接入');
 return (NOTICES[route] ? `<div class="note" style="margin-bottom:14px">${esc(NOTICES[route])}</div>` : '') + content;
}

// 页面包装：?embed=1 时只返回内容区（供 iframe 使用），否则返回外壳（侧栏从 menu 表渲染）
const page = (req, res, title, path_, build) => {
  const activeHref = path_ + (req.query.sub ? "?sub=" + req.query.sub : "");
  return build().then((content) => {
    if (req.query.embed === "1") return res.send(embedPage(present(content, req, path_)));
    return navHtml(activeHref).then((nav) => res.send(shell(title, req.originalUrl, nav)));
  }).catch((e) => {
    console.error(e.message);
    res.status(500).send(req.query.embed === "1" ? errEmbed(e) : shell(title, path_, ""));
  });
};

// 侧栏 HTML（供菜单管理调整后父窗口热更新）
app.get("/api/nav", async (req, res) => {
  res.send(await navHtml(req.query.active || ""));
});

/* ================= 原型说明（系统外：需求确认用） ================= */
app.get("/api/desc/get", async (req, res) => {
  const { module, card_key } = req.query;
  if (!module || !card_key) return res.json({ ok: false, msg: "缺少参数" });
  const r = (await q("SELECT * FROM page_desc WHERE module=? AND card_key=?", [module, card_key]))[0];
  res.json({ ok: true, exists: !!r, content: r ? r.content_md : null, updated_at: r ? r.updated_at : null });
});

app.post("/api/desc/save", async (req, res) => {
  const { module, card_key, title, content } = req.body;
  if (!module || !card_key) return fail(res, "缺少定位参数");
  await q(`INSERT INTO page_desc (module, card_key, title, content_md, updated_at) VALUES (?,?,?,?,?)
           ON DUPLICATE KEY UPDATE title=VALUES(title), content_md=VALUES(content_md), updated_at=VALUES(updated_at)`,
    [module, card_key, title || card_key, content || "", new Date()]);
  ok(res, "原型说明已保存");
});

// 插图上传：接收 base64，落盘到 public/uploads，返回可访问 URL
app.post("/api/desc/upload", async (req, res) => {
  const { data, name } = req.body || {};
  if (!data || !/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(data)) return fail(res, "图片格式不正确");
  const mime = data.slice(5, data.indexOf(";"));
  const ext = (mime.split("/")[1] || "png").replace("jpeg", "jpg");
  const file = `d${Date.now()}${Math.random().toString(36).slice(2, 6)}.${ext}`;
  const dir = path.join(__dirname, "public", "uploads");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), Buffer.from(data.slice(data.indexOf(",") + 1), "base64"));
  ok(res, "插图已上传", { url: `/uploads/${file}` });
});

/* ================= 交互 API ================= */
const ACTOR = "运营主管";
const logAction = async (action, target, detail) =>
  q("INSERT INTO action_log (actor, action, target, detail, created_at) VALUES (?,?,?,?,?)", [ACTOR, action, target, detail, new Date()]);
const ok = (res, msg, data) => res.json(Object.assign({ ok: true, msg: msg || "操作成功" }, data || {}));
const fail = (res, msg) => res.json({ ok: false, msg });

// 任务状态流转（提交/验证/驳回均需人工填写）
app.post("/api/task/status", async (req, res) => {
  const { id, status, note } = req.body;
  const list = await q("SELECT * FROM task WHERE id=?", [id]);
  const t = list[0];
  if (!t) return fail(res, "任务不存在");
  if (status === "已验证" && !note) return fail(res, "验证通过需人工标注指标变化");
  if (status === "已驳回" && !note) return fail(res, "驳回需填写理由");
  if (status === "已提交" && !note) return fail(res, "请填写处理说明");
  const result = note || t.verified_result;
  await q("UPDATE task SET status=?, verified_result=? WHERE id=?", [status, result, id]);
  await logAction("任务状态变更", `任务#${id}`, `${t.status} → ${status}${note ? "｜" + note : ""}`);
  ok(res);
});

// 建议 → 一键生成任务 / 忽略
app.post("/api/suggestion/task", async (req, res) => {
  const { id } = req.body;
  const g = (await q("SELECT g.*, d.store_id FROM suggestion g JOIN diagnosis d ON d.id=g.diagnosis_id WHERE g.id=?", [id]))[0];
  if (!g) return fail(res, "建议不存在");
  const store = (await q("SELECT owner, store_name FROM store WHERE id=?", [g.store_id]))[0];
  const deadline = new Date(Date.now() + 2 * 864e5);
  await q("INSERT INTO task (suggestion_id, store_id, assignee, role, status, deadline, created_at) VALUES (?,?,?,?,?,?,?)",
    [id, g.store_id, store.owner || "待分配", "运营专员", "待处理", deadline, new Date()]);
  await q("UPDATE suggestion SET status='已生成任务' WHERE id=?", [id]);
  await logAction("建议生成任务", `建议#${id}`, `「${g.action.slice(0, 20)}…」分配给出 ${store.owner || "待分配"}，截止 ${fmtDate(deadline)}`);
  ok(res, "已生成任务并分配");
});
app.post("/api/suggestion/ignore", async (req, res) => {
  const { id, reason } = req.body;
  if (!reason) return fail(res, "忽略需填写理由");
  await q("UPDATE suggestion SET status='已忽略', ignore_reason=? WHERE id=?", [reason, id]);
  await logAction("建议忽略", `建议#${id}`, reason);
  ok(res);
});

// 补货建议：状态可逆切换（待确认/已确认/已调整/已忽略）；选「已调整」需填数量
const RP_STATUS = ["待确认", "已确认", "已调整", "已忽略"];
app.post("/api/replenish/status", async (req, res) => {
  const { id, status, qty, reason } = req.body;
  const r = (await q("SELECT * FROM replenish_advice WHERE id=?", [id]))[0];
  if (!r) return fail(res, "建议不存在");
  if (!RP_STATUS.includes(status)) return fail(res, "非法状态");
  if (status === r.status) return fail(res, "状态未变化");
  if (status === "已调整") {
    if (!qty || qty <= 0) return fail(res, "调整数量需大于 0");
    await q("UPDATE replenish_advice SET status='已调整', advice_qty=? WHERE id=?", [qty, id]);
    await logAction("补货建议调整", `补货建议#${id}`, `补货量 ${r.advice_qty} → ${qty}`);
    return ok(res, `补货量已调整为 ${qty}`);
  }
  if (status === "已忽略" && !reason) return fail(res, "忽略需填写理由");
  await q("UPDATE replenish_advice SET status=? WHERE id=?", [status, id]);
  await logAction("补货建议状态变更", `补货建议#${id}`, `${r.status} → ${status}${reason ? "｜" + reason : ""}`);
  ok(res, `已改为「${status}」`);
});

// 合规整改闭环：待整改 → 整改中 → 待复核 → 已闭环（品控复核）；已闭环可重新打开
app.post("/api/compliance", async (req, res) => {
  const { id, status } = req.body;
  const c = (await q("SELECT * FROM compliance_check WHERE id=?", [id]))[0];
  if (!c) return fail(res, "记录不存在");
  const flow = { "待整改": "整改中", "整改中": "待复核", "待复核": "已闭环", "已闭环": "待整改" };
  if (!flow[c.handle_status] || flow[c.handle_status] !== status) return fail(res, `当前状态「${c.handle_status}」不能直接变为「${status}」`);
  await q("UPDATE compliance_check SET handle_status=? WHERE id=?", [status, id]);
  await logAction("合规整改推进", `合规校验#${id}`, `${c.handle_status} → ${status}｜${c.detail.slice(0, 30)}`);
  ok(res, status === "待整改" ? "已重新打开" : `已进入「${status}」`);
});

// 爬虫店铺重新登录
app.post("/api/store/relogin", async (req, res) => {
  const { id } = req.body;
  const s = (await q("SELECT * FROM store WHERE id=?", [id]))[0];
  if (!s) return fail(res, "店铺不存在");
  await q("UPDATE store SET login_status='正常', pull_status='正常', pull_note='', last_pull_at=?, today_rows=? WHERE id=?",
    [new Date(), 800 + Math.floor(Math.random() * 3000), id]);
  const src = `${s.platform}商家后台爬虫`;
  await q("INSERT INTO sync_log (source, sync_time, result, rows_count, message) VALUES (?,?,?,?,?)",
    [src, new Date(), "成功", 800 + Math.floor(Math.random() * 2000), `${s.store_name}-${s.platform} 重新登录后恢复拉取`]);
  await logAction("爬虫重新登录", `${s.store_name}-${s.platform}`, "登录态已刷新，数据拉取恢复正常");
  ok(res, "已重新登录，拉取恢复正常");
});

// 活动报名撤回：删除报名记录，活动回到可报名
app.post("/api/activity/unsignup", async (req, res) => {
  const { activity_id } = req.body;
  const act = (await q("SELECT * FROM activity WHERE id=?", [activity_id]))[0];
  if (!act || act.status !== "已报名") return fail(res, "仅已报名活动可撤回");
  await q("DELETE FROM activity_signup WHERE activity_id=?", [activity_id]);
  await q("UPDATE activity SET status='可报名' WHERE id=?", [activity_id]);
  await logAction("撤回活动报名", `${act.name}`, "报名已撤回，可重新提交");
  ok(res, "已撤回报名");
});

// 售后预警：去处理
// 售后状态：可逆切换（任意状态随时改回，防手滑；留痕可查谁改的）
const AS_STATUS = ["待审核", "快递拦截中", "已跟进", "已完成"];
// 医生接单开方时效状态 / 上架计划状态 / 提醒状态（均可逆）
const DOCTOR_STATUS = ["正常", "预警", "异常"];
const VIOLATION_STATUS = ["提醒中", "预警", "已处理", "已删除"];
app.post("/api/aftersale/status", async (req, res) => {
  const { id, status } = req.body;
  const a = (await q("SELECT * FROM aftersale WHERE id=?", [id]))[0];
  if (!a) return fail(res, "售后单不存在");
  if (!AS_STATUS.includes(status)) return fail(res, "非法状态");
  if (status === a.status) return fail(res, "状态未变化");
  const auto = a.auto_refund_at && new Date(a.auto_refund_at) <= new Date() && status === "待审核";
  await q("UPDATE aftersale SET status=?, handled=? WHERE id=?", [status, status === "待审核" ? 0 : 1, id]);
  await logAction("修改售后单状态", `售后单#${a.order_no}`, `${a.status} → ${status}`);
  ok(res, `已改为「${status}」${auto ? "，该单即将超时自动退款" : ""}`);
});

// 医生接单开方时效状态：可逆切换
app.post("/api/doctor/sla/status", async (req, res) => {
  const { id, status } = req.body;
  const r = (await q("SELECT * FROM doctor_sla WHERE id=?", [id]))[0];
  if (!r) return fail(res, "记录不存在");
if (!DOCTOR_STATUS.includes(status)) return fail(res, "非法状态");
  if (status === r.status) return fail(res, "状态未变化");
  await q("UPDATE doctor_sla SET status=? WHERE id=?", [status, id]);
  await logAction("修改医生时效状态", `医生时效#${r.doctor}`, `${r.status} → ${status}`);
  ok(res, `已改为「${status}」`);
});

// 开售限制违规提醒状态：可逆切换（提醒中 → 预警 → 已处理 / 已删除）
app.post("/api/violation/status", async (req, res) => {
  const { id, status } = req.body;
  const r = (await q("SELECT * FROM sell_time_violation WHERE id=?", [id]))[0];
  if (!r) return fail(res, "记录不存在");
  if (!VIOLATION_STATUS.includes(status)) return fail(res, "非法状态");
  if (status === r.status) return fail(res, "状态未变化");
  await q("UPDATE sell_time_violation SET status=? WHERE id=?", [status, id]);
  await logAction("修改开售限制违规状态", `违规#${r.id}`, `${r.status} → ${status}`);
  ok(res, `已改为「${status}」`);
});

// 商品可售卖时间：列表直接设置（白天/晚上/不限制）
app.post("/api/product/selltime", async (req, res) => {
  const { id, status } = req.body;
  if (!["不限制", "白天", "晚上"].includes(status)) return fail(res, "非法时段");
  const p = (await q("SELECT * FROM product WHERE id=?", [id]))[0];
  if (!p) return fail(res, "商品不存在");
  if (status === p.sell_time_limit) return fail(res, "未变化");
  await q("UPDATE product SET sell_time_limit=? WHERE id=?", [status, id]);
  await logAction("修改可售卖时间", `商品#${p.name}`, `${p.sell_time_limit} → ${status}`);
  ok(res, `「${p.name}」开售时段改为「${status}」`);
});

// 商品禁售区域（省级黑名单，逗号分隔，多个）：列表弹窗设置
app.post("/api/product/ban", async (req, res) => {
  const { id, ban } = req.body;
  const list = (Array.isArray(ban) ? ban : String(ban || "").split(","))
    .map(s => String(s).trim()).filter(Boolean);
  const provinces = new Set(["北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江", "上海", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "广西", "海南", "重庆", "四川", "贵州", "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆", "中国台湾", "中国香港", "中国澳门"]);
  const bad = list.filter(x => !provinces.has(x));
  if (bad.length) return fail(res, "含非法省份：" + bad.join(","));
  const csv = list.join(",");
  const p = (await q("SELECT * FROM product WHERE id=?", [id]))[0];
  if (!p) return fail(res, "商品不存在");
  if (csv === p.ban_provinces) return fail(res, "未变化");
  await q("UPDATE product SET ban_provinces=? WHERE id=?", [csv, id]);
  await logAction("修改禁售区域", `商品#${p.name}`, `${p.ban_provinces || "空"} → ${csv || "空"}`);
  ok(res, `「${p.name}」禁售区域已更新`, { ban: csv });
});

// 交易趋势：按平台 / 店铺 / 时间区间筛选（供 KPI 与店铺卡下钻）；days=N 表示最近 N 天
// 交易趋势：按日汇总各店「昨日交易额」，只读 ec_dw.esale_system
app.get("/api/trend", async (req, res) => {
  const { platform, store_id, from, to, days } = req.query;
  const where = ["e.时间窗口='原面板'"], args = [];
  if (days) {
    const latest = (await qx(`SELECT MAX(日期) d FROM ec_dw.esale_system WHERE 时间窗口='原面板'`))[0].d;
    where.push("e.日期>=?"); args.push(subDays(latest, Number(days) - 1));
  }
  if (platform && platform !== "全部") { where.push("e.平台=?"); args.push(platform); }
  if (store_id) { where.push("CRC32(CONCAT(e.客户,'|',e.平台))=?"); args.push(store_id); }
  if (from) { where.push("e.日期>=?"); args.push(from); }
  if (to) { where.push("e.日期<=?"); args.push(to); }
  const rows = await qx(`SELECT e.日期 d, SUM(e.昨日交易额) amt, COUNT(DISTINCT CONCAT(e.客户,'|',e.平台)) stores
    FROM ec_dw.esale_system e WHERE ${where.join(" AND ")}
    GROUP BY e.日期 HAVING COUNT(e.昨日交易额)>0 ORDER BY e.日期`, args);
  res.json({ ok: true, rows: rows.map(r => ({ date: fmtDate(r.d), amount: Number(r.amt), stores: Number(r.stores) })) });
});

// 活动核算：平台补贴价（活动价）近 30 天走势（平台 × 商品维度，不区分店铺；演示合成，待真实数据接入）
app.get("/api/activity/price-trend", (req,res) => res.json({ok:false,msg:"活动补贴价格历史未接入",rows:[],base:null}));

// 店铺列表（供趋势弹窗筛选下拉）
app.get("/api/stores", async (req, res) => {
  const rows = await qx(`SELECT DISTINCT CRC32(CONCAT(客户,'|',平台)) id, 客户, 平台
    FROM ec_dw.esale_system WHERE 时间窗口='原面板'
    ORDER BY FIELD(平台,'京东','美团','天猫','拼多多'), 客户`);
  res.json({ ok: true, stores: rows.map(r => ({ id: r.id, store_name: r.客户, platform: r.平台 })) });
});

// 店铺指定日期经营数据（供店铺卡"看某天"）
// 单店指定日期明细：只读 ec_dw.esale_system（原面板口径），无健康度数据源
app.get("/api/store/day", async (req, res) => {
  const { store_id, date } = req.query;
  const row = (await qx(`SELECT * FROM ec_dw.esale_system
    WHERE 时间窗口='原面板' AND CRC32(CONCAT(客户,'|',平台))=? AND 日期=? LIMIT 1`, [store_id, date]))[0];
  if (!row) return res.json({ ok: false, msg: `${date} 无该店铺数据` });
  // 三环比：基于该店完整日序列
  const ser = await qx(`SELECT 日期, 昨日交易额 FROM ec_dw.esale_system
    WHERE 时间窗口='原面板' AND 客户=? AND 平台=? ORDER BY 日期`, [row.客户, row.平台]);
  const arr = ser.map(r => ({ date: fmtDate(r.日期), amt: r.昨日交易额 == null ? null : Number(r.昨日交易额) }));
  const m = new Map(arr.map(r => [r.date, r.amt]));
  const d0 = fmtDate(date);
  const shift = (n) => { const dt = new Date(d0 + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() - n); return dt.toISOString().slice(0, 10); };
  const mom = (n) => { const a = m.get(d0), b = m.get(shift(n)); return a == null || b == null || b === 0 ? null : (a - b) / b * 100; };
  const day = mom(1), week = mom(7), m30 = mom(30);
  res.json({ ok: true, store: { store_name: row.客户, platform: row.平台 }, day: row, health: null, ratios: { day, week, m30 } });
});

// 待闭环事项明细（供总览 KPI 点击下钻，每项带跳转页面）
app.get("/api/pending", async (req, res) => {
  const tasks = await q(`SELECT t.id, g.action, t.assignee, t.status, s.store_name FROM task t
    JOIN store s ON s.id=t.store_id JOIN suggestion g ON g.id=t.suggestion_id
    WHERE t.status IN ('待处理','处理中') ORDER BY t.deadline LIMIT 20`);
  const defenses = await q(`SELECT d.id, d.line_type, d.level, d.detail FROM defense_trigger d WHERE d.status='待处理' LIMIT 20`);
  const afters = await q(`SELECT a.id, a.order_no, a.auto_refund_at, s.store_name FROM aftersale a JOIN store s ON s.id=a.store_id
    WHERE a.status='待审核' ORDER BY a.auto_refund_at LIMIT 20`);
  const complies = await q(`SELECT c.id, c.check_type, c.detail FROM compliance_check c WHERE c.handle_status='待整改' LIMIT 20`);
  const replen = await q(`SELECT r.id, r.advice_qty, p.name FROM replenish_advice r JOIN product p ON p.id=r.product_id
    WHERE r.status='待确认' LIMIT 20`);
  res.json({ ok: true, groups: [
    { key: "task", name: "运营任务", page: "/diagnosis", items: tasks.map(t => ({ id: t.id, text: `${t.store_name}｜${t.action}`, extra: `负责人 ${t.assignee} · ${t.status}` })) },
    { key: "defense", name: "防歪防线", page: "/diagnosis", items: defenses.map(x => ({ id: x.id, text: `${x.line_type}触发：${x.detail}`, extra: x.level })) },
    { key: "aftersale", name: "售后退款", page: "/", items: afters.map(a => ({ id: a.id, text: `${a.store_name}｜${a.order_no}`, extra: `自动退款倒计时 ${fmtDT(a.auto_refund_at).slice(11, 16)}` })) },
    { key: "compliance", name: "合规整改", page: "/compliance", items: complies.map(c => ({ id: c.id, text: `${c.check_type}：${c.detail}`, extra: "待整改" })) },
    { key: "replenish", name: "补货建议", page: "/inventory", items: replen.map(r => ({ id: r.id, text: `${r.name} 建议补货 ${r.advice_qty}`, extra: "待确认" })) },
  ].filter(g => g.items.length) });
});

// 活动报名：可报名商品清单
app.get("/api/activity/products", async (req, res) => {
  const actId = req.query.activity_id;
  const act = (await q("SELECT * FROM activity WHERE id=?", [actId]))[0];
  if (!act) return res.json({ ok: false, msg: "活动不存在" });
  const signed = new Set((await q("SELECT product_id FROM activity_signup WHERE activity_id=?", [actId])).map(r => r.product_id));
  const rows = await q(`
    SELECT p.id, p.code69, p.name, p.spec, p.floor_price,
           COALESCE(SUM(i.qty - i.locked_qty), 0) stock
    FROM product p LEFT JOIN inventory i ON i.product_id = p.id
    WHERE p.status='在售' GROUP BY p.id ORDER BY p.id`);
  res.json({
    ok: true,
    activity: act,
    products: rows.map(r => ({ ...r, signed: signed.has(r.id), match: Number(r.stock) > 0 && r.floor_price != null })),
  });
});
app.post("/api/activity/signup", async (req, res) => {
  const { activity_id, product_ids } = req.body;
  const act = (await q("SELECT * FROM activity WHERE id=?", [activity_id]))[0];
  if (!act || act.status !== "可报名") return fail(res, "活动不在可报名状态");
  if (!Array.isArray(product_ids) || !product_ids.length) return fail(res, "请至少勾选 1 个商品");
  for (const pid of product_ids) {
    await q("INSERT INTO activity_signup (activity_id, product_id, status) VALUES (?,?, '已提交')", [activity_id, pid]);
  }
  await q("UPDATE activity SET status='已报名' WHERE id=?", [activity_id]);
  await logAction("提交活动报名", `${act.name}`, `报名商品 ${product_ids.length} 个`);
  ok(res, `已提交 ${product_ids.length} 个商品报名`);
});

// 评分下钻数据
app.get("/api/score/detail", async (req, res) => {
  const storeId = req.query.store_id;
  const store = (await q("SELECT * FROM store WHERE id=?", [storeId]))[0];
  if (!store) return res.json({ ok: false, msg: "店铺不存在" });
  const details = await q("SELECT * FROM score_detail WHERE store_id=? ORDER BY id", [storeId]);
  const dimOrder = ["交易表现", "商品结构", "运营效率", "库存健康", "售后体验", "合规健康"];
  const dims = dimOrder.map(dim => ({
    dim,
    indicators: details.filter(x => x.dim === dim),
  }));
  res.json({ ok: true, store, dims });
});

// SOP 清单勾选：真实写库，当天完成可取消
app.post("/api/sop/toggle", async (req, res) => {
  const { id, done } = req.body;
  const s = (await q("SELECT * FROM sop_item WHERE id=?", [id]))[0];
  if (!s) return fail(res, "清单项不存在");
  const today = fmtDate(new Date());
  if (done) {
    await q("INSERT IGNORE INTO sop_done (sop_item_id, done_date) VALUES (?,?)", [id, today]);
    await logAction("SOP 清单完成", s.title, `${today} 完成`);
  } else {
    await q("DELETE FROM sop_done WHERE sop_item_id=? AND done_date=?", [id, today]);
    await logAction("SOP 清单取消完成", s.title, `${today} 取消`);
  }
  ok(res, done ? "已标记完成" : "已取消完成");
});

// 操作留痕（分页）
app.get("/api/logs", async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const size = Math.min(100, parseInt(req.query.size) || 20);
  const total = (await q("SELECT COUNT(*) c FROM action_log"))[0].c;
  const logs = await q("SELECT * FROM action_log ORDER BY id DESC LIMIT ? OFFSET ?", [size, (page - 1) * size]);
  res.json({ ok: true, logs, total, page, size, pages: Math.max(1, Math.ceil(total / size)) });
});

/* ================= 页面 ================= */

// ---- 1. 经营总览 ----
app.get("/", (req, res) => page(req, res, "经营总览", "/", async () => {
  // 首页只读 ec_dw.esale_system 一张表：
  //   时间窗口='原面板' → 昨日交易额、近30天交易额、商品动销率（各店按日一行）
  //   时间窗口='实时'   → 今日至今成交金额、统计结束时间
  // 重构后 dim_store / fact_store_daily / health_score / task / defense_trigger / esale_shop_intraday
  // 均已删除，此处不再引用；原先靠 health_score 的「健康度」不进首页。
  const cov = await qx(`SELECT 日期, COUNT(DISTINCT CONCAT(客户,'|',平台)) c FROM ec_dw.esale_system
    WHERE 时间窗口='原面板' AND 日期 >= DATE_SUB(CURDATE(), INTERVAL 10 DAY)
    GROUP BY 日期 ORDER BY 日期 DESC`);
  const totalStore = Number((await qx(`SELECT COUNT(DISTINCT CONCAT(客户,'|',平台)) c
    FROM ec_dw.esale_system WHERE 时间窗口='原面板'`))[0].c) || 0;
  const need = Math.max(2, Math.ceil(totalStore / 2)); // 覆盖过半店的最新一天，避免停在只有一两家店刚到数那天
  let d = (cov.find(r => Number(r.c) >= need) || cov[0] || {}).日期 || fmtDate(new Date());
  if (req.query.date && (await qx(`SELECT 1 FROM ec_dw.esale_system
      WHERE 时间窗口='原面板' AND 日期=? LIMIT 1`, [req.query.date])).length) d = req.query.date;
  const ds = fmtDate(d);
  const rows = await qx(`SELECT 客户, 平台, 昨日交易额, 近30天交易额, 商品动销率
    FROM ec_dw.esale_system WHERE 时间窗口='原面板' AND 日期=?
    ORDER BY FIELD(平台,'京东','天猫','美团','拼多多'), 客户`, [ds]);
  const num = (arr, f) => arr.filter(r => r[f] != null).map(r => Number(r[f]));
  const sum = (arr, f) => { const v = num(arr, f); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
  const v30 = num(rows, "近30天交易额"), sum30 = v30.length ? v30.reduce((a, b) => a + b, 0) : null;
  const vY = num(rows, "昨日交易额"), sumY = vY.length ? vY.reduce((a, b) => a + b, 0) : null;
  const vSt = num(rows, "商品动销率");
  const avgSt = vSt.length ? vSt.reduce((a, b) => a + b, 0) / vSt.length : null;
  // 实时口径取最新一天；缺采集时点的店金额仍计入，但在说明里标出，不当 0 也不隐藏
  const rt = await qx(`SELECT 客户, 平台, 成交金额, 统计结束时间 FROM ec_dw.esale_system
    WHERE 时间窗口='实时' AND 日期=(SELECT MAX(日期) FROM ec_dw.esale_system WHERE 时间窗口='实时')`);
  const rtOk = rt.filter(r => r.成交金额 != null);
  const rtAmt = rtOk.length ? rtOk.reduce((a, b) => a + Number(b.成交金额), 0) : null;
  const rtTime = rt.map(r => r.统计结束时间).filter(Boolean).sort().pop();
  const rtNoTime = rtOk.filter(r => !r.统计结束时间).length;
  const n = rows.length;
  const rtNote = rtAmt == null ? "今日暂无实时快照"
    : `${rtTime ? String(rtTime).slice(0, 16) + " 快照" : "部分店缺采集时点"} · ${rtOk.length} 店上报${rtNoTime ? `，其中 ${rtNoTime} 店无时点` : ""}`;
  return `
    <div class="grid g4">
      <div class="kpi kpi-click" data-goto="/analysis" title="点击前往交易分析">
        <div class="l">近30天交易额（${n} 店）</div>
        <div class="v">¥${money2(sum30)}</div>
        <div class="d">截至 ${ds} · 滚动 30 天，${v30.length}/${n} 店有值</div></div>
      <div class="kpi kpi-click" data-goto="/analysis" title="点击前往交易分析">
        <div class="l">昨日交易额（${n} 店）</div>
        <div class="v">¥${money2(sumY)}</div>
        <div class="d">数据日期 ${ds} · ${vY.length}/${n} 店有值</div></div>
      <div class="kpi kpi-click" data-goto="/analysis" title="点击前往交易分析">
        <div class="l">当日交易额（实时快照）</div>
        <div class="v">${rtAmt == null ? "—" : "¥" + money2(rtAmt)}</div>
        <div class="d">${rtNote}</div></div>
      <div class="kpi">
        <div class="l">平均动销率</div>
        <div class="v">${avgSt == null ? "—" : pct(avgSt * 100)}</div>
        <div class="d">${vSt.length}/${n} 店有值 · 简单平均</div></div>
    </div>
  `;
}));

// ---- 2. 交易分析（新增：把总览 KPI 的筛选下钻能力立为正式页面）----
app.get("/analysis", (req, res) => page(req, res, "交易分析", "/analysis", async () => {
  // 只读 ec_dw.esale_system 的「原面板」口径（一店一天一行）。
  // 原 store / store_daily / health_score 模型随重构删除；12 点 / 17 点分时快照与健康度评分
  // 已无对应数据源，表格不再保留这两类列，避免用 0 或假值填空。
  const range = (await qx(`SELECT MIN(日期) min_d, MAX(日期) max_d FROM ec_dw.esale_system WHERE 时间窗口='原面板'`))[0];
  const maxD = fmtDate(range.max_d), minD = fmtDate(range.min_d);
  let ds = (await latestFullDate()) || maxD;
  if (req.query.date && (await qx(`SELECT 1 FROM ec_dw.esale_system
      WHERE 时间窗口='原面板' AND 日期=? LIMIT 1`, [req.query.date])).length) ds = req.query.date;
  const rows = await qx(`SELECT CRC32(CONCAT(客户,'|',平台)) id, 客户, 平台,
      昨日交易额, 近30天交易额, 商品动销率, 非替尔泊肽销售金额占比, 经营商品数量, 修改日期
    FROM ec_dw.esale_system WHERE 时间窗口='原面板' AND 日期=?
    ORDER BY FIELD(平台,'京东','美团','天猫','拼多多'), 客户`, [ds]);
  // 环比统一按该店「昨日交易额」日序列滚动计算（与首页同源）：日=较上日，7日=近 7 天较前 7 天，30日=近 30 天较前 30 天。
  // 源里的「昨日周环比」只有个别店有值，不能当列展示；这里不混用两种口径。
  const series = await qx(`SELECT 客户, 平台, 日期, 昨日交易额 FROM ec_dw.esale_system
    WHERE 时间窗口='原面板' ORDER BY 客户, 平台, 日期`);
  const amtMap = {};
  series.forEach(r => {
    const k = r.客户 + '|' + r.平台;
    (amtMap[k] = amtMap[k] || new Map()).set(fmtDate(r.日期), r.昨日交易额 == null ? null : Number(r.昨日交易额));
  });
  // 环比统一按「同日对比」：日环比较前一日、7日环比较 7 天前、30日环比较 30 天前。
  // 不用滚动区间求和：采集缺一天就会让整段合计作废（30 日环比几乎全空），也与平台自带口径对不上。
  const shiftDay = (s, n) => { const dt = new Date(s + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() - n); return dt.toISOString().slice(0, 10); };
  const momAt = (m, n) => { const a = m.get(ds), b = m.get(shiftDay(ds, n)); return a == null || b == null || b === 0 ? null : (a - b) / b * 100; };
  rows.forEach(r => {
    const m = amtMap[r.客户 + '|' + r.平台] || new Map();
    r.dayMo = momAt(m, 1); r.weekMo = momAt(m, 7); r.m30Mo = momAt(m, 30);
  });
  // 店铺对比表（按平台 tab，前置「全部」；数据日期可筛选，置于 tab 之上）
  const cmpRow = (r) => [`${platTag(r.平台)}<button class="link-btn store-detail" data-id="${r.id}">${esc(r.客户)}</button>`,
    `<b>¥${money2(r.昨日交易额)}</b>`, `¥${money2(r.近30天交易额)}`,
    momHtml(r.dayMo), momHtml(r.weekMo), momHtml(r.m30Mo),
    pct(r.商品动销率 == null ? null : Number(r.商品动销率) * 100),
    pct(r.非替尔泊肽销售金额占比 == null ? null : Number(r.非替尔泊肽销售金额占比) * 100),
    int(r.经营商品数量)];
  const PLAT_ORDER = ["全部", "京东", "美团", "天猫", "拼多多"];
  const cmpPaneId = (pf) => pf === "全部" ? "apane-all" : `apane-${PF_CLASS[pf]}`;
  const cmpList = (pf) => pf === "全部" ? rows : rows.filter(r => r.平台 === pf);
  const cmpHeads = ["店铺", "昨日交易额", "近30天交易额",
    `日环比 ${tip("较前一日，按该店「昨日交易额」日序列自算；两日任一缺失即显示未接入")}`,
    `7日环比 ${tip("较 7 天前同一日，按日序列自算")}`,
    `30日环比 ${tip("较 30 天前同一日，按日序列自算")}`,
    "商品动销率", "非替尔泊肽占比", "经营商品数"];
  const cmpNum = [1, 2, 3, 4, 5, 6, 7, 8];
  const cmpSort = [1, 2, 3, 4, 5, 6, 7, 8];
  const cmpBoard = PLAT_ORDER.map((pf, i) => {
    const list = cmpList(pf);
    return `<div class="tab-pane ${i === 0 ? "active" : ""}" id="${cmpPaneId(pf)}">
      <div class="card">
      <div class="ap-table">${table(cmpHeads, list.map(cmpRow), cmpNum, cmpSort)}</div>
      </div></div>`;
  }).join("");
  const cmpTabs = PLAT_ORDER.map((pf, i) =>
    `<button class="tab-btn ${i === 0 ? "active" : ""}" data-target="${cmpPaneId(pf)}">${pf}（${cmpList(pf).length}）</button>`).join("");
  return `
    <div class="card"><h3>交易分析</h3>
      <form class="day-pick" data-az-date onsubmit="return false;">
        <label>数据日期</label>
        <input type="date" name="date" value="${ds}" min="${minD}" max="${maxD}">
        <span class="note">每店一天一行，缺失值显示未接入；环比为同日对比；点击数值列表头可排序，点击店铺名看单店趋势与明细</span>
      </form>
      <div data-tabs>
        <div class="tabs-inline">${cmpTabs}</div>
        ${cmpBoard}
      </div>
      <p class="note" style="margin-top:8px">环比为「同日对比」：日环比较前一日、7日环比较 7 天前、30日环比较 30 天前，任一日缺失或为 0 就显示未接入，不用 0 或推算值填补。当日 12 点 / 17 点分时快照与店铺健康度评分在重构后已无数据源，已撤列；当日成交金额看经营总览的实时口径。</p></div>
    <div class="card" id="analysis-trend"><h3>交易额趋势 <span class="sub">按平台 / 店铺 / 时间区间筛选 · 悬停数据点看当日金额</span></h3>
      <div class="chart-filter">
        <label>平台 <select id="az-platform"><option value="全部">全部</option><option>京东</option><option>美团</option><option>天猫</option><option>拼多多</option></select></label>
        <label>店铺 <select id="az-store"><option value="">全部店铺</option></select></label>
        <label>从 <input type="date" id="az-from" value="${subDays(ds, 29)}"></label>
        <label>到 <input type="date" id="az-to" value="${ds}"></label>
      </div>
      <p class="note">按采集日期展示各店上报的昨日交易额（元）；仅汇总已接入金额，各日覆盖店铺可能不同。</p><div class="chart-area" id="az-chart"><div class="note" style="padding:20px;text-align:center">加载中…</div></div></div>
    <script>
    (function () {
      var chart = document.getElementById("az-chart");
      var pf = document.getElementById("az-platform"), st = document.getElementById("az-store");
      var fi = document.getElementById("az-from"), ti = document.getElementById("az-to");
      var stores = [], loadId = 0;
      function fillStores() {
        st.replaceChildren(new Option('全部店铺',''));
        stores.filter(function(s){ return pf.value === '全部' || s.platform === pf.value; }).forEach(function(s){st.add(new Option(s.store_name+'（'+s.platform+'）',s.id));});
      }
      fetch('/api/stores').then(function(r){return r.json();}).then(function(d){stores=d.stores || [];fillStores();}).catch(function(){});
      function loadTrend() {
        var id=++loadId;
        if(!fi.value || !ti.value || fi.value>ti.value){chart.textContent='请选择有效的起止日期';return;}
        var params=new URLSearchParams({from:fi.value,to:ti.value});
        if(pf.value!=='全部')params.set('platform',pf.value);
        if(st.value)params.set('store_id',st.value);
        chart.textContent='加载中…';
        fetch('/api/trend?'+params).then(function(r){if(!r.ok)throw new Error('交易额读取失败');return r.json();}).then(function(d){
          if(id!==loadId)return;
          if(!d.ok){chart.textContent=d.msg||'交易额读取失败';return;}
          chart.innerHTML=lineChartSVG(d.rows);
          if(window.enhanceChart)enhanceChart(chart);
        }).catch(function(e){if(id===loadId)chart.textContent=e.message;});
      }
      pf.onchange=function(){fillStores();loadTrend();};
      st.onchange=loadTrend;fi.onchange=loadTrend;ti.onchange=loadTrend;
      document.querySelectorAll('.tabs-inline .tab-btn').forEach(function(button){button.addEventListener('click',function(){
        var text=button.textContent.replace(/（.*$/, '');if(!Array.from(pf.options).some(function(o){return o.value===text;}))return;
        pf.value=text;fillStores();loadTrend();
      });});
      loadTrend();
    })();
    </script>
`;
}));

// ---- 9. 数据与规则（原数据统一中心 + 体系自进化合并）----
app.get("/data", (req, res) => page(req, res, "数据与规则", "/data", async () => {
  const sub = req.query.sub || "src";
  const platStats = await q(`
    SELECT platform, COUNT(*) stores, SUM(today_rows) rows_total,
           SUM(login_status='正常') login_ok, SUM(pull_status='正常') pull_ok,
           SUM(pull_status='失败') pull_bad
    FROM store GROUP BY platform ORDER BY FIELD(platform,'京东','天猫','美团','拼多多')`);
  const stores = await q(`SELECT * FROM store ORDER BY customer_id, FIELD(platform,'京东','天猫','美团','拼多多')`);
  const logs = await q("SELECT * FROM sync_log ORDER BY sync_time DESC LIMIT 10");
  const skuPage = Math.max(1, Math.min(10000, parseInt(req.query.page)||1));
  const maps = await q(`
    SELECT p.id pid, p.code69, p.name, p.spec, p.sell_time_limit, p.ban_provinces,
           m.platform, m.platform_sku, m.wdt_code
    FROM sku_mapping m JOIN product p ON p.id = m.product_id
    ORDER BY p.id, FIELD(m.platform,'京东','天猫','美团','拼多多') LIMIT 100 OFFSET ${((skuPage-1)*100)}`);
  const mv = await q("SELECT * FROM metric_validity ORDER BY correlation DESC");
  const wc = await q("SELECT * FROM weight_calibration ORDER BY id");
  const rp = await q("SELECT * FROM rule_patch ORDER BY FIELD(status,'待审核','已生效'), created_at DESC");
  const platCards = platStats.map(p => {
    const bad = Number(p.pull_bad || 0);
    const pending = p.stores - p.pull_ok - bad;
    return `<div class="plat-card">
      <div class="ph">${platTag(p.platform)}${bad > 0 ? badge(`${bad} 个店铺异常`, "danger") : pending > 0 ? badge(`${pending} 个待核验`, "warn") : badge("全部正常", "ok")}</div>
      <div class="st">覆盖店铺 <b>${p.stores}</b> 个 ｜ ${p.login_ok > 0 ? `登录正常 <b>${p.login_ok}</b>` : "登录态 <b>未采集</b>"}<br>
      数据拉取正常 <b>${p.pull_ok}</b> ｜ 今日拉取 <b>${int(p.rows_total)}</b> 行</div></div>`;
  }).join("");
  const stRows = stores.map(s => [`${platTag(s.platform)}<span class="nm">${esc(s.store_name)}</span>`,
    loginBadge(s.login_status), pullBadge(s.pull_status), fmtDT(s.last_pull_at),
    `${int(s.today_rows)} ${tip("爬虫当日成功拉取并入库的行数；失败时保留手工导入通道")}`,
    s.pull_note ? `<span style="color:var(--red)">${esc(s.pull_note)}</span>` : "—",
    (s.login_status !== "正常" || s.pull_status !== "正常")
      ? `<button class="act-btn" data-api="/api/store/relogin" data-id="${s.id}">重新登录</button>` : "—"]);
  const logRows = logs.map(l => [esc(l.source), fmtDT(l.sync_time),
    badge(l.result, l.result === "成功" ? "ok" : l.result === "部分失败" ? "warn" : "danger"), int(l.rows_count), esc(l.message)]);
  const SELL_LIMITS = ["不限制", "白天", "晚上"];
  const banTags = (s) => (s || "").split(",").filter(Boolean).map(b => `<span class="tag-ban">${esc(b)}</span>`).join("") || `<span class="muted">—</span>`;
  const mapRows = maps.map(m => [esc(m.code69), `${esc(m.name)}<div class="note">${esc(m.spec || "")}</div>`,
    platTag(m.platform), esc(m.platform_sku), esc(m.wdt_code),
    `<select class="st-select" data-api="/api/product/selltime" data-id="${m.pid}">` +
      SELL_LIMITS.map(s => `<option value="${s}" ${s === (m.sell_time_limit || "不限制") ? "selected" : ""}>${s}</option>`).join("") + `</select>`,
    `<span class="ban-cell" data-pid="${m.pid}" data-ban="${esc(m.ban_provinces || "")}">
       <span class="ban-tags">${banTags(m.ban_provinces)}</span>
       <button class="ban-edit" data-pid="${m.pid}">设置</button></span>`]);
  const mvRows = mv.map(m => [esc(m.metric_name), m.correlation > 0 ? `<span style="color:#067647">+${m.correlation}</span>` : `<span style="color:var(--red)">${m.correlation}</span>`,
    badge(m.verdict, m.verdict === "有效" ? "ok" : m.verdict === "无效" ? "gray" : "danger"), esc(m.month)]);
  const wcRows = wc.map(w => [esc(w.dim_name), `${w.old_weight}%`, `${w.new_weight}%`,
    Number(w.new_weight) > Number(w.old_weight) ? `<span class="arrow">↑ +${(w.new_weight - w.old_weight).toFixed(0)}</span>` : Number(w.new_weight) < Number(w.old_weight) ? `<span style="color:var(--red);font-weight:700">↓ ${(w.new_weight - w.old_weight).toFixed(0)}</span>` : "—",
    esc(w.note)]);
  const rpRows = rp.map(r => [esc(r.scene), esc(r.patch_content), badge(r.status, r.status === "已生效" ? "ok" : "warn"), fmtDate(r.created_at)]);
  return `
    <div class="banner warn"><span>⚠️</span><div><b>各平台均未开放数据接口，当前数据全部经商家后台爬虫获取</b>（页面解析而非 API）：登录态需每日维护，平台改版会直接影响拉取，异常需人工接管。<b>旺店通 ERP 接口未开通</b>，库存、采购成本、批号效期数据目前靠手工补录——这是第一阶段要解决的第一件事。</div></div>
    <div data-tabs>
      <div class="tab-pane ${sub === "src" ? "active" : ""}" id="pane-src">
        <div class="card"><h3>平台数据源概览</h3>
          <div class="plat-overview">${platCards}</div></div>
      </div>
      <div class="tab-pane ${sub === "pull" ? "active" : ""}" id="pane-pull">
        <div class="card"><h3>店铺数据拉取状态</h3>
          ${table(["店铺", "登录状态", "数据拉取", "最近拉取时间", "今日拉取量", "异常说明", "操作"], stRows, [4])}</div>
      </div>
      <div class="tab-pane ${sub === "log" ? "active" : ""}" id="pane-log">
        <div class="card"><h3>同步日志 <span class="sub">最近 10 条</span></h3>
          ${table(["数据源", "时间", "结果", "行数", "说明"], logRows, [3])}</div>
      </div>
      <div class="tab-pane ${sub === "sku" ? "active" : ""}" id="pane-sku">
        <div class="card"><h3>商品主数据 <span class="sub">69码 → 平台 SKU → 旺店通编码，全局唯一口径；可售卖时间 / 禁售区域在列表直接维护</span></h3>
          ${table(["69码", "商品", "平台", "平台 SKU", "旺店通编码", "可售卖时间", "禁售区域（省级黑名单）"], mapRows)}
          <div class="pager"><a href="?embed=1&sub=sku&page=${Math.max(1,skuPage-1)}">上一页</a> · 第 ${skuPage} 页，每页100条 · <a href="?embed=1&sub=sku&page=${skuPage+1}">下一页</a></div>
          <p class="note" style="margin-top:8px">可售卖时间固定区间：白天 = 06:00–19:00，晚上 = 19:00–次日 06:00；设定与出单时段不符即触发开售限制预警。</p></div>
      </div>
      <div class="tab-pane ${sub === "metric" ? "active" : ""}" id="pane-metric">
        <div class="card"><h3>指标有效性诊断 <span class="sub">每月分析各指标与真实毛利的相关性，无效 / 负相关指标标记调整</span></h3>
          ${table(["指标", `与毛利相关性 ${tip("该指标与实际净毛利的皮尔逊相关系数；|r| < 0.3 判定无效，r < 0 判定负相关需反置")}`, "判定", "月份"], mvRows)}</div>
      </div>
      <div class="tab-pane ${sub === "weight" ? "active" : ""}" id="pane-weight">
        <div class="card"><h3>权重动态校准 <span class="sub">每季度回归分析输出权重优化建议，大促 / 淡季自动切换方案</span></h3>
          ${table(["维度", "原权重", "新权重", "变化", "说明"], wcRows)}</div>
      </div>
      <div class="tab-pane ${sub === "bench" ? "active" : ""}" id="pane-bench">
        <div class="card"><h3>基准值自动更新 <span class="sub">每月同步平台类目均值、竞品均值</span></h3>
          <ul class="list-plain">
            <li>类目基准未接入</li>
            <li>竞品价格基准未接入</li>
          </ul></div>
      </div>
      <div class="tab-pane ${sub === "patch" ? "active" : ""}" id="pane-patch">
        <div class="card"><h3>规则漏洞沉淀</h3>
          ${table(["漏洞场景", "补丁内容", "状态", "日期"], rpRows)}</div>
      </div>
      <div class="tab-pane ${sub === "version" ? "active" : ""}" id="pane-version">
        <div class="card"><h3>版本管理与灰度 <span class="sub">所有规则调整支持版本管理、灰度发布、一键回滚</span></h3>
          <p class="note">规则版本与灰度记录未接入。</p></div>
      </div>
    </div>
`;
}));

// ---- 4. 经营诊断（原健康度评分 + AI 诊断闭环合并）----
app.get("/diagnosis", (req, res) => page(req, res, "经营诊断", "/diagnosis", async () => {
  const sub = req.query.sub || "score";
  const scores = await q(`
    SELECT h.*, s.store_name, s.platform FROM health_score h JOIN store s ON s.id = h.store_id
    ORDER BY h.total_score DESC`);
  const defenses = await q(`SELECT d.*, s.store_name, s.platform FROM defense_trigger d JOIN store s ON s.id = d.store_id ORDER BY d.triggered_at DESC`);
  const diags = await q(`SELECT d.*, s.store_name, s.platform FROM diagnosis d JOIN store s ON s.id = d.store_id ORDER BY FIELD(d.severity,'紧急','重要','优化'), d.found_at DESC`);
  const sugs = await q(`SELECT g.*, d.problem, d.severity FROM suggestion g JOIN diagnosis d ON d.id=g.diagnosis_id ORDER BY FIELD(g.level,'紧急','重要','优化')`);
  const tasks = await q(`SELECT t.*, s.store_name, g.action FROM task t JOIN store s ON s.id = t.store_id JOIN suggestion g ON g.id = t.suggestion_id ORDER BY t.id`);
  const dims = [["trade_score", "交易表现", 25], ["product_score", "商品结构", 20], ["efficiency_score", "运营效率", 20],
    ["inventory_score", "库存健康", 15], ["aftersale_score", "售后体验", 10], ["compliance_score", "合规健康", 10]];
  const avg = scores.length ? (scores.reduce((a, s) => a + Number(s.total_score), 0) / scores.length).toFixed(1) : "—";
  const lvCount = (lv) => scores.filter(s => s.level === lv).length;
  const openTasks = tasks.filter(t => t.status === "待处理" || t.status === "处理中").length;
  /* ---- tab1 店铺健康度：排序 + 分页 ---- */
  const SORT_COLS = { store_name: "店铺", total_score: "总分", trade_score: "交易表现", product_score: "商品结构",
    efficiency_score: "运营效率", inventory_score: "库存健康", aftersale_score: "售后体验", compliance_score: "合规健康", level: "等级" };
  const sortKey = SORT_COLS[req.query.sort] ? req.query.sort : "total_score";
  const sortDir = req.query.dir === "asc" ? "asc" : "desc";
  const pageSize = [15, 30, 50].includes(parseInt(req.query.size)) ? parseInt(req.query.size) : 15;
  const pageCur = Math.max(1, parseInt(req.query.page) || 1);
  const lvRank = { "高风险": 0, "预警": 1, "良好": 2, "优秀": 3 };
  const sorted = [...scores].sort((a, b) => {
    let va, vb;
    if (sortKey === "store_name") { va = a.store_name; vb = b.store_name; }
    else if (sortKey === "level") { va = lvRank[a.level] ?? 9; vb = lvRank[b.level] ?? 9; }
    else { va = Number(a[sortKey]); vb = Number(b[sortKey]); }
    const cmp = typeof va === "string" ? va.localeCompare(vb, "zh") : va - vb;
    return sortDir === "asc" ? cmp : -cmp;
  });
  const pageTotal = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageNow = Math.min(pageCur, pageTotal);
  const pageRows = sorted.slice((pageNow - 1) * pageSize, pageNow * pageSize);
  const qs = (over) => {
    const p = new URLSearchParams({ embed: "1", sort: sortKey, dir: sortDir, size: pageSize, page: pageNow, ...(req.query.sub ? { sub: req.query.sub } : {}), ...over });
    return "?" + p.toString();
  };
  const sortTh = (key, label) => {
    const active = sortKey === key;
    const arrow = active ? (sortDir === "asc" ? " ↑" : " ↓") : " ⇅";
    const nextDir = active && sortDir === "desc" ? "asc" : "desc";
    return `<a class="sort-th${active ? " sorted" : ""}" href="${qs({ sort: key, dir: nextDir, page: 1 })}" title="点击切换排序">${label}${arrow}</a>`;
  };
  const scoreRows = pageRows.map(h => [
    `${platTag(h.platform)}<button class="link-btn" data-drill="${h.store_id}">${esc(h.store_name)}</button>`,
    `<span class="total-cell">${Number(h.total_score).toFixed(1)}</span>`,
    ...dims.map(([k]) => `<b>${Number(h[k]).toFixed(1)}</b>`),
    badge(h.level, levelBadge(h.level)),
  ]);
  const scorePager = `<div class="pager">
    <span class="pg-info">共 ${sorted.length} 个店铺 · 第 ${pageNow}/${pageTotal} 页</span>
    <label class="pg-size">每页
      <select data-page-size>
        ${[15, 30, 50].map(s => `<option value="${s}" ${s === pageSize ? "selected" : ""}>${s}</option>`).join("")}
      </select> 条</label>
    <span class="pg-btns">
      ${pageNow > 1 ? `<a class="act-btn" href="${qs({ page: pageNow - 1 })}">‹ 上一页</a>` : `<span class="act-btn" style="opacity:.4;pointer-events:none">‹ 上一页</span>`}
      ${pageNow < pageTotal ? `<a class="act-btn" href="${qs({ page: pageNow + 1 })}">下一页 ›</a>` : `<span class="act-btn" style="opacity:.4;pointer-events:none">下一页 ›</span>`}
    </span></div>`;
  const scoreHeads = [sortTh("store_name", "店铺"), sortTh("total_score", "总分"),
    ...dims.map(([k, l, w]) => sortTh(k, `${l}<br><span style="font-weight:400;font-size:10.5px">${w}%</span>`)),
    sortTh("level", "等级")];
  const lineNames = ["盈利质量熔断", "合规健康熔断", "数据真实性校验", "指标均衡制衡", "长期价值回溯"];
  const lineRows = lineNames.map(n => {
    const hit = defenses.find(d => d.line_type === n);
    const status = hit ? badge(`${hit.level} · ${esc(hit.store_name)}`, hit.level === "熔断" ? "danger" : hit.level === "警戒" ? "warn" : "info")
      : badge("未接入", "gray");
    return [n, status, hit ? esc(hit.detail) : "未接入"];
  });
  const defRows = defenses.map(d => [`${platTag(d.platform)}<span class="nm">${esc(d.store_name)}</span>`, esc(d.line_type),
    badge(d.level, d.level === "熔断" ? "danger" : "warn"), esc(d.detail), fmtDT(d.triggered_at),
    badge(d.status, d.status === "待处理" ? "warn" : "ok")]);
  /* ---- tab2 AI 诊断 ---- */
  const dRows = diags.map(d => [`${platTag(d.platform)}<span class="nm">${esc(d.store_name)}</span>`, esc(d.metric), esc(d.problem), esc(d.root_cause), badge(d.severity, sevBadge(d.severity)), badge(d.status, d.status === "待处理" ? "warn" : d.status === "已验证" ? "ok" : "info")]);
  const sRows = sugs.map(g => [badge(g.level, sevBadge(g.level)), esc(g.problem), esc(g.action), esc(g.expected_effect),
    g.status === "待处理"
      ? `<button class="act-btn primary" data-api="/api/suggestion/task" data-id="${g.id}">生成任务</button> <button class="act-btn" data-api="/api/suggestion/ignore" data-id="${g.id}" data-need="忽略理由">忽略</button>`
      : badge(g.status, g.status === "已生成任务" ? "ok" : "gray")]);
  /* ---- tab3 任务看板 ---- */
  // 任务状态机：全程可逆（含终态可重新打开）；提交/验证/驳回均需人工填写
  const taskBtns = (t) => {
    if (t.status === "待处理") return `<button class="act-btn" data-api="/api/task/status" data-id="${t.id}" data-status="处理中">开始处理</button>`;
    if (t.status === "处理中") return `<button class="act-btn" data-api="/api/task/status" data-id="${t.id}" data-status="已提交" data-need="处理说明">提交结果</button>`;
    if (t.status === "已提交") return `<button class="act-btn primary" data-api="/api/task/status" data-id="${t.id}" data-status="已验证" data-need="指标变化（人工标注）">验证通过</button> <button class="act-btn danger" data-api="/api/task/status" data-id="${t.id}" data-status="已驳回" data-need="驳回理由">驳回</button>`;
    return `<button class="act-btn" data-api="/api/task/status" data-id="${t.id}" data-status="待处理">重新打开</button> <span class="note">${t.status}${t.verified_result ? "：" + esc(t.verified_result) : ""}</span>`;
  };
  const cols = ["待处理", "处理中", "已提交", "已验证", "已驳回"];
  const kanban = cols.map(c => {
    const items = tasks.filter(t => t.status === c).map(t => `
      <div class="kb-item"><div class="t">${esc(t.action.slice(0, 26))}${t.action.length > 26 ? "…" : ""}</div>
      <div class="m">${esc(t.store_name)} ｜ ${esc(t.assignee)}（${esc(t.role)}）<br>截止 ${fmtDate(t.deadline)}${t.verified_result ? `<br><span style="color:#067647">✓ ${esc(t.verified_result)}</span>` : ""}</div>
      <div class="kb-actions">${taskBtns(t)}</div></div>`).join("");
    return `<div class="kb-col"><div class="kb-title">${c}<span class="cnt">${tasks.filter(t => t.status === c).length}</span></div>${items || '<div class="note">暂无</div>'}</div>`;
  }).join("");
  return `
    <div class="grid g4">
      <div class="kpi"><div class="l">店铺平均总分 ${tip("总分 = Σ(六个维度得分 × 权重)，满分 100；任一维度低于 60 触发降级")}</div><div class="v">${avg}</div><div class="d">共 ${scores.length} 个店铺 · 2026-09 账期</div></div>
      <div class="kpi"><div class="l">优秀 / 良好</div><div class="v">${lvCount("优秀")} / ${lvCount("良好")}</div><div class="d">健康线 75 分</div></div>
      <div class="kpi"><div class="l">预警 / 高风险</div><div class="v" style="color:var(--red)">${lvCount("预警")} / ${lvCount("高风险")}</div><div class="d">风险店铺自动置顶</div></div>
    </div>
    <div data-tabs>
      <div class="tab-pane ${sub === "score" ? "active" : ""}" id="pane-score">
        <div class="card"><h3>店铺健康度总览 <span class="sub">100 分制 · 六维加权 · 点击列表头排序 · 点击店铺名下钻至二级指标与问题商品</span></h3>
          ${table(scoreHeads, scoreRows)}
          ${scorePager}
          <div id="drillPanel"></div></div>
      </div>
      <div class="tab-pane ${sub === "defense" ? "active" : ""}" id="pane-defense">
        <div class="card"><h3>五道防歪防线状态</h3>
          ${table(["防线", "当前状态", "说明"], lineRows)}</div>
        <div class="card"><h3>分级预警图例</h3>
          <div style="display:flex;gap:18px;font-size:13px;flex-wrap:wrap;align-items:center">${badge("优秀 ≥85", "ok")} ${badge("良好 75-84", "teal")} ${badge("预警 60-74", "warn")} ${badge("高风险 <60", "danger")}
          <span class="note">下钻路径：总分 → 一级维度 → 二级指标 → 三级根因</span></div></div>
      </div>
      <div class="tab-pane ${sub === "trigger" ? "active" : ""}" id="pane-trigger">
        <div class="card"><h3>触发记录 <span class="sub">红黄蓝绿分级 · 风险店铺自动置顶</span></h3>
          ${table(["店铺", "防线", "级别", "触发详情", "时间", "状态"], defRows)}</div>
      </div>
      <div class="tab-pane ${sub === "diag" ? "active" : ""}" id="pane-diag">
        <div class="card"><h3>问题 → 诊断 → 建议 → 任务 → 验证 <span class="sub">全流程闭环</span></h3>
          <div class="flow"><span class="step">发现问题</span><span class="arr">→</span><span class="step">AI 根因诊断</span><span class="arr">→</span><span class="step">分级建议</span><span class="arr">→</span><span class="step">任务分发</span><span class="arr">→</span><span class="step">效果验证</span><span class="arr">→</span><span class="step">沉淀标准动作库</span></div>
          <p class="note" style="margin-top:8px">例：「动销率低」→ 拆解为头部品种下滑 / 新品未起量 / 长尾滞销 → 再定位到竞品降价 / 库存缺货 / 活动到期。建议不是空泛话术，每条都带动作、预期效果和优先级。</p></div>
        <div class="card"><h3>AI 诊断 <span class="sub">异常指标自动拆解多层根因</span></h3>
          ${table(["店铺", "异常指标", "问题", "根因拆解", `级别 ${tip("紧急 = 当日闭环；重要 = 3 日内；优化 = 本周内。级别由影响金额与扩散面自动判定")}`, "状态"], dRows)}</div>
      </div>
      <div class="tab-pane ${sub === "advice" ? "active" : ""}" id="pane-advice">
        <div class="card"><h3>分级建议</h3>
          ${table(["级别", "对应问题", "建议动作", "预期效果", "操作"], sRows)}</div>
      </div>
      <div class="tab-pane ${sub === "task" ? "active" : ""}" id="pane-task">
        <div class="card"><h3>任务看板</h3>
          <div class="kanban">${kanban}</div>
          <p class="note" style="margin-top:10px">状态流转：待处理 → 处理中 → 已提交 → 已验证 / 已驳回；「驳回」需填写理由。</p></div>
      </div>
    </div>
`;
}));

// ---- 5. 竞品监控 ----
app.get("/competitor", (req, res) => page(req, res, "竞品监控", "/competitor", async () => {
  const sub = req.query.sub || "price";
  const stores = await q(`SELECT * FROM store ORDER BY FIELD(platform,'京东','美团','天猫','拼多多'), store_name`);
  const cstores = await q("SELECT * FROM competitor_store ORDER BY id");
  const news = await q(`SELECT c.*, p.name, s.name cname, s.platform FROM competitor_product c JOIN product p ON p.id = c.product_id JOIN competitor_store s ON s.id = c.competitor_store_id ORDER BY c.is_new DESC, c.found_at DESC`);
  const cps = await q(`SELECT cp.*, cs.name cname, cs.platform, cs.level FROM competitor_product cp JOIN competitor_store cs ON cs.id = cp.competitor_store_id`);
  // ---- 价格雷达：本店店铺（单选） + 竞品店铺（多选，确认后刷新） ----
  const selStore = Number(req.query.sel_store) || (stores[0] && stores[0].id);
  const selCs = (req.query.sel_cs || "").split(",").filter(Boolean).map(Number);
  const curStore = stores.find(s => s.id === selStore) || stores[0] || {};
  const selCstores = cstores.filter(c => selCs.indexOf(c.id) > -1);
  const our = await q(`SELECT w.*, p.name, p.spec FROM price_watch w JOIN product p ON p.id = w.product_id
                       WHERE w.store_id = ? ORDER BY p.id`, [selStore]);
  const byProd = {};
  cps.forEach(c => { (byProd[c.product_id] = byProd[c.product_id] || {})[c.competitor_store_id] = c; });
  // 价差判定：高于本店价 10%＝预警（我方贵），3%–10%＝关注
  const gapLevel = (cpPrice, ourPrice) => {
    if (cpPrice == null || !ourPrice) return { t: "—", c: "gray" };
    const r = (Number(ourPrice) - Number(cpPrice)) / Number(cpPrice) * 100;
    if (r >= 10) return { t: "预警", c: "danger", r: r };
    if (r >= 3) return { t: "关注", c: "warn", r: r };
    return { t: "正常", c: "ok", r: r };
  };
  const priceHeads = ["商品", `本店到手价 ${tip("所选店铺含平台券、补贴后的消费者实付价；竞品价为同口径抓取值")}`]
    .concat(selCstores.map(c => `${platTag(c.platform)}${esc(c.name)}<div class="note">${esc(c.level)} · ${esc(c.platform)}</div>`));
  const priceRows = our.map(w => {
    const cells = [`${esc(w.name)}<div class="note">${esc(w.spec || "")}</div>`, `<b>¥${money2(w.our_price)}</b>`];
    selCstores.forEach(c => {
      const cp = byProd[w.product_id] && byProd[w.product_id][c.id];
      if (!cp) { cells.push('<span class="note">未抓到</span>'); return; }
      const g = gapLevel(cp.price, w.our_price);
      cells.push(`<div class="cmp-cell"><b>¥${money2(cp.price)}</b>${g.t !== "正常" && g.t !== "—" ? badge(g.t, g.c) : ""}</div>` +
        (g.r != null ? `<div class="note${g.t === "预警" ? " red" : ""}">${g.r >= 0 ? "我方高" : "我方低"} ${Math.abs(g.r).toFixed(1)}%</div>` : ""));
    });
    return cells;
  });
  const cmpBar = `<div class="cmp-bar">
      <span class="cmp-tip">比价范围：本店到手价按下列店铺取值，竞品店铺勾选后点「确认」刷新对比</span>
      <label class="cmp-lb">本店店铺
        <select id="cmpStore">${stores.map(s =>
          `<option value="${s.id}"${s.id === selStore ? " selected" : ""}>${esc(s.store_name)}（${esc(s.platform)}）</option>`).join("")}</select>
      </label>
      <div class="msel" id="cmpCs">
        <button type="button" class="msel-btn" data-msel-toggle>竞品店铺<span class="msel-v">${selCstores.length ? "已选 " + selCstores.length + " 家" : "请选择"}</span>▾</button>
        <div class="msel-panel" hidden>
          <div class="msel-list">${cstores.map(c =>
            `<label><input type="checkbox" value="${c.id}"${selCs.indexOf(c.id) > -1 ? " checked" : ""}>${platTag(c.platform)}${esc(c.name)}<span class="note">${esc(c.level)}</span></label>`).join("")}</div>
          <div class="msel-foot"><button type="button" class="act-btn" data-msel-all>全选</button>
            <button type="button" class="act-btn" data-msel-none>清空</button>
            <span class="sp"></span>
            <button type="button" class="act-btn primary" data-msel-ok>确认</button></div>
        </div>
      </div>
    </div>`;
  const nRows = news.map(n => [esc(n.name), `${platTag(n.platform)}${esc(n.cname)}`, money2(n.price), fmtDate(n.found_at),
    n.is_new ? badge("新品", "danger") : badge("在售", "gray")]);
  return `
    <div data-tabs>
      <div class="tab-pane ${sub === "price" ? "active" : ""}" id="pane-cmp-price">
    <div class="card no-clip"><h3>价格雷达 <span class="sub">本店到手价与竞品到手价逐店并排对比，异动自动预警</span></h3>
      ${cmpBar}
      ${selCstores.length
        ? table(priceHeads, priceRows, priceHeads.map((_, i) => i).slice(1))
        : '<div class="empty-tip">未接入</div>'}
      <p class="note" style="margin-top:8px">本店到手价取自 <b>${esc(curStore.store_name || "—")}（${esc(curStore.platform || "—")}）</b>；
        价差 ≥ 10% 判预警、3%–10% 判关注，预警直接标在对应竞品店铺列上。</p></div>
      </div>
      <div class="tab-pane ${sub === "new" ? "active" : ""}" id="pane-cmp-new">
    <div class="card"><h3>竞品新品监控 <span class="sub">头部竞品店铺 / 平台类目自动识别新上架商品</span></h3>
      <div class="banner info"><span>💡</span><div><b>「品种推荐」已并入本视图</b>：下列竞品新品即「竞品有、我无」的推荐品种，建议关注并评估是否上架，无需再单独维护一套推荐引擎。</div></div>
      ${table(["商品", "竞品店铺", "竞品价", "发现日期", "标记"], nRows, [2, 3])}</div>
      </div>
    </div>
`;
}));

// ---- 6. 库存管理 ----
app.get("/inventory", (req, res) => page(req, res, "库存管理", "/inventory", async () => {
  const sub = req.query.sub || "inv";
  const platformStock = await pool.query(`SELECT s.店铺, p.平台, p.平台商品ID, p.平台规格ID,
    p.平台商品名称, p.平台库存, p.平台售价, p.数据日期 FROM ec_dw.dim_product_platform p
    JOIN ec_dw.dim_store s ON s.店铺编码=p.店铺编码
    ORDER BY p.平台,p.店铺编码,p.平台商品ID,p.平台规格ID LIMIT 200`);
  const stockCard = `<div class="card"><h3>平台实时库存 <span class="sub">最多展示200条 · 不含仓库批号与效期</span></h3>${table(['店铺','平台','商品','平台商品ID','平台规格ID','库存','售价','数据日期'],platformStock[0].map(r=>[esc(r.店铺),esc(r.平台),esc(r.平台商品名称),esc(r.平台商品ID),esc(r.平台规格ID),int(r.平台库存),money2(r.平台售价),fmtDate(r.数据日期)]),[5,6])}</div>`;
  const inv = await q(`SELECT i.*, p.name, p.spec, w.name wname FROM inventory i JOIN product p ON p.id = i.product_id JOIN warehouse w ON w.id = i.warehouse_id ORDER BY p.id, w.id`);
  const adv = await q(`SELECT r.*, p.name FROM replenish_advice r JOIN product p ON p.id = r.product_id ORDER BY FIELD(r.status,'待确认','已确认')`);
  const now = new Date();
  // 无效期（NULL）不计入近效期：daysBetween 会把 null 当成 1970 年。
  const soon = inv.filter(i => i.expiry_date && daysBetween(now, i.expiry_date) <= 60);
  // 滞销判定改用 ERP 近 30 天净销量为 0 且有在库量，不再用固定商品。
  const slow = inv.filter(i => Number(i.net_sales_30) === 0 && Number(i.qty) > 0)
    .sort((a, b) => b.qty - a.qty).slice(0, 20);
  const invRows = inv.map(i => [`${esc(i.name)}<div class="note">${esc(i.spec || "")}</div>`, esc(i.wname), esc(i.batch_no || "—"),
    fmtDate(i.expiry_date), int(i.qty), int(i.locked_qty), `<b>${int(i.qty - i.locked_qty)}</b>`]);
  const advRows = adv.map(a => [esc(a.name), int(a.advice_qty), fmtDate(a.advice_date), esc(a.reason),
    `<select class="st-select" data-api="/api/replenish/status" data-id="${a.id}" data-need-qty-for="已调整">` +
      RP_STATUS.map(s => `<option value="${s}" ${s === a.status ? "selected" : ""}>${s}</option>`).join("") + "</select>"]);
  const soonRows = soon.map(i => {
    const left = daysBetween(now, i.expiry_date);
    return [`${esc(i.name)}（${esc(i.wname)}）`, esc(i.batch_no || "—"), fmtDate(i.expiry_date),
      `<b>${left} 天</b>`, int(i.qty), left <= 30 ? "优先促销 / 捆绑销售" : "正常周转"];
  });
  const slowRows = slow.map(i => [`${esc(i.name)}（${esc(i.wname)}）`, int(i.qty), "近 30 天无动销", "建议清仓专区 / 下架评估"]);
  const kpi = { sku: new Set(inv.map(i => i.product_id)).size, soon: soon.length, low: adv.filter(a => a.status === "待确认").length,
    wh: new Set(inv.map(i => i.warehouse_id)).size };
  const expDates = inv.map(i => i.expiry_date).filter(Boolean).sort();
  const latestStockDate = expDates.length ? expDates[expDates.length - 1] : null;
  return `
    <div class="grid g3">
      <div class="kpi"><div class="l">在库品种数</div><div class="v">${kpi.sku}</div><div class="d">${kpi.wh} 个仓库 · 库存取各仓库最新记录日</div></div>
      <div class="kpi"><div class="l">近效期品种（60 天内）</div><div class="v">${kpi.soon}</div><div class="d">${inv.length ? `按已采集有效期判定${latestStockDate ? `（最晚效期 ${fmtDate(latestStockDate)}）` : ""}` : "效期数据未接入"}</div></div>
      <div class="kpi"><div class="l">待确认补货</div><div class="v">${kpi.low}</div><div class="d">缺采购周期与安全库存参数，暂不生成建议</div></div>
    </div>
    <div data-tabs>
      <div class="tab-pane ${sub === "inv" ? "active" : ""}" id="pane-inv">${stockCard}<div class="card"><h3>实时库存</h3>
        ${table(["商品", "仓库", "批号", "效期", `库存 ${tip("当前实物在库数量，含已锁定")}`, `锁定 ${tip("已生成订单但未出库的数量")}`, `可用 ${tip("可用 = 库存 − 锁定，即还能卖的数量")}`], invRows, [4, 5, 6])}</div></div>
      <div class="tab-pane ${sub === "adv" ? "active" : ""}" id="pane-adv"><div class="card"><h3>智能补货建议 <span class="sub">自动计算补货量与补货时间</span></h3>
        ${table(["商品", `建议补货量 ${tip("按近 30 天日均销量 × 采购周期 + 安全库存 − 可用库存 计算")}`, "建议日期", "依据", "状态"], advRows, [1])}</div></div>
      <div class="tab-pane ${sub === "exp" ? "active" : ""}" id="pane-exp"><div class="card"><h3>效期预警 <span class="sub">近效期药品自动预警，结合销量给处理建议</span></h3>
        ${table(["商品（仓库）", "批号", "效期", "剩余", "数量", "处理建议"], soonRows, [3, 4])}</div></div>
      <div class="tab-pane ${sub === "slow" ? "active" : ""}" id="pane-slow"><div class="card"><h3>滞销库存预警 <span class="sub">长周期无动销商品自动标记</span></h3>
        ${table(["商品（仓库）", "数量", "判定", "建议"], slowRows, [1])}</div></div>
      </div>
      <div class="tab-pane ${sub === "actstock" ? "active" : ""}" id="pane-actstock">
    <div class="card"><h3>活动库存校验 <span class="sub">报名前自动校验库存支撑，活动中实时监控消耗</span></h3>
      <ul class="list-plain">
        <li>美团神券节：替尔泊肽消耗速度 42 支/日，可用库存仅支撑 7 天，已触发补货建议</li>
        <li>拼多多百亿补贴：3 个品种可报名，其中 1 个库存不足，系统已自动从报名清单剔除</li>
      </ul></div>
      </div>
    </div>
`;
}));

// ---- 7. 活动管理 ----
app.get("/activity", (req, res) => page(req, res, "活动管理", "/activity", async () => {
  const sub = req.query.sub || "calc";
  const act = require("./activity-calc");
  const PLATS = ["美团", "京东", "天猫", "拼多多"];
  const platform = PLATS.includes(req.query.act_platform) ? req.query.act_platform : "美团";
  const list = await act.stores(pool, platform);
  const client = list.some(s => s.client === req.query.act_store) ? req.query.act_store : (list[0] ? list[0].client : null);
  const mode = req.query.act_mode === "rough" ? "rough" : "precise";
  const data = sub === "calc" && client ? await act.load(pool, { client, platform, date: req.query.act_date }) : null;

  const n2 = (v) => v == null ? '<span class="muted">—</span>' : Number(v).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const signed = (v) => v == null ? '<span class="muted">—</span>' : `<b style="color:${v < 0 ? "var(--red)" : "var(--primary-2)"}">${Number(v).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>`;
  const kchip = (label, val, cls) => `<div class="chip ${cls || ""}"><span class="l">${label}</span><span class="v">${val}</span></div>`;
  const pctOf = (v) => v == null ? "—" : `${(Number(v) * 100).toFixed(2)}%`;
  const embedQ = req.query.embed === "1" ? "&embed=1" : "";
  const f2 = (v) => Number(v).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const rateTxt = (v) => v == null ? "缺费率" : `${(Number(v) * 100).toFixed(2)}%`;
  const coRow = (label, expr, val, cls) => `<div class="co ${cls || ""}"><span>${label}${expr ? `<em>${expr}</em>` : ""}</span><b>${val}</b></div>`;
  const detailHref = (x) => `/activity?sub=calc&act_mode=precise&act_platform=${encodeURIComponent(platform)}&act_store=${encodeURIComponent(client)}&act_detail=${encodeURIComponent(x.code + "|" + (x.activity || ""))}${embedQ}`;

  const productSearch = String(req.query.act_search || '').trim().slice(0,100);
  const matchesProduct = r => !productSearch || [r.name,r.code].some(v => String(v || '').toLocaleLowerCase().includes(productSearch.toLocaleLowerCase()));
  const filterBar = `<div class="act-filter">
    <label>平台<select id="actPlatform">${PLATS.map(p => `<option value="${p}" ${p === platform ? "selected" : ""}>${p}</option>`).join("")}</select></label>
    <label>店铺<select id="actStore">${list.length ? list.map(s => `<option value="${esc(s.client)}" ${s.client === client ? "selected" : ""}>${esc(s.client)}</option>`).join("") : '<option value="">该平台无可核算店铺</option>'}</select></label>
    <label>口径<select id="actMode"><option value="precise" ${mode === "precise" ? "selected" : ""}>精算</option><option value="rough" ${mode === "rough" ? "selected" : ""}>粗算</option></select></label>
    <form class="act-product-search" action="/activity" method="get">
      ${Object.entries(req.query).filter(([key,value]) => !['act_search','act_page','act_detail','sub'].includes(key) && typeof value === 'string').map(([key,value]) => `<input type="hidden" name="${esc(key)}" value="${esc(value)}">`).join('')}
      <input type="hidden" name="sub" value="calc">
      <label>商品搜索<input type="search" name="act_search" value="${esc(productSearch)}" placeholder="商品名称 / 编码" maxlength="100"></label><button type="submit" class="act-btn">搜索</button>
    </form>
  </div>`;

  let listRows = [];
  if (sub === "list" && client) {
    const [rows] = await pool.query(
      `SELECT 活动名称 activity, COUNT(DISTINCT 商品编码) products, MIN(门槛价格) minp, MAX(门槛价格) maxp,
              MAX(修改日期) seen, MAX(活动开始时间) starts, MAX(活动结束时间) ends
         FROM ec_dw.subsidy WHERE 客户 = ? AND 平台 = ? AND 门槛价格 > 0
        GROUP BY 活动名称 ORDER BY products DESC LIMIT 200`, [client, platform]);
    listRows = rows;
  }

  const listPane = `<div class="card"><h3>活动列表 <span class="sub">ec_dw.subsidy 中带门槛价的活动的目录</span></h3>
    ${listRows.length
      ? table(["平台", "活动", "商品数", "门槛价区间", "开始", "结束", "最近采集"],
        listRows.map(a => [platTag(platform), esc(a.activity || "（空名称）"), int(a.products),
          `${money2(a.minp)} ~ ${money2(a.maxp)}`, fmtDT(a.starts), fmtDT(a.ends), fmtDate(a.seen)]), [2])
      : '<div class="empty-tip">该店铺在该平台没有带门槛价的补贴记录</div>'}
    <p class="note">报名与活动状态未接（平台后台未提供逐活动报名结果），本页只列已采集到的活动与门槛价。</p></div>`;

  const reviewPane = `<div class="card"><h3>活动复盘 <span class="sub">活动结束后的投入产出核算与经验沉淀</span></h3>
    <div class="banner warn"><span>⚠️</span><div><b>无数据源</b>：活动结束后的成交、退款、增量毛利都没有单独落表，复盘所需的「活动期 vs 基线期」对比无法计算，本页不生成估算值。</div></div></div>`;

  const simPane = `<div class="card"><h3>活动前测算 <span class="sub">手工填参数试算，不读数据库</span></h3>
    <div class="calc">
      <div class="calc-inputs">
        <label>药品采购成本（元）<input type="number" id="ci-purchase" step="0.01"></label>
        <label>快递成本（元）<input type="number" id="ci-express" step="0.01"></label>
        <label>商品定价（元）<input type="number" id="ci-price" step="0.01"></label>
        <label>物流配送费（元）<input type="number" id="ci-logistics" step="0.01"></label>
        <label>平台补贴价（元）<input type="number" id="ci-subsidy" step="0.01"></label>
        <label>技术服务费率（%）<input type="number" id="ci-rate" step="0.1"></label>
        <label>底价红线（元）<input type="number" id="ci-floor" step="0.01"></label>
        <label>预计销量（件）<input type="number" id="ci-qty" step="1"></label>
      </div>
      <div class="calc-outputs" id="calcOut"></div>
    </div></div>`;

  const noData = !data || !data.kpis || !data.kpis.products;
  const pageSize = 20;
  const pageNo = Math.max(1, Math.round(Number(req.query.act_page) || 1));
  const baseQ = `sub=calc&act_mode=${mode}&act_platform=${encodeURIComponent(platform)}&act_store=${encodeURIComponent(client || "")}${embedQ}`;
  const pagerHtml = (page, pages, total) => `<div class="pager">
      <a class="act-btn" href="/activity?${baseQ}&act_page=${page - 1}"${page <= 1 ? ' style="pointer-events:none;opacity:.45"' : ""}>上一页</a>
      <span>第 ${page} / ${pages} 页 · 共 ${total} 条 · 每页 ${pageSize} 条</span>
      <a class="act-btn" href="/activity?${baseQ}&act_page=${page + 1}"${page >= pages ? ' style="pointer-events:none;opacity:.45"' : ""}>下一页</a>
    </div>`;
  let calcPane;
  if (noData) {
    const why = !client
      ? `「${platform}」在 ec_dw.subsidy 里没有带客户与门槛价的补贴记录（京东、天猫的补贴目录按平台维度采集，客户为空），无法按店铺核算。`
      : `「${esc(client)} · ${esc(platform)}」在 ${fmtDate(data && data.day)} 没有门槛价 &gt; 0 的补贴记录，无法核算。`;
    calcPane = `<div class="card"><h3>活动核算明细</h3>${filterBar}
      <div class="banner warn"><span>⚠️</span><div><b>无可用数据</b>：${why}</div></div>
      <p class="note">精算需要的字段：门槛价格、门槛盒数、商家承担、补贴金额（ec_dw.subsidy），成本价（ec_dw.input_cost），订购盒数 / 出现概率 / 订单平均运费（ec_dw.input_freight），平台扣点 / 利润点 / 代运营费率（ec_dw.merchant_profit_setting）。</p></div>`;
  } else if (mode === "rough") {
    const k = data.kpis;
    const rows = data.rough.filter(matchesProduct).sort((a, b) => (a.gross == null ? 1 : 0) - (b.gross == null ? 1 : 0) || (b.gross || 0) - (a.gross || 0));
    const okRough = rows.filter(r => r.gross != null);
    const roughTotal = okRough.reduce((a, r) => a + r.gross, 0);
    const pages = Math.max(1, Math.ceil(rows.length / pageSize));
    const cur = Math.min(pageNo, pages);
    const pageRows = rows.slice((cur - 1) * pageSize, cur * pageSize);
    const card = (r) => `<article class="act-item act-compact">
      <div class="act-id">
        <span class="code">69码 ${esc(r.code || "")}</span>
        <span class="pname">${esc(r.name || "")}</span>
        <span class="note">${esc(r.activity || "（空名称）")}</span>
        <span class="minp">红线价 <b>${r.redline == null ? "—" : "¥" + n2(r.redline)}</b></span>
      </div>
      <div class="act-calc">
        ${kchip("门槛价", n2(r.price))}
        ${kchip("当前售价", n2(r.salePrice))}
        ${kchip("药品成本", r.drug == null ? "缺成本价" : n2(r.drug))}
        ${kchip(r.cold > 0 ? "固定运费 · 冷链" : "固定运费", n2(r.freight))}
        ${kchip("总成本", r.totalCost == null ? "—" : n2(r.totalCost))}
        ${kchip("平台扣点金额", n2(k.rates ? r.price * k.rates.fee : null))}
        ${kchip("利润点金额", n2(k.rates ? r.price * k.rates.profit : null))}
        ${kchip("代运营费金额", n2(k.rates ? r.price * k.rates.agency : null))}
        ${kchip("费用合计", n2(r.rateSum == null ? null : r.price * r.rateSum))}
        ${kchip("红线价", r.redline == null ? "—" : n2(r.redline))}
        ${kchip("毛利", r.gross == null ? "—" : n2(r.gross), r.gross == null ? "" : (r.gross < 0 ? "loss" : "profit"))}
        ${kchip("毛利率", r.margin == null ? "—" : `${r.margin.toFixed(2)}%`)}
      </div>
    </article>`;
    calcPane = `<div class="card"><h3>活动核算明细 · 粗算 <span class="sub">${esc(client)} · ${esc(platform)} · ${fmtDate(data.day)}</span></h3>${filterBar}
      <div class="act-kpis">
        ${kchip("商品 × 活动", int(k.products))}
        ${kchip("可算毛利", `${int(okRough.length)} / ${int(k.products)}`)}
        ${kchip("毛利合计", okRough.length ? `¥${n2(roughTotal)}` : "—")}
        ${kchip("正毛利", int(okRough.filter(r => r.gross > 0).length))}
        ${kchip("负毛利", int(okRough.filter(r => r.gross < 0).length), okRough.some(r => r.gross < 0) ? "loss" : "")}
      </div>
      <p class="note"><b>粗算口径</b>：按单盒计算，不依赖运费档位或出现概率。平台扣点、利润点、代运营费显示金额（单盒门槛价 × 对应费率，单位元）。总成本 = 单盒药品成本+ 固定运费（普通 3.00 元，品名含 替尔泊肽/瑞佰安/诺和盈/诺和泰 的冷链类 20.00 元）；红线价 = 总成本 ÷（1 − 平台扣点 − 代运营 − 利润点）；毛利 = 单盒门槛价 − 红线价。红线价是保本售价：按费率合计的净率把成本还原到含费售价。不含包装、损耗、买家邮费、多盒承担，也不按档位概率加权。</p>
      ${pageRows.map(card).join("")}
      ${pagerHtml(cur, pages, rows.length)}
      <p class="note">负毛利 ${int(okRough.filter(r => r.gross < 0).length)} 个，主因是门槛价低于成本：${int(k.products)} 个「商品 × 活动」里 ${int(k.belowCost)} 个门槛价已低于单盒成本价，不是算错。</p>
    </div>`;
  } else {
    const k = data.kpis;
    const rl = k.rates;
    const sumRows = data.summary.filter(matchesProduct).sort((a, b) => (a.grossValue == null ? 1 : 0) - (b.grossValue == null ? 1 : 0) || (b.grossValue || 0) - (a.grossValue || 0));
    const tierRows = data.tiers.slice().sort((a, b) => (a.gross == null ? 1 : 0) - (b.gross == null ? 1 : 0) || (b.gross || 0) - (a.gross || 0));
    const pickKey = req.query.act_detail || null;
    const sameKey = (a, b) => !!a && !!b && a.code === b.code && (a.activity || "") === (b.activity || "");
    const picked = (pickKey && sumRows.find(x => (x.code + "|" + (x.activity || "")) === pickKey))
      || sumRows.find(x => x.grossValue != null) || sumRows[0] || null;
    const pickTiers = picked
      ? data.tiers.filter(t => t.boxes != null && t.code === picked.code && (t.activity || "") === (picked.activity || ""))
          .sort((a, b) => a.boxes - b.boxes)
      : [];
    const tierTable = (tiers) => `<div class="act-tbl">${table(["商品", "活动", "当前售价", "门槛价", "盒数", "概率", "销售额", "药品成本", "技术服务费", "冷链费", "包装费", "损耗", "买家邮费", "平均运费", "多盒承担", "利润点", "代运营", "档位毛利", "毛利期望值"],
      tiers.map(t => [
        `${esc(t.name || t.code)}<div class="note">${esc(t.code || "")}${t.missing.length ? " · " + esc(t.missing.join("、")) : ""}</div>`,
        `${esc(t.activity || "（空名称）")}<div class="note">${esc(t.actType || t.play)}</div>`,
        n2(t.salePrice), n2(t.price), t.boxes == null ? '—' : int(t.boxes), pctOf(t.prob),
        n2(t.sales), n2(t.cost), n2(t.tech), n2(t.cold), n2(t.pack), n2(t.loss), n2(t.postage),
        n2(t.avgFreight), n2(t.multi), n2(t.profitPoint), n2(t.agency), signed(t.gross), signed(t.expect)]),
      [2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18])}</div>`;
    const chartId = s => 'act-profit-' + sumRows.indexOf(s);
    const expectedMetric = (s, field) => {
      const valid = data.tiers.filter(t => t.boxes != null && sameKey(t, s) && t.gross != null);
      return !valid.length || valid.some(t => t[field] == null || t.prob == null) ? null
        : valid.reduce((sum, t) => sum + Number(t[field]) * Number(t.prob), 0);
    };
    const itemCards = (s, sel) => `<article class="act-item act-compact" id="${chartId(s)}">
      <div class="act-id">
        <span class="code">69码 ${esc(s.code || "")}</span>
        <span class="pname" title="${esc(s.name || "")}">${esc(s.name || "")}</span>
        <span class="note">${esc(s.activity || "（空名称）")}${s.actType ? " · " + esc(s.actType) : ""}</span>
        <span class="minp">门槛价 <b>¥${n2(s.price)}</b></span>
      </div>
      <div class="act-calc" title="费用与金额按有效档位的出现概率加权，与当前毛利值采用同一口径；各档位见详细计算">
        ${kchip("药品成本期望", n2(expectedMetric(s, "cost")))}
        ${kchip("运费期望", n2(expectedMetric(s, "avgFreight")))}
        ${kchip("销售额期望", n2(expectedMetric(s, "sales")))}
        ${kchip("当前售价", n2(s.salePrice))}
        ${kchip("单盒成本", s.unitCost == null ? "缺成本价" : n2(s.unitCost))}
        ${kchip("商家承担期望", n2(expectedMetric(s, "multi")))}
        ${kchip("服务费期望", n2(expectedMetric(s, "tech")))}
        ${kchip("冷链费期望", n2(expectedMetric(s, "cold")))}
        ${kchip("包装费期望", n2(expectedMetric(s, "pack")))}
        ${kchip("买家实付期望", n2(expectedMetric(s, "buyer")))}
        ${kchip("邮费期望", n2(expectedMetric(s, "postage")))}
        ${kchip("利润点期望", n2(expectedMetric(s, "profitPoint")))}
        ${kchip("代运营费期望", n2(expectedMetric(s, "agency")))}
        ${kchip("损耗期望", n2(expectedMetric(s, "loss")))}
        ${kchip("毛利期望", s.grossValue == null ? "不可算" : n2(s.grossValue), s.grossValue == null ? "" : (s.grossValue < 0 ? "loss" : "profit"))}
        ${kchip("有效档位 / 概率", `${int(s.tierCount)} 档 / ${pctOf(s.probSum)}`)}
      </div>
      <details class="act-product-detail"${pickKey && sel ? " open" : ""}>
        <summary class="act-btn">详细计算</summary>
        <div class="act-product-detail-body">
        <p class="note" style="margin:0 0 8px">按 ec_dw.input_freight 的每个订购盒数档位逐项列出取数与算式。<b>毛利值 = Σ(档位毛利 × 出现概率) = ${signed(s.grossValue)}</b>，已算 ${int(s.tierCount)} 个档位、概率合计 ${pctOf(s.probSum)}。</p>
        ${data.tiers.some(t => t.boxes != null && sameKey(t, s)) ? tierTable(data.tiers.filter(t => t.boxes != null && sameKey(t, s)).sort((a, b) => a.boxes - b.boxes)) : '<div class="banner warn"><span>⚠️</span><div><b>无运费档位</b>：ec_dw.input_freight 里没有该货品的档位记录，逐项计算做不了。</div></div>'}
        </div>
      </details>
    </article>`;
    const pages = Math.max(1, Math.ceil(sumRows.length / pageSize));
    const cur = Math.min(pageNo, pages);
    const pageRows = sumRows.slice((cur - 1) * pageSize, cur * pageSize);
    const pickedOnPage = picked ? pageRows.some(s => sameKey(s, picked)) : false;
    calcPane = `<div class="card"><h3>活动核算明细 · 精算 <span class="sub">${esc(client)} · ${esc(platform)} · ${fmtDate(data.day)}</span></h3>${filterBar}
      <div class="act-kpis">
        ${kchip("商品 × 活动", int(k.products))}
        ${kchip("档位行", int(k.tierRows))}
        ${kchip("可算毛利", `${int(k.computable)} / ${int(k.products)}`)}
        ${kchip("毛利值合计", k.grossTotal == null ? "—" : `¥${n2(k.grossTotal)}`)}
        ${kchip("正毛利", int(data.summary.filter(s => s.grossValue != null && s.grossValue > 0).length))}
        ${kchip("负毛利", int(k.negative), k.negative ? "loss" : "")}
        ${kchip("门槛价低于成本", int(k.belowCost), k.belowCost ? "loss" : "")}
        ${kchip("缺成本价", int(k.costMissing), k.costMissing ? "loss" : "")}
        ${kchip("缺运费档", int(k.freightMissing), k.freightMissing ? "loss" : "")}
      </div>
      ${k.rateMissing ? `<div class="banner warn"><span>⚠️</span><div><b>缺费率设置</b>：ec_dw.merchant_profit_setting 里没有「${esc(client)} · ${esc(platform)}」在 ${fmtDate(data.day)} 生效的记录，技术服务费、利润点、代运营费无法计算，毛利留空。</div></div>` : ""}
      ${(k.computable === 0 && (k.costMissing || k.freightMissing)) ? `<div class="banner warn"><span>⚠️</span><div><b>缺成本 / 运费数据</b>：ec_dw.input_cost 缺 ${int(k.costMissing)} 项、ec_dw.input_freight 缺 ${int(k.freightMissing)} 项（目前只有「保民」维护了成本与运费档位），该店铺算不出毛利，不做零填充。</div></div>` : ""}
      <p class="note"><b>展示口径</b>：期望金额按有效档位的出现概率加权，当前售价与单盒成本为原值；逐档金额见「详细计算」。<br><b>门槛价格</b>取 ec_dw.subsidy 的「补贴门槛」，是平台要求降到该价才给补贴的目标到手价，不是当前售价。${rl ? `费率取 merchant_profit_setting（生效日 ${fmtDate(rl.since)}）：平台扣点 ${(rl.fee * 100).toFixed(2)}%、利润点 ${(rl.profit * 100).toFixed(2)}%、代运营 ${(rl.agency * 100).toFixed(2)}%。` : ""}</p>
      ${productSearch ? `<p class="note">搜索「${esc(productSearch)}」匹配 ${sumRows.length} 条；毛利从高到低排列。顶部统计为当前客户与平台的全部活动。</p>` : ""}
      ${pageRows.map(s => itemCards(s, sameKey(s, picked))).join("")}
      ${pagerHtml(cur, pages, sumRows.length)}
      <p class="note"><b>精算口径</b>：档位毛利 = 销售额 − 技术服务费 − 冷链费 − 包装费 − 0.1（损耗） + 买家支付邮费 − 订单平均运费 − 多盒承担 − 订单药品成本 − 利润点 − 代运营费。销售额 = 门槛价格 × 订购盒数；技术服务费 =（销售额 − 多盒承担）× 平台扣点；多盒承担 = FLOOR(盒数 / 门槛盒数) × 门槛盒数 × 商家承担；包装费 = 盒数 ≤ 4 取 0.33，否则 0.60；冷链费 = 品名含 替尔泊肽/瑞佰安/诺和盈/诺和泰 取 4.70；买家邮费 = 买家实付 ≥ 29 取 0.12，否则 3.12；利润点与代运营费 =（销售额 − 多盒承担）× 对应费率。出现概率取 ec_dw.input_freight 各订购盒数档位的订单占比（0~1）。</p></div>`;
  }

  return `
    <div data-tabs>
      <div class="tab-pane ${sub === "list" ? "active" : ""}" id="pane-act-list">${listPane}</div>
      <div class="tab-pane ${sub === "calc" ? "active" : ""}" id="pane-act-calc">${calcPane}</div>
      <div class="tab-pane ${sub === "sim" ? "active" : ""}" id="pane-act-sim">${simPane}</div>
      <div class="tab-pane ${sub === "review" ? "active" : ""}" id="pane-act-review">${reviewPane}</div>
    </div>
`;
}));

// ---- 8. 合规风控 ----
app.get("/compliance", (req, res) => page(req, res, "风控中心", "/compliance", async () => {
  const sub = req.query.sub || "refund";
  // 风控中心只有「售后自动退款预警」有数仓来源。
  // 合规校验 / 今日巡检 / 医生开方监控 原先读原型库 ec_mid 的演示数据（compliance_check、patrol_report、
  // doctor_sla、sell_time_violation），这些表不属于数仓也无人维护，此处不再读取，直接报错。
  if (sub !== "refund") {
    res.status(500);
    const name = ({ check: "合规校验", patrol: "今日巡检", doctor: "医生开方监控" })[sub] || sub;
    return `<div class="banner warn"><span>⚠️</span><div><b>「${esc(name)}」无数据源，页面不可用。</b><br>
      该子页原先展示的是原型库 ec_mid 的演示数据（compliance_check / patrol_report / doctor_sla / sell_time_violation），不属于数仓，已停止读取，本页不再提供伪造数据。<br>
      风控中心当前可用的只有「售后自动退款预警」：读 ec_dw 的 aftersale_case、aftersale_node、aftersale_status_snapshot 三张表。</div></div>`;
  }
  // ---- 售后：直接读 ec_dw 的售后单 / 售后节点 / 售后汇总快照 ----
  // 这三张表走 qx（不过 prepare 适配层），因为 prepare 会把表名改写成已不存在的 dim_/fact_ 模型。
  const afPlat = ["全部", "美团", "京东", "天猫"].includes(req.query.af_platform) ? req.query.af_platform : "全部";
  const afPlatSql = afPlat === "全部" ? "" : " AND c.平台=?";
  const afSnap = await qx(`SELECT s.客户, s.平台, s.日期, s.待商家审核数量, s.即将自动退售后单, s.退款处理时长, s.时长单位, (s.日期=CURDATE()) snapshotToday
    FROM ec_dw.aftersale_status_snapshot s
    WHERE s.日期 = (SELECT MAX(x.日期) FROM ec_dw.aftersale_status_snapshot x WHERE x.客户 = s.客户 AND x.平台 = s.平台)
    ORDER BY s.日期 DESC, s.即将自动退售后单 DESC, s.待商家审核数量 DESC, s.客户, s.平台`);
  // Only pending merchant review and an explicit platform deadline qualify.
  const deadlineCounts=await qx(`WITH latest AS (
    SELECT c.*,ROW_NUMBER() OVER (PARTITION BY 客户,平台,售后单号 ORDER BY 修改日期 DESC,日期 DESC,店铺) rn
    FROM ec_dw.aftersale_case c WHERE 平台='美团')
    SELECT 客户,平台,
      SUM(售后状态 REGEXP '(^|[,，])待商家审核$') pending,
      SUM(售后状态 REGEXP '(^|[,，])待商家审核$' AND 自动退款截止时间 IS NULL) missing,
      SUM(售后状态 REGEXP '(^|[,，])待商家审核$' AND 自动退款截止时间>NOW() AND 自动退款截止时间<=DATE_ADD(NOW(),INTERVAL 12 HOUR)) imminent
    FROM latest WHERE rn=1 GROUP BY 客户,平台`);
  const deadlineMap=new Map(deadlineCounts.map(r=>[r.客户+'|'+r.平台,r]));
  afSnap.forEach(s=>{
    const count=deadlineMap.get(s.客户+'|'+s.平台);
    s.即将自动退售后单=s.平台==='美团' && Number(s.snapshotToday)===1 && count && !Number(count.missing) && s.待商家审核数量!=null && Number(count.pending)===Number(s.待商家审核数量) ? Number(count.imminent||0) : null;
  });
  afSnap.sort((a,b)=>String(b.日期).localeCompare(String(a.日期)) || (b.即将自动退售后单??-1)-(a.即将自动退售后单??-1) || (b.待商家审核数量??-1)-(a.待商家审核数量??-1));
  const afTotal = Number((await qx(`SELECT COUNT(*) n FROM ec_dw.aftersale_case`))[0].n) || 0;
  const afCases = await qx(`SELECT * FROM (
      SELECT c.客户, c.平台, c.店铺, c.售后单号, c.订单号, c.售后状态, c.售后类型, c.退款金额, c.申请原因, c.申请时间, c.自动退款截止时间, TIMESTAMPDIFF(SECOND,NOW(),c.自动退款截止时间) refundSeconds,
             ROW_NUMBER() OVER (PARTITION BY c.平台, c.售后单号 ORDER BY c.修改日期 DESC, c.日期 DESC, c.店铺) rn
      FROM ec_dw.aftersale_case c
      WHERE c.申请时间 IS NOT NULL${afPlatSql}
    ) t WHERE t.rn = 1
    ORDER BY CASE WHEN t.售后状态 REGEXP '待|审核中|拦截中'
                    AND t.售后状态 NOT REGEXP '退款成功|完成|驳回|不通过|失败|取消|关闭' THEN 0 ELSE 1 END,
             t.申请时间 DESC
    LIMIT 120`, afPlat === "全部" ? [] : [afPlat]);
  const afNodeTotal = Number((await qx(`SELECT COUNT(*) n FROM ec_dw.aftersale_node`))[0].n) || 0;
  const afNodes = await qx(`SELECT 平台, 店铺, 售后单号, 节点主体, 节点操作, 节点时间
    FROM ec_dw.aftersale_node ORDER BY 节点时间 DESC LIMIT 60`);
  const dtOr = (v) => v ? fmtDT(v) : "—";
  const dOr = (v) => v ? fmtDate(v) : "—";
  const clean = (v) => String(v == null ? "" : v).replace(/<br\s*\/?>/gi, " / ").replace(/\s+/g, " ").trim();
  const afTone = (s) => /退款成功|完成/.test(s) ? "ok" : /驳回|不通过|失败|取消|关闭/.test(s) ? "gray" : /待|审核中|拦截中/.test(s) ? "warn" : "info";
  const embedQ = req.query.embed === "1" ? "&embed=1" : "";
  const num0 = (v) => v == null ? "—" : int(v);
  const afPlatBar = `<div class="seg af-filter">${["全部", "美团", "京东", "天猫"].map(p => `<a class="seg-btn ${p === afPlat ? "active" : ""}" href="/compliance?sub=refund&af_platform=${encodeURIComponent(p)}${embedQ}">${p}</a>`).join("")}</div>`;
  const afSnapRows = afSnap.map(a => [
    dOr(a.日期), esc(a.客户), platTag(a.平台), num0(a.待商家审核数量), num0(a.即将自动退售后单),
    a.退款处理时长 == null ? "—" : Number(a.退款处理时长).toFixed(1) + " " + (a.时长单位 || "小时"),
  ]);
  const refundWarning=a=>{
    if(!/(^|[,，])待商家审核$/.test(a.售后状态))return '—';
    if(a.refundSeconds==null)return '<span class="muted">未接入</span>';
    const seconds=Number(a.refundSeconds);
    if(seconds<=0)return badge('截止时间已到，待刷新','warn');
    const minutes=Math.ceil(seconds/60),text=`剩余 ${Math.floor(minutes/60)}小时${minutes%60}分`;
    return `<span title="自动退款截止：${esc(dtOr(a.自动退款截止时间))}">${seconds<=12*3600?badge('即将自动退 · '+text,'danger'):esc(text)}</span>`;
  };
  const afCaseRows = afCases.map(a => [
    `${platTag(a.平台)}<span class="nm">${esc(a.店铺)}</span>`,
    esc(a.售后单号), esc(a.订单号 || "—"), esc(a.售后类型 || "—"),
    esc(clean(a.申请原因) || "—"), money2(a.退款金额),
    badge(clean(a.售后状态) || "未知", afTone(clean(a.售后状态))), dtOr(a.申请时间), refundWarning(a),
    `<button type="button" class="act-btn af-expand" aria-expanded="false" data-client="${esc(a.客户)}" data-platform="${esc(a.平台)}" data-store="${esc(a.店铺 || '')}" data-case="${esc(a.售后单号)}">展开</button>`,
  ]);
  const afNodeRows = afNodes.map(n => [
    dtOr(n.节点时间), `${platTag(n.平台)}<span class="nm">${esc(n.店铺)}</span>`,
    esc(n.售后单号), esc(n.节点主体 || "—"), esc(n.节点操作 || "—"),
  ]);
  const waitReview = afSnap.reduce((s, a) => s + Number(a.待商家审核数量 || 0), 0);
  const soonAuto = afSnap.reduce((s, a) => s + Number(a.即将自动退售后单 || 0), 0);
  return `
    <div class="tab-pane active" id="pane-cf-refund">
    <div class="card"><h3>售后汇总 <span class="sub">各客户各平台最新快照 · 即将自动退：仅商家待审核且剩余≤12小时</span></h3>
      ${table(["日期", "客户", "平台", "待商家审核", "即将自动退", "退款处理时长"], afSnapRows, [3, 4, 5])}
      <p class="note" style="margin-top:8px">合计：待商家审核 ${int(waitReview)} 单，已接入数据中，12小时内即将自动退 ${int(soonAuto)} 单；「—」表示该店该字段未上报，不是 0。日期为各店最近一次快照，津南南无、百恩堂已停采，日期停在旧日。预警仅统计商家待审核、平台明确提供自动退款截止时间且剩余时间大于0、不超过12小时的单；目前已验证美团，其他平台及缺少截止时间的显示未接入，不用申请时间推算。</p></div>
    <div class="card"><h3>售后单 ${badge(`共 ${int(afTotal)} 单`, "info")} <span class="sub">黄色（待审核 / 待收货 / 待寄回等未完结）排最前，其余按申请时间倒序，共 ${afCases.length} 单；同一售后单在同平台多店铺记录只取一条</span></h3>
      ${afPlatBar}
      ${table(["店铺", "售后单号", "订单号", "类型", "申请原因", "退款金额", "状态", "申请时间", "自动退款预警", "节点记录"], afCaseRows, [5])}</div>
    <div class="card"><h3>售后节点流水 ${badge(`共 ${int(afNodeTotal)} 条`, "info")} <span class="sub">最近 ${afNodes.length} 条节点</span></h3>
      ${table(["时间", "店铺", "售后单号", "节点主体", "节点操作"], afNodeRows)}</div>
    </div>
  `;
}));

app.get('/api/aftersale/nodes',async(req,res)=>{
  const {client,platform,store,caseNo}=req.query;
  if(typeof client!=='string'||!client||client.length>64||!['美团','京东','天猫','拼多多'].includes(platform)||typeof store!=='string'||store.length>128||typeof caseNo!=='string'||!caseNo||caseNo.length>64)
    return res.status(400).json({ok:false,msg:'售后单参数无效'});
  const rows=await qx(`SELECT 节点时间 time,节点主体 actor,节点操作 action FROM ec_dw.aftersale_node
    WHERE 客户=? AND 平台=? AND 店铺=? AND 售后单号=? ORDER BY 节点时间 ASC,节点主体,节点操作`,[client,platform,store,caseNo]);
  res.json({ok:true,rows:rows.map(r=>({...r,time:fmtDT(r.time)}))});
});

// ---- 8. 运营 SOP ----
app.get("/sop", (req, res) => page(req, res, "运营 SOP", "/sop", async () => {
  const sops = await q("SELECT * FROM sop_item ORDER BY FIELD(freq,'日','周','月','岗位')");
  const doneIds = new Set((await q("SELECT sop_item_id FROM sop_done WHERE done_date=?", [fmtDate(new Date())])).map(r => r.sop_item_id));
  const groups = ["日", "周", "月", "岗位"];
  const names = { "日": "每日清单", "周": "每周清单", "月": "每月清单", "岗位": "岗位标准动作库" };
  const blocks = groups.map(g => {
    const items = sops.filter(s => s.freq === g).map(s =>
      `<div class="check-li"><span class="box ${doneIds.has(s.id) ? "done" : ""}" data-sop="${s.id}" data-done="${doneIds.has(s.id) ? 1 : 0}" title="点击标记完成 / 取消"></span><span>${esc(s.title)}<div class="note">${esc(s.detail)}</div></span><span class="who">${esc(s.role)}</span></div>`).join("");
    const doneN = sops.filter(s => s.freq === g && doneIds.has(s.id)).length;
    return `<div class="card sop-group"><h4>${names[g]} <span class="note">${doneN}/${sops.filter(s => s.freq === g).length} 已完成</span></h4>${items}</div>`;
  }).join("");
  const doneTotal = sops.filter(s => doneIds.has(s.id)).length;
  return `
    <div class="kpi" style="margin-bottom:16px"><div class="l">今日清单完成率 ${tip("当日已完成清单项 ÷ 当日应完成清单项；完成率纳入运营效率维度")}</div>
      <div class="v">${sops.length ? Math.round(doneTotal / sops.length * 100) : 0}%</div>
      <div class="d">${doneTotal}/${sops.length} 项已完成</div></div>
    <div class="grid g2">${blocks}</div>
    <div class="card"><h3>运营节奏 <span class="sub">日巡检 - 周复盘 - 月校准</span></h3>
      <div class="flow"><span class="step">每日：待办推送 + 紧急任务当日闭环</span><span class="arr">→</span><span class="step">每周：主管周会复盘评分与任务</span><span class="arr">→</span><span class="step">每月：客户报告 + 体系自诊断</span></div></div>
`;
}));

// 旧菜单入口重定向（原「体系自进化」已并入数据与规则）
app.get("/evolution", (req, res) => res.redirect(301, "/data"));
app.get("/score", (req, res) => res.redirect(301, "/diagnosis"));

// ---- 11. 使用说明 ----
app.get("/about", (req, res) => page(req, res, "使用说明", "/about", async () => {
  return `
    <div class="card"><h3>这是什么</h3>
      <p class="note">医药电商智能运营中台的可交互版本：保留原型页面结构，已有指标从 ec_dw 读取，缺失的数据标记未接入。<b>目的：让大家对着具体界面讨论，而不是对着文字想象。</b></p><p class="note" style="margin-top:8px">每个卡片与指标右上角有<b>「说明」</b>按钮（鼠标移上去出现）：点开右侧滑出「原型说明」，写清这个板块的介绍、数据来源和计算方式，可直接编辑并保存——这部分是给业务与开发确认需求用的，不属于系统功能，展开时页面会压缩而不是被遮挡，方便一边看说明一边对原型。</p></div>
    <div class="card"><h3>演示动线建议（约 15 分钟）</h3>
      <ol class="steps-demo">
        <li><span class="no">1</span><b>经营总览</b>：查看已接入店铺的经营全貌——这就是"替代手工 Excel"后的样子，数据自动汇聚，一页看全。</li>
        <li><span class="no">2</span><b>活动管理 → 活动核算</b>：停下来，重点看这些核算卡——字段和你们手工 Excel 活动表完全一致。问一句："这些数现在都谁在算、从哪来？"</li>
        <li><span class="no">3</span><b>风控中心</b>：这是最贴近日常操作的一块——「合规校验」的「校验记录」把每天被拦的、预警的、以及开售限制违规（非可售时段 / 禁售省份出单）都收进一张按时间倒序的表里，违规直接在「操作」列处置；「医生开方监控」看谁超时未接单；「售后自动退款预警」盯住即将自动退款、需优先审核的售后单。</li>
        <li><span class="no">4</span><b>经营诊断</b>：先看店铺健康度——100 分制怎么打分；再切「防歪防线」看五道机制怎么防"做数据"（评分与防线未接入）；最后看「AI 诊断 → 分级建议 → 任务看板」怎么闭环。</li>
        <li><span class="no">5</span><b>交易分析</b>：按平台 / 店铺 / 时间区间筛选交易趋势，回答"上个月京东到底卖了多少、哪天下滑"这类问题。</li>
        <li><span class="no">6</span><b>数据与规则</b>：各平台没有接口、全靠爬虫的现状，店铺登录/拉取状态怎么监控；商品主数据的售卖时段与禁售区域怎么维护；最后收在"要东西清单"（见下）。</li>
      </ol></div>
    <div class="card"><h3>演示后要对齐的四件事</h3>
      <ul class="list-plain">
        <li><b>活动核算表每个数从哪来</b>：采购成本、快递成本、平台补贴、技术服务费——手工填还是系统算？谁对准确性负责？</li>
        <li><b>旺店通现状</b>：哪些业务在用、和三平台谁推谁、有没有接口——决定库存和成本数据能不能自动进系统。</li>
        <li><b>评分口径</b>：六维权重、红黄蓝绿档位，先按方案默认跑还是按电商现有口径。</li>
        <li><b>第一阶段范围</b>：数据对接 + 核算 + 基础评分 + 两道熔断，旺店通深度对接是否后置。</li>
      </ul></div>
    <div class="card"><h3>技术说明（给开发）</h3>
      <ul class="list-plain">
        <li>数据只读自 <b>ec_dw</b>，不运行种子数据脚本。</li>
        <li>Node + Express 服务端渲染，无外部前端依赖；启动方式见 README.md</li>
        <li>正式环境：平台 API 替爬虫、旺店通接口补库存成本、增加权限与操作留痕</li>
      </ul></div>`;
}));

/* ---------- 11. 菜单管理（数据驱动，可调整层级与顺序） ---------- */
async function menuAdminHtml() {
  const rows = await q("SELECT * FROM menu ORDER BY parent_id, sort_order, id");
  const childrenOf = (pid) => rows.filter(r => r.parent_id === pid).sort((a, b) => (a.sort_order - b.sort_order) || (a.id - b.id));
  const rowHtml = (m, depth) => {
    const isTop = m.parent_id === 0;
    const children = childrenOf(m.id);
    const row = `<div class="menu-row" data-id="${m.id}" style="margin-left:${depth * 24}px">
        <span class="mh"><span class="mtype">${isTop ? "顶级" : "子项"}</span><input class="m-title" data-m="title" data-id="${m.id}" value="${esc(m.title)}"></span>
        <span class="mi">${esc(m.href)}</span>
        <span class="m-actions">
          <button class="mini" data-m="up" data-id="${m.id}" title="上移">↑</button>
          <button class="mini" data-m="down" data-id="${m.id}" title="下移">↓</button>
          ${isTop
            ? `<button class="mini" data-m="indent" data-id="${m.id}" title="降级为上一同级的下级菜单">→ 降级</button>`
            : `<button class="mini" data-m="outdent" data-id="${m.id}" title="升级到上一级">← 升级</button>`}
          <label class="mini-check"><input type="checkbox" data-m="mvp" data-id="${m.id}" ${m.is_mvp ? "checked" : ""}>MVP</label>
          <label class="mini-check"><input type="checkbox" data-m="enabled" data-id="${m.id}" ${m.enabled ? "checked" : ""}>启用</label>
          <button class="mini del" data-m="del" data-id="${m.id}" title="删除该菜单（含下级）">删除</button>
        </span>
      </div>`;
    return row + children.map(c => rowHtml(c, depth + 1)).join("");
  };
  return rows.filter(r => r.parent_id === 0).sort((a, b) => (a.sort_order - b.sort_order) || (a.id - b.id)).map(t => rowHtml(t, 0)).join("");
}
app.get("/api/menu/html", async (req, res) => res.send(await menuAdminHtml()));
app.get("/menu-admin", (req, res) => page(req, res, "菜单管理", "/menu-admin", async () => `
    <div class="banner info"><span>🧭</span><div>菜单结构由数据库驱动。<b>上移 / 下移</b>调整同级顺序，<b>降级 / 升级</b>调整层级归属，<b>MVP</b> 标记一期要做的功能，<b>启用</b>控制是否显示。修改后左侧导航与顶部页签会即时刷新。</div></div>
    <div class="card"><h3>菜单结构 <span class="sub">拖拽式层级与顺序管理（缩进表示下级）</span></h3>
      <div class="menu-list" id="menuList">${await menuAdminHtml()}</div>
      <div class="menu-addbar"><button class="act-btn" data-menu-add="top">+ 新增顶级菜单</button></div>
    </div>
`));
// 同级重排：dir=up|down
app.post("/api/menu/reorder", async (req, res) => {
  const { id, dir } = req.body;
  const m = (await q("SELECT * FROM menu WHERE id=?", [id]))[0];
  if (!m) return fail(res, "菜单不存在");
  const sibs = (await q("SELECT * FROM menu WHERE parent_id=? ORDER BY sort_order, id", [m.parent_id]));
  const i = sibs.findIndex(r => r.id === Number(id));
  if (i < 0) return fail(res, "菜单不存在");
  if (dir === "up" && i > 0) { const a = sibs[i - 1], b = sibs[i]; await q("UPDATE menu SET sort_order=? WHERE id=?", [b.sort_order, a.id]); await q("UPDATE menu SET sort_order=? WHERE id=?", [a.sort_order, b.id]); }
  else if (dir === "down" && i < sibs.length - 1) { const a = sibs[i], b = sibs[i + 1]; await q("UPDATE menu SET sort_order=? WHERE id=?", [b.sort_order, a.id]); await q("UPDATE menu SET sort_order=? WHERE id=?", [a.sort_order, b.id]); }
  else return fail(res, "已到边界");
  ok(res, "顺序已调整");
});
// 降级：成为上一个同级的子菜单
app.post("/api/menu/indent", async (req, res) => {
  const { id } = req.body;
  const m = (await q("SELECT * FROM menu WHERE id=?", [id]))[0];
  if (!m) return fail(res, "菜单不存在");
  const sibs = (await q("SELECT * FROM menu WHERE parent_id=? ORDER BY sort_order, id", [m.parent_id]));
  const i = sibs.findIndex(r => r.id === Number(id));
  if (i <= 0) return fail(res, "已是首项，无法降级");
  const newParent = sibs[i - 1].id;
  const maxSort = (await q("SELECT MAX(sort_order) mx FROM menu WHERE parent_id=?", [newParent]))[0].mx || 0;
  await q("UPDATE menu SET parent_id=?, sort_order=? WHERE id=?", [newParent, maxSort + 1, id]);
  ok(res, "已降级为子菜单");
});
// 升级：成为上一级（祖父）的下级
app.post("/api/menu/outdent", async (req, res) => {
  const { id } = req.body;
  const m = (await q("SELECT * FROM menu WHERE id=?", [id]))[0];
  if (!m) return fail(res, "菜单不存在");
  if (m.parent_id === 0) return fail(res, "已是顶级，无法升级");
  const parent = (await q("SELECT * FROM menu WHERE id=?", [m.parent_id]))[0];
  const grand = parent.parent_id;
  await q("UPDATE menu SET parent_id=? WHERE id=?", [grand, id]);
  // 放到祖父级末尾
  const maxSort = (await q("SELECT MAX(sort_order) mx FROM menu WHERE parent_id=?", [grand]))[0].mx || 0;
  await q("UPDATE menu SET sort_order=? WHERE id=?", [maxSort + 1, id]);
  ok(res, "已升级为上一级");
});
app.post("/api/menu/title", async (req, res) => {
  const { id, title } = req.body;
  if (!title || !String(title).trim()) return fail(res, "标题不能为空");
  await q("UPDATE menu SET title=? WHERE id=?", [String(title).trim(), id]);
  ok(res, "标题已更新");
});
app.post("/api/menu/mvp", async (req, res) => {
  const { id, val } = req.body;
  await q("UPDATE menu SET is_mvp=? WHERE id=?", [val ? 1 : 0, id]);
  ok(res, val ? "已标记为 MVP" : "已取消 MVP");
});
app.post("/api/menu/enabled", async (req, res) => {
  const { id, val } = req.body;
  await q("UPDATE menu SET enabled=? WHERE id=?", [val ? 1 : 0, id]);
  ok(res, val ? "已启用" : "已停用");
});
app.post("/api/menu/add", async (req, res) => {
  const { parent_id } = req.body;
  const pid = Number(parent_id) || 0;
  const maxSort = (await q("SELECT MAX(sort_order) mx FROM menu WHERE parent_id=?", [pid]))[0].mx || 0;
  const r = await q("INSERT INTO menu (parent_id, title, href, icon_key, sort_order, is_mvp, enabled) VALUES (?,?,?,?,?,0,1)",
    [pid, "新菜单", pid === 0 ? "/new" : "/new?sub=x", "", maxSort + 1]);
  ok(res, "已新增", { id: r.insertId });
});
app.post("/api/menu/del", async (req, res) => {
  const { id } = req.body;
  const children = await q("SELECT id FROM menu WHERE parent_id=?", [id]);
  if (children.length) await q("DELETE FROM menu WHERE parent_id=?", [id]);
  await q("DELETE FROM menu WHERE id=?", [id]);
  ok(res, "已删除");
});

/* ---------- 工具 ---------- */
function sub7(d) {
  const dt = new Date(d);
  dt.setDate(dt.getDate() - 6);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}
function subDays(d, n) {
  const dt = new Date(d);
  dt.setDate(dt.getDate() - n);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}
function daysBetween(a, b) { return Math.max(0, Math.ceil((new Date(b) - a) / 864e5)); }

// 监听所有网卡：0.0.0.0 表示同一路由器（局域网）内的同事也能访问
// 只想本机访问时改成：HOST=127.0.0.1 node server.js
const os = require("os");
const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT) || 3000;

// 打印本机局域网 IP，方便直接发给同事
const lanIPs = Object.values(os.networkInterfaces()).flat()
  .filter(i => i && i.family === "IPv4" && !i.internal)
  .map(i => i.address);

for (const [oldPath,newPath] of Object.entries({'/product':'/data?sub=sku','/subsidy':'/activity?sub=list','/aftersale':'/compliance?sub=refund','/risk':'/compliance','/cost':'/activity?sub=calc','/ops':'/data?sub=log','/order':'/analysis'})) app.get(oldPath,(req,res)=>res.redirect(302,newPath+(req.query.embed==='1'?'&embed=1':'')));
app.use((err,req,res,next) => { console.error(err.message); res.status(500).json({ok:false,msg:'数据读取失败，请稍后重试'}); });
const server = app.listen(PORT, HOST, () => {
  console.log(`RUNNING http://localhost:${PORT}`);
  lanIPs.forEach(ip => console.log(`局域网访问 http://${ip}:${PORT}`));
});
server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    const p = PORT + 1;
    app.listen(p, HOST, () => {
      console.log(`RUNNING http://localhost:${p}`);
      lanIPs.forEach(ip => console.log(`局域网访问 http://${ip}:${p}`));
    });
  } else console.error(e.message);
});
