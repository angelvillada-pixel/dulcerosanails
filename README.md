<<<<<<< HEAD
# 🌸 Dulce Rosa Nails Spa

Página web profesional para **Dulce Rosa Nails Spa** — Barrio Castilla, Medellín.

## 🚀 Cómo correr en local

```bash
# 1. Instalar dependencias
npm install

# 2. Correr en local
npm run dev
```

Abre `http://localhost:5173` en el navegador.

## 📦 Estructura del proyecto

```
dulcerosanails/
├── index.html          ← HTML principal
├── package.json        ← Dependencias
├── vite.config.js      ← Configuración de Vite
├── netlify.toml        ← Config deploy automático
├── .gitignore
└── src/
    ├── main.js         ← Punto de entrada, lógica principal
    ├── firebase.js     ← Conexión a Firebase
    ├── admin.js        ← Panel de administración
    ├── galeria.js      ← Slideshow del catálogo
    ├── data.js         ← Constantes y datos
    ├── style.css       ← Todos los estilos
    └── assets/
        └── logo.js     ← Logo del negocio en base64
```

## 🔥 Firebase

- Base de datos: **Firestore** (proyecto `dulce-rosa`)
- Colecciones: `citas`, `slots`, `galeria`, `config`
- Config del sitio (nequi, logo, horarios) en `config/site`
- Precios en `config/precios`

## ⚙️ Panel Admin

- Botón 🔐 Admin (esquina inferior derecha)
- Usuario: `DulceRosa28`
- Contraseña: `luciana28`

## 🌐 Deploy en Netlify

1. Conecta este repositorio en [netlify.com](https://netlify.com)
2. Netlify detecta el `netlify.toml` automáticamente
3. Cada `git push` despliega la página automáticamente

```bash
git add .
git commit -m "actualización"
git push
```
=======
# dulcerosanails
>>>>>>> d474fbf80cc34d547165c6e9532e54adfcf71e04
"# paginaweb_dulcerosa" 
