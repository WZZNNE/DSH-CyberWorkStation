(function () {
  'use strict';
  const html = document.documentElement;
  html.classList.add('js');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  /* fade-in on scroll */
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.02 });
    $$('.reveal').forEach((el) => io.observe(el));
  } else {
    $$('.reveal').forEach((el) => el.classList.add('in'));
  }

  /* active section in the top nav */
  const secs = $$('main section[id]'), links = $$('.index a');
  if ('IntersectionObserver' in window) {
    const so = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) { const id = en.target.id; links.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + id)); }
    }, { rootMargin: '-40% 0px -55% 0px', threshold: 0 });
    secs.forEach((s) => so.observe(s));
  }

  /* back to top */
  const totop = $('.totop');
  function onScroll() { if (totop) totop.classList.toggle('on', document.documentElement.scrollTop > 900); }
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
  if (totop) totop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }));

  /* lightbox */
  const items = $$('figure.fig [data-lightbox]'), lb = $('#lb'), heroShot = $('.hero .shot [data-lightbox]');
  if (lb && items.length) {
    const img = $('img', lb), cap = $('.cap', lb); let cur = 0;
    function show(i) {
      cur = (i + items.length) % items.length; const a = items[cur];
      img.src = a.getAttribute('href'); img.alt = a.dataset.title || '';
      cap.innerHTML = '<b>图 ' + (a.dataset.fig || '') + '</b><span>' + (a.dataset.title || '') + '</span>' + (a.dataset.sub ? '<span>' + a.dataset.sub + '</span>' : '') + '<span>' + (cur + 1) + ' / ' + items.length + '</span>';
      lb.classList.add('on'); document.body.style.overflow = 'hidden';
    }
    function hide() { lb.classList.remove('on'); document.body.style.overflow = ''; }
    items.forEach((a, i) => a.addEventListener('click', (e) => { e.preventDefault(); show(i); }));
    if (heroShot) heroShot.addEventListener('click', (e) => { e.preventDefault(); show(0); });
    $('.prev', lb).addEventListener('click', () => show(cur - 1));
    $('.next', lb).addEventListener('click', () => show(cur + 1));
    $('.close', lb).addEventListener('click', hide);
    lb.addEventListener('click', (e) => { if (e.target === lb) hide(); });
    window.addEventListener('keydown', (e) => {
      if (!lb.classList.contains('on')) return;
      if (e.key === 'Escape') hide(); else if (e.key === 'ArrowLeft') show(cur - 1); else if (e.key === 'ArrowRight') show(cur + 1);
    });
  }

  /* roster filter */
  const bar = $('.roster-bar');
  if (bar) {
    const cards = $$('.rcard'), groups = $$('.roster-group'), countEl = $('.count', bar);
    function apply(f) {
      let n = 0;
      cards.forEach((c) => { const on = f === 'all' || c.dataset.origin === f; c.classList.toggle('hide', !on); if (on) n++; });
      groups.forEach((g) => g.classList.toggle('hide', !$$('.rcard', g).some((c) => !c.classList.contains('hide'))));
      $$('button[data-f]', bar).forEach((b) => b.classList.toggle('on', b.dataset.f === f));
      if (countEl) countEl.textContent = '显示 ' + n + ' / ' + cards.length;
    }
    $$('button[data-f]', bar).forEach((b) => b.addEventListener('click', () => apply(b.dataset.f)));
    apply('all');
  }
})();
