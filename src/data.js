export const HORAS_DEFAULT = ['8:00','9:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00'];

export const PRECIOS_DEFAULT = {
  esmaltado_manos: 22000, esmaltado_pies: 22000,
  semi_hombres: 25000,    semi_mujeres: 38000,
  press_on: 75000,        dipping: 65000,
  acrilicas: 95000,       poligel: 85000,
  ret_press_on: 65000,    ret_acrilicas: 80000,
  ret_poligel: 65000,     ret_semi: 15000,
  ret_press_on2: 20000,   ret_acrilicas2: 20000
};

export const PRECIO_IDS = {
  'pr-esmaltado-manos': 'esmaltado_manos',
  'pr-esmaltado-pies':  'esmaltado_pies',
  'pr-semi-hombres':    'semi_hombres',
  'pr-semi-mujeres':    'semi_mujeres',
  'pr-press-on':        'press_on',
  'pr-dipping':         'dipping',
  'pr-acrilicas':       'acrilicas',
  'pr-poligel':         'poligel',
  'pr-ret-press':       'ret_press_on',
  'pr-ret-acrilicas':   'ret_acrilicas',
  'pr-ret-poligel':     'ret_poligel',
  'pr-retiro-semi':     'ret_semi',
  'pr-retiro-press':    'ret_press_on2',
  'pr-retiro-acrilicas':'ret_acrilicas2'
};

export function fechaHoyColombia() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}

export function formatCOP(num) {
  return '$' + Number(num).toLocaleString('es-CO');
}
