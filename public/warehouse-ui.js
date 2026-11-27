// Keep prototype controls visible, clearly indicate actions awaiting a real API.
document.querySelectorAll('[data-api], [data-sop], [data-signup], [data-unsignup], [data-relogin], .ban-edit, [data-menu-action]').forEach(function(el) {
  el.title = '业务操作接口待接入';
  if ('disabled' in el) el.disabled = true;
  el.setAttribute('aria-disabled','true');
});
