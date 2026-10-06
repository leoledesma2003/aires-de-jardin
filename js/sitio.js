// Aires de Jardín — comportamiento de la web pública
// (menú del celular, visor de fotos y formulario de contacto)

const WHATSAPP = '5491167205790';

// ─── Encabezado: sombra al bajar ───
const encabezado = document.getElementById('encabezado');
const marcarSombra = () => encabezado.classList.toggle('con-sombra', window.scrollY > 10);
window.addEventListener('scroll', marcarSombra, { passive: true });
marcarSombra();

// ─── Menú del celular ───
const menuBoton = document.getElementById('menuBoton');
const menu = document.getElementById('menu');

function cerrarMenu() {
  menu.classList.remove('abierto');
  menuBoton.setAttribute('aria-expanded', 'false');
  menuBoton.setAttribute('aria-label', 'Abrir menú');
}

menuBoton.addEventListener('click', () => {
  const abierto = menu.classList.toggle('abierto');
  menuBoton.setAttribute('aria-expanded', String(abierto));
  menuBoton.setAttribute('aria-label', abierto ? 'Cerrar menú' : 'Abrir menú');
});
menu.querySelectorAll('a').forEach(a => a.addEventListener('click', cerrarMenu));

// ─── Servicios: explorador en compu, acordeón en celular ───
const srvTabs = [...document.querySelectorAll('.srv__tab')];
const esCelular = window.matchMedia('(max-width: 820px)');

srvTabs.forEach(tab => tab.addEventListener('click', () => {
  const panel = document.getElementById(tab.getAttribute('aria-controls'));
  const yaAbierto = tab.classList.contains('activo');

  // En compu siempre queda uno abierto; en celular se puede cerrar el abierto
  if (yaAbierto && !esCelular.matches) return;
  srvTabs.forEach(t => {
    t.classList.remove('activo');
    t.setAttribute('aria-expanded', 'false');
    document.getElementById(t.getAttribute('aria-controls')).classList.remove('activo');
  });
  if (yaAbierto) return;

  tab.classList.add('activo');
  tab.setAttribute('aria-expanded', 'true');
  panel.classList.add('activo');
  if (esCelular.matches) tab.scrollIntoView({ behavior: 'smooth', block: 'start' });
}));

// "Pedir presupuesto" de un servicio: deja ese servicio elegido en el formulario
document.querySelectorAll('[data-servicio]').forEach(a => a.addEventListener('click', () => {
  document.querySelector('#formulario select[name="servicio"]').value = a.dataset.servicio;
}));

// ─── Visor de fotos de la galería ───
const fotos = [...document.querySelectorAll('.galeria__item')];
const visor = document.getElementById('visor');
const visorFoto = document.getElementById('visorFoto');
let fotoActual = 0;
let botonQueAbrio = null;

function mostrarFoto(i) {
  fotoActual = (i + fotos.length) % fotos.length;
  const boton = fotos[fotoActual];
  visorFoto.src = boton.dataset.grande;
  visorFoto.alt = boton.querySelector('img').alt;
}

function abrirVisor(i) {
  botonQueAbrio = fotos[i];
  mostrarFoto(i);
  visor.hidden = false;
  document.body.style.overflow = 'hidden';
  document.getElementById('visorCerrar').focus();
}

function cerrarVisor() {
  visor.hidden = true;
  visorFoto.src = '';
  document.body.style.overflow = '';
  if (botonQueAbrio) botonQueAbrio.focus();
}

fotos.forEach((boton, i) => boton.addEventListener('click', () => abrirVisor(i)));
document.getElementById('visorCerrar').addEventListener('click', cerrarVisor);
document.getElementById('visorAnterior').addEventListener('click', () => mostrarFoto(fotoActual - 1));
document.getElementById('visorSiguiente').addEventListener('click', () => mostrarFoto(fotoActual + 1));
visor.addEventListener('click', e => { if (e.target === visor) cerrarVisor(); });

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && menu.classList.contains('abierto')) cerrarMenu();
  if (visor.hidden) return;
  if (e.key === 'Escape') cerrarVisor();
  if (e.key === 'ArrowLeft') mostrarFoto(fotoActual - 1);
  if (e.key === 'ArrowRight') mostrarFoto(fotoActual + 1);
});

