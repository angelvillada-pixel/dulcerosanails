// Renderiza la galería pública en el overlay con grid (no slider)
export function renderGaleriaPublica(fotos) {
  const grid = document.getElementById('galeria-grid-pub');
  if (!grid) return;
  if (!fotos.length) {
    grid.innerHTML = '<div class="galeria-empty">🌸 Próximamente fotos de nuestros trabajos</div>';
    return;
  }
  grid.innerHTML = fotos.map(f => `
    <div class="galeria-grid-card" onclick="abrirLightbox('${f.url.replace(/'/g,"\\'")}')">
      <img src="${f.url}" alt="${f.titulo || 'Trabajo'}" loading="lazy"/>
      ${f.titulo ? `<div class="g-label">${f.titulo}</div>` : ''}
    </div>`).join('');
}

window.abrirLightbox = function(src) {
  const lb = document.getElementById('lightbox');
  document.getElementById('lb-img').src = src;
  lb.classList.add('show');
};
window.cerrarLightbox = function() {
  document.getElementById('lightbox').classList.remove('show');
};
