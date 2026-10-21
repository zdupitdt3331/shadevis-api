(() => {
  const items = document.querySelectorAll('.reveal');

  if (!('IntersectionObserver' in window)) {
    items.forEach((item) => item.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

  items.forEach((item, index) => {
    item.style.transitionDelay = Math.min(index * 40, 240) + 'ms';
    observer.observe(item);
  });

  document.querySelectorAll('.faq details').forEach((detail) => {
    detail.addEventListener('toggle', () => {
      if (!detail.open) return;
      document.querySelectorAll('.faq details').forEach((other) => {
        if (other !== detail) other.open = false;
      });
    });
  });

  const nav = document.querySelector('.nav');
  let last = 0;
  window.addEventListener('scroll', () => {
    const current = window.scrollY;
    nav.style.borderBottomColor = current > 10 ? 'rgba(255,255,255,.1)' : 'rgba(255,255,255,.06)';
    last = current;
  }, { passive: true });
})();
