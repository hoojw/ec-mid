(function(){
  var card=document.querySelector('#pane-act-calc .act-filter');
  if(!card)return;
  card=card.closest('.card');card.classList.add('cost-update-card');
  var trigger=document.createElement('button');trigger.type='button';trigger.className='cost-update-trigger';trigger.textContent='成本数据更新';card.appendChild(trigger);
  var rateTrigger=document.createElement('button');rateTrigger.type='button';rateTrigger.className='cost-update-trigger rate-adjust-trigger';rateTrigger.textContent='费率调整';card.appendChild(rateTrigger);
  rateTrigger.addEventListener('click',function(){window.openRateAdjust();});
  var mask=document.createElement('div');mask.className='cost-upload-mask';mask.hidden=true;
  mask.innerHTML='<section class="cost-upload-dialog" role="dialog" aria-modal="true" aria-labelledby="cost-upload-title">'+
    '<div class="cost-upload-head"><h3 id="cost-upload-title">成本数据更新</h3><button type="button" class="cost-upload-close" aria-label="关闭">×</button></div>'+
    '<div class="cost-upload-fields"><label>客户<select id="cost-upload-store" required disabled><option value="">请选择客户</option></select></label></div>'+
    '<div class="cost-upload-step"><h4>已有成本表</h4><p>下载所选客户已有的69码、商品名称和单盒成本，修改后可直接上传。</p><button type="button" class="act-btn" id="cost-template-download" disabled>下载已有成本表</button></div>'+
    '<div class="cost-upload-step"><h4>数据上传</h4><p>支持 .xlsx、.csv，最多5000条、5MB。成本按客户共用，更新将用于该客户的各平台店铺；仅修改文件内的商品。</p><input type="file" id="cost-upload-file" accept=".xlsx,.csv"><button type="button" class="act-btn primary" id="cost-upload-submit" disabled>数据上传</button></div>'+
    '<div class="cost-upload-result" role="status" aria-live="polite"></div></section>';
  document.body.appendChild(mask);
  var st=mask.querySelector('#cost-upload-store'),download=mask.querySelector('#cost-template-download'),file=mask.querySelector('#cost-upload-file'),submit=mask.querySelector('#cost-upload-submit'),message=mask.querySelector('.cost-upload-result');
  var stores=[],busy=false,loadSeq=0;
  function tell(text,error){message.textContent=text;message.classList.toggle('error',!!error);}
  function sync(){download.disabled=busy||!st.value;submit.disabled=busy||!st.value||!file.files.length;st.disabled=busy||!stores.length;file.disabled=busy;mask.querySelector('.cost-upload-close').disabled=busy;}
  function fillStores(value){st.replaceChildren(new Option('请选择客户',''));stores.forEach(function(s){var duplicate=stores.filter(function(x){return x.name===s.name;}).length>1;st.add(new Option(s.name+(duplicate?'（'+s.platform+'）':''),s.code));});st.value=value||'';sync();}
  async function showCurrent(){var seq=++loadSeq;if(!st.value){tell('');return;}try{var r=await fetch('/api/cost/current?'+new URLSearchParams({store:st.value}));var d=await r.json();if(seq!==loadSeq)return;if(!d.ok)throw new Error(d.msg);var known=d.rows.filter(function(r){return r.cost!=null;}).length;tell('当前客户有 '+d.rows.length+' 个条码，其中 '+known+' 个已有单盒成本。');}catch(e){if(seq===loadSeq)tell(e.message,true);}}
  function close(){if(busy)return;mask.hidden=true;trigger.focus();}
  trigger.addEventListener('click',async function(){mask.hidden=false;tell('正在加载客户…');try{var r=await fetch('/api/cost/options');var d=await r.json();if(!d.ok)throw new Error(d.msg);stores=d.stores;var pageStore=document.getElementById('actStore');var selected=stores.find(function(s){return String(s.id)===(pageStore?pageStore.value:'');});fillStores(selected?selected.code:'');await showCurrent();st.focus();}catch(e){tell('客户加载失败：'+e.message,true);}});
  st.addEventListener('change',function(){file.value='';sync();showCurrent();});file.addEventListener('change',sync);
  download.addEventListener('click',async function(){if(!st.value||busy)return;busy=true;sync();tell('正在导出已有成本表…');try{var r=await fetch('/api/cost/export?'+new URLSearchParams({store:st.value}));if(!r.ok){var d=await r.json();throw new Error(d.msg||'导出失败');}var blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement('a'),selected=stores.find(function(s){return s.code===st.value;});a.href=url;a.download=(selected?selected.name:'店铺')+'已有成本表.xlsx';document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},30000);tell('已有成本表已下载，修改后可直接上传。');}catch(e){tell(e.message,true);}finally{busy=false;sync();}});
  submit.addEventListener('click',async function(){var chosen=file.files[0];if(!chosen||!st.value)return;if(chosen.size>5*1024*1024){tell('文件不能超过5MB',true);return;}
    busy=true;sync();tell('正在校验并上传…');try{
      var content=await new Promise(function(resolve,reject){var reader=new FileReader();reader.onerror=function(){reject(new Error('文件读取失败'));};reader.onload=function(){resolve(String(reader.result).split(',')[1]);};reader.readAsDataURL(chosen);});
      var r=await fetch('/api/cost/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({store:st.value,filename:chosen.name,content:content})});var d=await r.json();if(!d.ok)throw new Error(d.msg);tell(d.msg+'。');file.value='';if(parent!==window)parent.dispatchEvent(new CustomEvent('operations-data-updated',{detail:{store:st.value}}));else document.dispatchEvent(new CustomEvent('cost-updated',{detail:{store:st.value}}));
      // Show the persisted result immediately without discarding the upload confirmation.
      var prior=card.querySelector('.cost-upload-saved');if(prior)prior.remove();var saved=document.createElement('p');saved.className='cost-upload-saved note';saved.textContent=d.msg+'（单盒成本，元/盒）';card.appendChild(saved);
    }catch(e){tell(e.message,true);}finally{busy=false;sync();}
  });
  mask.querySelector('.cost-upload-close').addEventListener('click',close);mask.addEventListener('click',function(e){if(e.target===mask)close();});
  document.addEventListener('keydown',function(e){if(mask.hidden)return;if(e.key==='Escape')close();if(e.key==='Tab'){var controls=Array.from(mask.querySelectorAll('button:not(:disabled),select:not(:disabled),input:not(:disabled)'));var first=controls[0],last=controls[controls.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
})();

(function(){
  let dialog,busy=false,seq=0;
  window.openRateAdjust=async function(){
    if(!dialog){
      dialog=document.createElement('div');dialog.className='cost-upload-mask';dialog.hidden=true;
      dialog.innerHTML='<form class="cost-upload-dialog" role="dialog" aria-modal="true" aria-labelledby="rate-title"><div class="cost-upload-head"><h3 id="rate-title">费率调整</h3><button type="button" class="cost-upload-close" aria-label="关闭">×</button></div><div class="cost-upload-fields"><label>客户<select name="client" required></select></label><label>平台<select name="platform"><option>美团</option><option>京东</option><option>天猫</option><option>拼多多</option></select></label><label>生效日期<input name="date" type="date" required></label><label>平台扣点（%）<input name="fee" type="number" min="0" max="99.9999" step="0.0001" required></label><label>利润点（%）<input name="profit" type="number" min="0" max="99.9999" step="0.0001" required></label><label>代运营费率（%）<input name="agency" type="number" min="0" max="99.9999" step="0.0001" required></label></div><p class="note">费率按客户、平台生效；同一生效日期的设置会更新。各项合计须小于100%。</p><button class="act-btn primary" type="submit">保存费率</button><div class="cost-upload-result" role="status" aria-live="polite"></div></form>';
      document.body.appendChild(dialog);
      const form=dialog.querySelector('form'),el=name=>form.elements.namedItem(name),message=dialog.querySelector('.cost-upload-result');
      const tell=(text,error=false)=>{message.textContent=text;message.classList.toggle('error',error);};
      const disable=value=>{busy=value;dialog.querySelectorAll('button,input,select').forEach(x=>x.disabled=value);};
      async function load(){
        const id=++seq;disable(true);tell('正在读取费率…');
        ['fee','profit','agency'].forEach(n=>el(n).value='');
        try{
          const response=await fetch('/api/rate/current?'+new URLSearchParams({client:el('client').value,platform:el('platform').value,date:el('date').value}));const data=await response.json();if(id!==seq)return;if(!data.ok)throw new Error(data.msg);
          ['fee','profit','agency'].forEach(n=>el(n).value=data.rates?Number((Number(data.rates[n])*100).toFixed(4)):'');
          tell(data.rates?'当前读取生效于 '+data.rates.since+' 的费率。':'尚未设置，请填写费率。');
        }catch(e){tell(e.message,true);}finally{if(id===seq)disable(false);}
      }
      ['client','platform','date'].forEach(n=>el(n).addEventListener('change',load));
      const close=()=>{if(!busy){dialog.hidden=true;document.querySelector('.rate-adjust-trigger').focus();}};
      dialog.querySelector('.cost-upload-close').onclick=close;dialog.onclick=e=>{if(e.target===dialog)close();};
      dialog.addEventListener('keydown',e=>{if(e.key==='Escape')close();if(e.key==='Tab'){const a=Array.from(dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)'));if(e.shiftKey&&document.activeElement===a[0]){e.preventDefault();a[a.length-1].focus();}else if(!e.shiftKey&&document.activeElement===a[a.length-1]){e.preventDefault();a[0].focus();}}});
      form.onsubmit=async e=>{
        e.preventDefault();if(busy)return;
        const body={client:el('client').value,platform:el('platform').value,date:el('date').value};['fee','profit','agency'].forEach(n=>body[n]=Number(el(n).value));
        if(body.fee+body.profit+body.agency>=100){tell('费率合计须小于100%',true);return;}
        disable(true);tell('正在保存…');
        try{const response=await fetch('/api/rate/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),data=await response.json();if(!data.ok)throw new Error(data.msg);location.reload();}catch(e){tell(e.message,true);disable(false);}
      };
      dialog.loadRates=load;dialog.setBusy=disable;dialog.tell=tell;
    }
    dialog.hidden=false;dialog.setBusy(true);dialog.tell('正在加载客户…');
    try{
      const response=await fetch('/api/cost/options'),data=await response.json();if(!data.ok)throw new Error(data.msg);
      const form=dialog.querySelector('form'),el=n=>form.elements.namedItem(n);el('client').replaceChildren(...data.stores.map(s=>new Option(s.client,s.client)));
      const client=document.querySelector('#actStore');if(client&&data.stores.some(s=>s.client===client.value))el('client').value=client.value;
      el('platform').value=document.querySelector('#actPlatform')?.value||'美团';
      const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),part=n=>parts.find(x=>x.type===n).value;
      el('date').value=new URLSearchParams(location.search).get('act_date')||[part('year'),part('month'),part('day')].join('-');
      await dialog.loadRates();el('fee').focus();
    }catch(e){dialog.tell(e.message,true);dialog.setBusy(false);}
  };
})();
