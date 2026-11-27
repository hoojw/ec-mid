(function(){
  let sequence=0;
  document.addEventListener('click',async function(event){
    const button=event.target.closest('.af-expand');if(!button)return;
    const row=button.closest('tr');
    let panel=row.nextElementSibling;
    if(!panel||!panel.classList.contains('af-node-detail')){
      panel=document.createElement('tr');panel.className='af-node-detail';panel.hidden=true;panel.id='af-node-detail-'+(++sequence);
      const cell=document.createElement('td');cell.colSpan=row.cells.length;cell.style.cssText='padding:16px 24px;background:#f7faf8;white-space:normal';panel.appendChild(cell);row.after(panel);button.setAttribute('aria-controls',panel.id);
    }
    panel.hidden=!panel.hidden;button.setAttribute('aria-expanded',String(!panel.hidden));button.textContent=panel.hidden?'展开':'收起';
    if(panel.hidden||panel.dataset.loaded||panel.dataset.loading)return;
    panel.dataset.loading='1';const cell=panel.cells[0];cell.textContent='正在加载节点记录…';
    try{
      const params=new URLSearchParams({client:button.dataset.client,platform:button.dataset.platform,store:button.dataset.store,caseNo:button.dataset.case});
      const response=await fetch('/api/aftersale/nodes?'+params),data=await response.json();if(!response.ok||!data.ok)throw new Error(data.msg||'节点读取失败');
      cell.replaceChildren();const caption=document.createElement('p');caption.className='note';caption.textContent='节点记录 · 最新在上 · '+data.rows.length+' 条';cell.appendChild(caption);
      if(!data.rows.length){const empty=document.createElement('p');empty.className='note';empty.textContent='暂无已采集的节点记录';cell.appendChild(empty);}
      else{
        const timeline=document.createElement('ol');timeline.className='af-timeline';
        data.rows.slice().reverse().forEach(node=>{
          const item=document.createElement('li'),content=document.createElement('div'),actor=document.createElement('span'),action=document.createElement('span'),time=document.createElement('time');
          content.className='af-timeline-content';actor.className='af-timeline-actor';actor.textContent=node.actor||'—';action.textContent=node.action||'—';time.textContent=node.time||'时间未接入';if(node.time)time.dateTime=node.time.replace(' ','T');
          content.append(actor,action);item.append(content,time);timeline.appendChild(item);
        });cell.appendChild(timeline);
      }
      panel.dataset.loaded='1';
    }catch(e){cell.textContent=e.message+'，收起后可重新展开重试。';}
    finally{delete panel.dataset.loading;}
  });
})();
