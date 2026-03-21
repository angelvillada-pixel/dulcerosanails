export const HORAS_DEFAULT = ['8:00','9:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00'];

export const PRECIOS_DEFAULT = {
  esmaltado_manos:22000, esmaltado_pies:22000, semi_hombres:25000, semi_mujeres:38000,
  press_on:75000, dipping:65000, acrilicas:95000, poligel:85000,
  ret_press_on:65000, ret_acrilicas:80000, ret_poligel:65000,
  ret_semi:15000, ret_press_on2:20000, ret_acrilicas2:20000
};

export const SERVICIO_KEYS = [
  { id:'esmaltado_manos',  nombre:'Esmaltado Tradicional Manos', emoji:'🖐️', cat:'💅 Esmaltado' },
  { id:'esmaltado_pies',   nombre:'Esmaltado Tradicional Pies',  emoji:'🦶', cat:'💅 Esmaltado' },
  { id:'semi_hombres',     nombre:'Semipermanente Hombres',      emoji:'💜', cat:'💅 Esmaltado' },
  { id:'semi_mujeres',     nombre:'Semipermanente Mujeres',      emoji:'🌸', cat:'💅 Esmaltado' },
  { id:'press_on',         nombre:'Press On',                    emoji:'🎀', cat:'✨ Uñas' },
  { id:'dipping',          nombre:'Dipping de Acrílico',         emoji:'💎', cat:'✨ Uñas' },
  { id:'acrilicas',        nombre:'Acrílicas',                   emoji:'💅', cat:'✨ Uñas', desde:true },
  { id:'poligel',          nombre:'Poligel',                     emoji:'🌟', cat:'✨ Uñas' },
  { id:'ret_press_on',     nombre:'Retoque Press On',            emoji:'🎀', cat:'🔧 Retoques' },
  { id:'ret_acrilicas',    nombre:'Retoque Acrílicas',           emoji:'💅', cat:'🔧 Retoques' },
  { id:'ret_poligel',      nombre:'Retoque Poligel',             emoji:'🌟', cat:'🔧 Retoques' },
  { id:'ret_semi',         nombre:'Retiro Semipermanente',       emoji:'🌸', cat:'🧹 Retiros' },
  { id:'ret_press_on2',    nombre:'Retiro Press On',             emoji:'🎀', cat:'🧹 Retiros' },
  { id:'ret_acrilicas2',   nombre:'Retiro Acrílicas',            emoji:'💅', cat:'🧹 Retiros' },
];

export const CATEGORIAS = ['💅 Esmaltado','✨ Uñas','🔧 Retoques','🧹 Retiros'];

export function fechaHoyColombia() {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota'}).format(new Date());
}
export function formatCOP(n) { return '$'+Number(n).toLocaleString('es-CO'); }

export function comprimirImagen(file, maxW=400, q=0.65) {
  return new Promise(res => {
    const r = new FileReader();
    r.onload = e => {
      const img = new Image();
      img.onload = () => {
        let w=img.width, h=img.height;
        if(w>maxW){h=Math.round(h*maxW/w);w=maxW;}
        const c=document.createElement('canvas');
        c.width=w;c.height=h;
        c.getContext('2d').drawImage(img,0,0,w,h);
        res(c.toDataURL('image/jpeg',q));
      };
      img.src=e.target.result;
    };
    r.readAsDataURL(file);
  });
}
