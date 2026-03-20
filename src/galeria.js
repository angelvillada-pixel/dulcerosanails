let gSlide = 0, gFotos = [], gTimer = null;

export function renderGaleriaPublica(fotos) {
  gFotos = fotos;
  gSlide = 0;
  const track = document.getElementById('galeria-track');
  const dots  = document.getElementById('galeria-dots');
  if (!track) return;
  clearInterval(gTimer);

  if (!fotos.length) {
    track.innerHTML = '<div class="galeria-vacia">🌸 Próximamente fotos de nuestros trabajos</div>';
    if (dots) dots.innerHTML = '';
    return;
  }

  track.innerHTML = fotos.map(f => `
    <div class="galeria-card">
      <img src="${f.url}" alt="${f.titulo || 'Trabajo'}" loading="lazy"/>
      ${f.titulo ? `<div class="galeria-label">${f.titulo}</div>` : ''}
    </div>`).join('');

  const porVista = () => window.innerWidth < 600 ? 1 : window.innerWidth < 960 ? 2 : 3;

  if (dots) {
    const total = Math.max(1, fotos.length - porVista() + 1);
    dots.innerHTML = Array.from({ length: total }, (_, i) =>
      `<button class="galeria-dot${i === 0 ? ' active' : ''}" onclick="irSlide(${i})"></button>`).join('');
  }

  gTimer = setInterval(() => {
    const max = Math.max(0, gFotos.length - porVista());
    gSlide = gSlide >= max ? 0 : gSlide + 1;
    moverSlide(gSlide);
  }, 3500);
}

function moverSlide(n) {
  const track = document.getElementById('galeria-track');
  if (!track) return;
  const card = track.querySelector('.galeria-card');
  if (!card) return;
  const w = card.offsetWidth + 16;
  track.style.transform = `translateX(-${n * w}px)`;
  document.querySelectorAll('.galeria-dot').forEach((d, i) => d.classList.toggle('active', i === n));
}

window.irSlide   = (n) => { gSlide = n; moverSlide(n); };
window.prevSlide = () => {
  const pv = window.innerWidth < 600 ? 1 : window.innerWidth < 960 ? 2 : 3;
  gSlide = Math.max(0, gSlide - 1); moverSlide(gSlide);
};
window.nextSlide = () => {
  const pv = window.innerWidth < 600 ? 1 : window.innerWidth < 960 ? 2 : 3;
  gSlide = Math.min(Math.max(0, gFotos.length - pv), gSlide + 1); moverSlide(gSlide);
};
