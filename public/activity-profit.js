document.addEventListener('click',function(event){
  const button=event.target.closest('[data-profit-target]');if(!button)return;
  const article=document.getElementById(button.dataset.profitTarget);if(!article)return;
  const detail=article.querySelector('.act-product-detail');if(detail)detail.open=true;
  document.querySelectorAll('.act-profit-selected').forEach(el=>el.classList.remove('act-profit-selected'));
  article.classList.add('act-profit-selected');requestAnimationFrame(()=>article.scrollIntoView({behavior:'instant',block:'start'}));
});
