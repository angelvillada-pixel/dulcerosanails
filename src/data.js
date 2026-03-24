export const HORAS_DEFAULT = ['8:00','9:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00'];
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

// Convierte '13:00' → '1:00 P.M.' | '8:00' → '8:00 A.M.'
export function to12h(hora) {
  if (!hora) return hora;
  const [h, m] = hora.split(':').map(Number);
  const suffix = h < 12 ? 'A.M.' : 'P.M.';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2,'0')} ${suffix}`;
}

export const PRECIOS_DEFAULT = {
  esmaltado_manos:22000, esmaltado_pies:22000, semi_hombres:25000, semi_mujeres:38000,
  press_on:75000, dipping:65000, acrilicas:95000, poligel:85000,
  ret_press_on:65000, ret_acrilicas:80000, ret_poligel:65000,
  ret_semi:15000, ret_press_on2:20000, ret_acrilicas2:20000
};

export const SERVICIO_KEYS = [
  { id:'esmaltado_manos', nombre:'Esmaltado Tradicional Manos', emoji:'🖐️', cat:'💅 Esmaltado', descripcion:'Esmaltado con esmalte convencional en manos.', detalles:'Incluye limpieza de cutícula, hidratación y esmaltado en el color que elijas.' },
  { id:'esmaltado_pies',  nombre:'Esmaltado Tradicional Pies',  emoji:'🦶', cat:'💅 Esmaltado', descripcion:'Esmaltado con esmalte convencional en pies.', detalles:'Incluye exfoliación, hidratación y esmaltado en el color que elijas.' },
  { id:'semi_hombres',    nombre:'Semipermanente Hombres',      emoji:'💜', cat:'💅 Esmaltado', descripcion:'Semipermanente de larga duración para hombres.', detalles:'Duración 3-4 semanas. Incluye limpieza y esmaltado gel.' },
  { id:'semi_mujeres',    nombre:'Semipermanente Mujeres',      emoji:'🌸', cat:'💅 Esmaltado', descripcion:'Semipermanente de larga duración para mujeres.', detalles:'Duración 3-4 semanas. Incluye limpieza de cutícula y esmaltado gel.' },
  { id:'press_on',        nombre:'Press On',                    emoji:'🎀', cat:'✨ Uñas',      descripcion:'Uñas postizas personalizadas listas para poner.', detalles:'Diseño personalizado, larga duración. Incluye kit de aplicación.' },
  { id:'dipping',         nombre:'Dipping de Acrílico',         emoji:'💎', cat:'✨ Uñas',      descripcion:'Técnica de polvo acrílico sin monómero líquido.', detalles:'Más resistente que el esmalte. No daña la uña natural. Duración 3-4 semanas.' },
  { id:'acrilicas',       nombre:'Acrílicas',                   emoji:'💅', cat:'✨ Uñas',      descripcion:'Extensión de uñas en acrílico.', detalles:'Incluye diseño, forma y largo a tu elección. Precio desde $95.000 según diseño.', desde:true },
  { id:'poligel',         nombre:'Poligel',                     emoji:'🌟', cat:'✨ Uñas',      descripcion:'Extensión con poligel, más liviana y flexible.', detalles:'Más liviana que el acrílico. Gran variedad de diseños. Duración 3-4 semanas.' },
  { id:'ret_press_on',    nombre:'Retoque Press On',            emoji:'🎀', cat:'🔧 Retoques',  descripcion:'Retoque y mantenimiento de uñas Press On.', detalles:'Incluye limpieza y refuerzo de las uñas existentes.' },
  { id:'ret_acrilicas',   nombre:'Retoque Acrílicas',           emoji:'💅', cat:'🔧 Retoques',  descripcion:'Retoque de crecimiento en uñas acrílicas.', detalles:'Se trabaja el área del crecimiento para que queden como nuevas.' },
  { id:'ret_poligel',     nombre:'Retoque Poligel',             emoji:'🌟', cat:'🔧 Retoques',  descripcion:'Retoque de crecimiento en uñas de poligel.', detalles:'Mantenimiento completo del poligel existente.' },
  { id:'ret_semi',        nombre:'Retiro Semipermanente',       emoji:'🌸', cat:'🧹 Retiros',   descripcion:'Retiro seguro del esmalte semipermanente.', detalles:'Proceso cuidadoso sin dañar la uña natural. Incluye hidratación.' },
  { id:'ret_press_on2',   nombre:'Retiro Press On',             emoji:'🎀', cat:'🧹 Retiros',   descripcion:'Retiro seguro de uñas Press On.', detalles:'Sin dañar la uña natural. Incluye cuidado post-retiro.' },
  { id:'ret_acrilicas2',  nombre:'Retiro Acrílicas',            emoji:'💅', cat:'🧹 Retiros',   descripcion:'Retiro seguro de uñas acrílicas.', detalles:'Proceso especializado para cuidar la uña natural.' },
];

export const CATEGORIAS = ['💅 Esmaltado','✨ Uñas','🔧 Retoques','🧹 Retiros'];

export function fechaHoyColombia() {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota'}).format(new Date());
}
export function formatCOP(n) { return '$'+Number(n).toLocaleString('es-CO'); }

export function validarArchivoImagen(file) {
  if (!file) return 'No se selecciono ninguna imagen.';
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return 'Solo se permiten imagenes JPG, PNG o WebP.';
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return 'La imagen no puede superar 5 MB.';
  }
  return null;
}

export function comprimirImagen(file, maxW=1200, q=0.82, _objectPosition='center') {
  const validationError = validarArchivoImagen(file);
  if (validationError) return Promise.reject(new Error(validationError));

  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = e => {
      const img = new Image();
      img.onload = () => {
        let w=img.width, h=img.height;
        if(w>maxW){h=Math.round(h*maxW/w);w=maxW;}
        const c=document.createElement('canvas');
        c.width=w;c.height=h;
        c.getContext('2d').drawImage(img,0,0,w,h);
        const webp = c.toDataURL('image/webp',q);
        resolve(webp.startsWith('data:image/webp') ? webp : c.toDataURL('image/jpeg',q));
      };
      img.onerror = () => reject(new Error('La imagen no se pudo procesar.'));
      img.src=e.target.result;
    };
    r.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    r.readAsDataURL(file);
  });
}
