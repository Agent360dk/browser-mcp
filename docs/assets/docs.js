document.querySelectorAll('.copy').forEach(function(b){b.onclick=async function(){var t=b.parentElement.querySelector('pre').textContent;try{await navigator.clipboard.writeText(t);}catch(e){}b.textContent='Copied';b.classList.add('done');setTimeout(function(){b.textContent='Copy';b.classList.remove('done');},1300);};});

// Analytics: ensure GA on every page (docs pages ship no inline tag) + track install intent.
(function () {
  var GA_ID = 'G-EL2ZW8T6DH';
  if (typeof window.gtag === 'undefined') {
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { dataLayer.push(arguments); };
    gtag('js', new Date());
    gtag('config', GA_ID);
  }
  // The three real "go get it" destinations — the closest thing this docs site has to a conversion.
  function classify(href) {
    if (!href) return null;
    if (href.indexOf('chromewebstore.google.com') > -1 || href.indexOf('chrome.google.com/webstore') > -1) return 'chrome_web_store';
    if (href.indexOf('npmjs.com') > -1) return 'npm';
    if (href.indexOf('github.com/Agent360dk/browser-mcp') > -1) return 'github';
    return null;
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var type = classify(a.getAttribute('href'));
    if (type && typeof window.gtag === 'function') {
      gtag('event', 'install_click', { link_type: type, link_url: a.href });
    }
  }, true);
})();