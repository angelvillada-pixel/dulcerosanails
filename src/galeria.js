export function renderGaleriaSkeleton(count = 6) {
  const grid = document.getElementById('galeria-grid-pub');
  if (!grid) return;

  grid.innerHTML = Array.from({ length: count }, () => `
    <div class="galeria-grid-card galeria-grid-skeleton" aria-hidden="true">
      <div class="galeria-skeleton-block"></div>
    </div>
  `).join('');
}

// Renderiza la galeria publica en el overlay con grid (no slider)
export function renderGaleriaPublica(fotos) {
  const grid = document.getElementById('galeria-grid-pub');
  if (!grid) return;

  if (!fotos.length) {
    grid.innerHTML = '<div class="galeria-empty">Proximamente fotos de nuestros trabajos</div>';
    return;
  }

  grid.innerHTML = fotos
    .map((foto) => `
      <div class="galeria-grid-card" onclick="abrirLightbox('${foto.url.replace(/'/g, "\\'")}')">
        <img src="${foto.url}" alt="${foto.titulo || 'Trabajo'}" loading="lazy" decoding="async"/>
        ${foto.titulo ? `<div class="g-label">${foto.titulo}</div>` : ''}
      </div>
    `)
    .join('');
}

window.abrirLightbox = function (src) {
  const lb = document.getElementById('lightbox');
  document.getElementById('lb-img').src = src;
  lb.classList.add('show');
};

window.cerrarLightbox = function () {
  document.getElementById('lightbox').classList.remove('show');
};
