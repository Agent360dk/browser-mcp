// Sig kun "Copied" naar det faktisk lykkedes — en knap der lyver sender folk
// videre til terminalen med en tom udklipsholder.
document.querySelectorAll('.copy').forEach(function(b){b.onclick=function(){
  var pre=b.parentElement.querySelector('pre'), t=pre.textContent;
  var reset=function(){setTimeout(function(){b.textContent='Copy';b.classList.remove('done');},1500);};
  navigator.clipboard.writeText(t).then(function(){
    b.textContent='Copied';b.classList.add('done');reset();
  },function(){
    b.textContent='Select & copy';
    var r=document.createRange();r.selectNodeContents(pre);
    var s=window.getSelection();s.removeAllRanges();s.addRange(r);reset();
  });
};});