// Deslizar con el dedo en el celular
let toqueX = null;
visor.addEventListener('touchstart', e => { toqueX = e.touches[0].clientX; }, { passive: true });
visor.addEventListener('touchend', e => {
  if (toqueX === null) return;
  const dx = e.changedTouches[0].clientX - toqueX;
  if (Math.abs(dx) > 50) mostrarFoto(fotoActual + (dx < 0 ? 1 : -1));
  toqueX = null;
});

// ─── Formulario de contacto ───
const formulario = document.getElementById('formulario');
const formularioBoton = document.getElementById('formularioBoton');
const aviso = document.getElementById('formularioAviso');
const abiertoEn = Date.now();
// En GitHub Pages no hay PHP: el pedido va a la API de Cloudflare (el mismo
// servidor del panel). Con un hosting con PHP se usa contacto.php.
const SIN_PHP = location.protocol === 'file:' || location.hostname.endsWith('github.io')
  || document.documentElement.dataset.sinPhp === 'true'; // lo marca publicar-github.sh
const DESTINO_FORMULARIO = SIN_PHP ? 'https://api.airesdejardin.com.ar/pedido' : 'contacto.php';

function linkWhatsapp(datos) {
  const texto = [
    'Hola Aires de Jardín, quisiera pedir un presupuesto.',
    datos.nombre && `Nombre: ${datos.nombre}`,
    datos.barrio && `Barrio: ${datos.barrio}${datos.lote ? ', lote ' + datos.lote : ''}`,
    datos.email && `Email: ${datos.email}`,
    datos.servicio && `Servicio: ${datos.servicio}`,
    datos.mensaje,
  ].filter(Boolean).join('\n');
  return `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(texto)}`;
}

function mostrarAviso(tipo, html) {
  aviso.className = 'formulario__aviso ' + tipo;
  aviso.innerHTML = html;
}

formulario.addEventListener('submit', async e => {
  e.preventDefault();
  const datos = Object.fromEntries(new FormData(formulario));
  for (const k in datos) datos[k] = String(datos[k]).trim();

  // Validación: nombre y teléfono obligatorios; email solo si lo completaron
  const errores = [];
  const campo = n => formulario.elements[n];
  ['nombre', 'telefono', 'email'].forEach(n => campo(n).classList.remove('con-error'));
  if (!datos.nombre) errores.push('nombre');
  if (datos.telefono.replace(/\D/g, '').length < 8) errores.push('telefono');
  if (datos.email && !campo('email').checkValidity()) errores.push('email');
  if (errores.length) {
    errores.forEach(n => campo(n).classList.add('con-error'));
    campo(errores[0]).focus();
    mostrarAviso('error', 'Revisá los campos marcados: nombre y un teléfono válido son obligatorios.');
    return;
  }

  datos.segundos = Math.round((Date.now() - abiertoEn) / 1000);
  formularioBoton.disabled = true;
  formularioBoton.textContent = 'Enviando…';
  mostrarAviso('', '');

  try {
    const r = await fetch(DESTINO_FORMULARIO, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(datos),
    });
    const res = await r.json();
    if (!res.ok) throw new Error(res.error || 'Error');
    formulario.reset();
    mostrarAviso('ok', '¡Gracias! Recibimos tu pedido y te vamos a contactar a la brevedad.');
  } catch (err) {
    mostrarAviso('error', `No pudimos enviar el formulario. Mandanos tu consulta por <a href="${linkWhatsapp(datos)}" target="_blank" rel="noopener">WhatsApp</a> y te respondemos enseguida.`);
  } finally {
    formularioBoton.disabled = false;
    formularioBoton.textContent = 'Enviar pedido';
  }
});

document.getElementById('anio').textContent = new Date().getFullYear();
