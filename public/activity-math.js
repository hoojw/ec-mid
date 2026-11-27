(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ActivityMath=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const SCALE=10000n;
  function decimal(value,label='金额') {
    if(value==null||String(value).trim()==='')throw new Error('请填写'+label);
    const s=String(value).trim();
    if(!/^\d{1,12}(?:\.\d{1,4})?$/.test(s))throw new Error(label+'须为非负数字，最多4位小数');
    const [a,b='']=s.split('.');return BigInt(a)*SCALE+BigInt(b.padEnd(4,'0'));
  }
  function integer(value,label){if(!/^[1-9]\d{0,5}$/.test(String(value)))throw new Error(label+'须为1至999999的整数');return BigInt(value);}
  function rounded(n,d){const negative=(n<0n)!==(d<0n);n=n<0n?-n:n;d=d<0n?-d:d;const q=(n+d/2n)/d;return negative?-q:q;}
  function text(n,digits=4){const negative=n<0n;n=negative?-n:n;const q=rounded(n,10n**BigInt(4-digits));const p=10n**BigInt(digits);return (negative?'-':'')+(q/p).toString()+(digits?'.'+(q%p).toString().padStart(digits,'0'):'');}
  function multiply(cost,boxes){return text(decimal(cost)*integer(boxes,'盒数'));}
  function sum(a,b){return text(decimal(a)+decimal(b));}
  function calculate(input){
    const boxes=integer(input.boxes,'每份盒数'),quantity=integer(input.quantity,'预计订单量');
    const unit=decimal(input.unitCost,'单盒成本'),price=decimal(input.price,'商品定价'),delivery=decimal(input.delivery,'买家支付运费');
    const merchant=decimal(input.merchantDiscount,'商家优惠'),platform=decimal(input.platformDiscount,'平台承担优惠');
    const freight=decimal(input.freight,'快递成本'),packaging=decimal(input.packaging,'包装成本'),other=decimal(input.other,'其他单笔成本');
    const rate=decimal(input.rate,'技术服务费率');if(rate>100n*SCALE)throw new Error('费率不能超过100%');
    const purchase=unit*boxes,totalCost=purchase+freight+packaging+other;
    const original=price+delivery,buyerPaid=original-merchant-platform;
    if(buyerPaid<0n)throw new Error('优惠合计不能超过商品定价与买家运费之和');
    const receivable=buyerPaid+platform;
    const basis={price,buyerPaid,receivable}[input.feeBasis];if(basis==null)throw new Error('请选择技术服务费计费基数');
    // Fee is settled to cents for one order; all other arithmetic retains four decimals.
    const fee=rounded(basis*rate,100n*SCALE*100n)*100n;
    const income=receivable-fee,profit=income-totalCost;
    let floor=null;if(input.floor!=null&&String(input.floor).trim()!=='')floor=decimal(input.floor,'运营底价红线');
    const margin=income>0n?Number(rounded(profit*10000n,income))/100:null;
    return {purchase:text(purchase),totalCost:text(totalCost),original:text(original),buyerPaid:text(buyerPaid),platformRecovery:text(platform),receivable:text(receivable),fee:text(fee,2),income:text(income),profit:text(profit),totalProfit:text(profit*quantity),margin,belowFloor:floor==null?null:price<floor,loss:profit<0n};
  }
  function compare(a,b){const scaled=v=>{const s=String(v);if(!/^\d{1,18}(?:\.\d{1,4})?$/.test(s))throw new Error('金额格式无效');const [n,d='']=s.split('.');return BigInt(n)*SCALE+BigInt(d.padEnd(4,'0'));};const x=scaled(a),y=scaled(b);return x<y?-1:x>y?1:0;}
  return {calculate,multiply,sum,compare};
});
