// Aires de Jardín — panel de administración
//
// Los datos se guardan en la nube: la API de cloudflare/worker.js
// (https://api.airesdejardin.com.ar) guarda todo el panel como un único JSON
// en una base D1, con contraseña. En este navegador queda además una copia
// (localStorage) por las dudas. Si algún día se pasa a un hosting con PHP,
// alcanza con cambiar `Datos` para que hable con un api.php.
//
// Los documentos se arman como una hoja A4 en HTML y se guardan en PDF con
// "Imprimir → Guardar como PDF".

const CLAVE = 'adj-panel-v1';
const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
const MESES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// ─── Utilidades ───
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = n => String(n).padStart(2, '0');
const n0 = v => Number(v) || 0;
const plata = n => '$ ' + Math.round(n0(n)).toLocaleString('es-AR');
const numero = n => String(n).padStart(4, '0');
const fechaAR = iso => (iso ? iso.split('-').reverse().join('/') : '');
const fechaGuiones = iso => (iso ? iso.split('-').reverse().join('-') : '');
function hoyISO() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function periodoActual() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
function nombrePeriodo(p) { if (!p) return ''; const [a, m] = p.split('-'); return `${MESES[+m - 1]} ${a}`; }
function periodoCorto(p) { if (!p) return ''; const [a, m] = p.split('-'); return `${MESES_CORTO[+m - 1]}-${a.slice(2)}`; }
function periodoAnterior(p) { let [a, m] = p.split('-').map(Number); m--; if (!m) { m = 12; a--; } return `${a}-${pad(m)}`; }

// Número en letras (para "Recibí conforme la suma de ...")
const UNI = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE',
  'DIECISEIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE', 'VEINTIUNO', 'VEINTIDOS', 'VEINTITRES', 'VEINTICUATRO', 'VEINTICINCO',
  'VEINTISEIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
const DEC = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const CEN = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];
function hasta999(n) {
  if (n === 100) return 'CIEN';
  const r = n % 100;
  let s = CEN[Math.floor(n / 100)];
  if (r) s += (s ? ' ' : '') + (r < 30 ? UNI[r] : DEC[Math.floor(r / 10)] + (r % 10 ? ' Y ' + UNI[r % 10] : ''));
  return s;
}
const apocope = s => s.replace(/UNO$/, 'UN');
function enLetras(n) {
  n = Math.floor(Math.abs(n0(n)));
  if (!n) return 'CERO PESOS';
  const millones = Math.floor(n / 1e6), miles = Math.floor((n % 1e6) / 1000), resto = n % 1000;
  const partes = [];
  if (millones) partes.push(millones === 1 ? 'UN MILLON' : apocope(hasta999(millones)) + ' MILLONES');
  if (miles) partes.push(miles === 1 ? 'MIL' : apocope(hasta999(miles)) + ' MIL');
  if (resto) partes.push(hasta999(resto));
  const texto = apocope(partes.join(' '));
  return texto + (!resto && !miles ? ' DE PESOS' : ' PESOS');
}

// Link de WhatsApp a partir de un teléfono argentino como lo carga la gente
function linkWa(tel, texto) {
  let d = String(tel || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('0')) d = d.slice(1);
  if (d.length === 12 && d.startsWith('11') && d.slice(2, 4) === '15') d = '11' + d.slice(4); // 11 15 xxxx-xxxx
  if (d.length === 10) d = '549' + d;
  else if (d.startsWith('54') && !d.startsWith('549')) d = '549' + d.slice(2);
  return `https://wa.me/${d}?text=${encodeURIComponent(texto)}`;
}

// ═══════════════════════════════════════════════════════════
// Datos
// ═══════════════════════════════════════════════════════════
const API = 'https://api.airesdejardin.com.ar';
const CLAVE_SESION = 'adj-sesion';
const leerLocal = k => { try { return localStorage.getItem(k); } catch { return null; } };
const escribirLocal = (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* sin acceso */ } };

const Datos = {
  sesion: leerLocal(CLAVE_SESION),
  version: 0,      // versión del servidor sobre la que estamos trabajando
  enviando: false,
  pendiente: false,
  timer: null,

  async api(metodo, ruta, cuerpo) {
    const r = await fetch(API + ruta, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...(this.sesion ? { Authorization: 'Bearer ' + this.sesion } : {}) },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    const d = await r.json().catch(() => ({ ok: false, error: 'Respuesta inválida del servidor' }));
    if (r.status === 401 && ruta !== '/login' && ruta !== '/clave') { cerrarSesion('La sesión venció. Volvé a ingresar.'); throw new Error(d.error); }
    return { status: r.status, ...d };
  },

  // Se llama después de cada cambio: guarda una copia local y manda todo a la
  // nube (agrupando cambios seguidos en un solo envío)
  guardar() {
    escribirLocal(CLAVE, JSON.stringify(DB));
    this.pendiente = true;
    estadoGuardado('Guardando…', 'guardando');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.enviar(); }, 400);
  },

  async enviar() {
    // Si ya hay un envío en curso, el cambio queda pendiente y se manda al terminar
    if (this.enviando || !this.pendiente) return;
    this.enviando = true; this.pendiente = false;
    try {
      const r = await this.api('PUT', '/datos', { db: DB, version: this.version });
      if (r.ok) { this.version = r.version; estadoGuardado('Guardado ✓', 'ok'); }
      else if (r.conflicto) {
        DB = normalizar(r.db); this.version = r.version;
        estadoGuardado('Guardado ✓', 'ok');
        aviso('Había cambios hechos desde otro dispositivo: se cargó la versión más nueva. Revisá lo último que hiciste.');
        render();
      } else { estadoGuardado('No se pudo guardar: ' + r.error, 'error'); }
    } catch (e) {
      if (this.sesion) {
        this.pendiente = true; estadoGuardado('Sin conexión: reintentando…', 'error');
        this.timer = setTimeout(() => { this.timer = null; this.enviar(); }, 5000);
      }
    } finally {
      this.enviando = false;
      if (this.pendiente && !this.timer) this.enviar();
    }
  },
};
// Avisar si se cierra la pestaña con cambios sin subir
window.addEventListener('beforeunload', e => { if (Datos.pendiente || Datos.enviando) { e.preventDefault(); e.returnValue = ''; } });

function estadoGuardado(texto, tipo) {
  const el = $('#estadoGuardado');
  if (el) { el.textContent = texto; el.dataset.tipo = tipo; }
}

function ajustesBase() {
  return {
    celular: '(+54 11) 15 3113-9061',
    email: 'airesdejardin@outlook.com.ar',
    direccion: 'Lisandro de la Torre 1238 (1611) Don Torcuato',
    cbu: '0110615820061500452375',
    banco: 'Banco Nación Argentina',
    servicio: 'SERV. DE MANTENIMIENTO',
    leyendaIva: '** LOS VALORES NO INCLUYEN IVA',
    validezPresupuesto: 15,
  };
}

function datosVacios() {
  return { demo: false, clientes: [], presupuestos: [], facturas: [], ordenes: [], empleados: [], recibos: [], cobros: [], ajustes: ajustesBase(), contadores: { P: 1, X: 1, OC: 1, R: 1 } };
}

function datosEjemplo() {
  const d = datosVacios();
  d.demo = true;
  d.clientes = [
    { id: 'c1', tipo: 'particular', nombre: 'Sofía', barrio: 'San Andrés', lote: '54', telefono: '', email: '', direccion: '', abono: 400000, notas: 'Datos tomados de la factura de agosto.' },
    { id: 'c2', tipo: 'particular', nombre: 'Martín Pereyra (ejemplo)', barrio: 'Nordelta · Los Castores', lote: '112', telefono: '11 5555-0101', email: 'martin@ejemplo.com', direccion: '', abono: 350000, notas: 'Cliente inventado para probar el panel.' },
    { id: 'c3', tipo: 'empresa', nombre: 'DER Distribuciones', barrio: '', lote: '', telefono: '', email: '', direccion: 'Panamericana Colectora Este 27887, Don Torcuato', abono: 0, notas: '' },
    { id: 'c4', tipo: 'empresa', nombre: 'Tubos Argentinos', barrio: '', lote: '', telefono: '', email: '', direccion: 'Marcos Sastre 698, El Talar', abono: 0, notas: '' },
  ];
  d.facturas = [
    { id: 'f1', numero: 1, clienteId: 'c1', cliente: { nombre: 'Sofía', barrio: 'San Andrés', lote: '54' }, fecha: '2026-08-28', periodo: '2026-08',
      items: [
        { dia: '2026-08-28', detalle: 'Mantenimiento integral de jardín', importe: 400000, insumo: false },
        { dia: '', detalle: 'Productos de fumigación: imida / aceite veg. / BM selectivo', importe: 35000, insumo: true },
      ], nota: '', estado: 'pendiente' },
    { id: 'f2', numero: 2, clienteId: 'c2', cliente: { nombre: 'Martín Pereyra (ejemplo)', barrio: 'Nordelta · Los Castores', lote: '112' }, fecha: '2026-08-30', periodo: '2026-08',
      items: [{ dia: '2026-08-30', detalle: 'Mantenimiento integral de jardín', importe: 350000, insumo: false }], nota: '', estado: 'cobrada', fechaCobro: '2026-09-05' },
  ];
  d.presupuestos = [
    { id: 'p1', numero: 1, clienteId: 'c2', cliente: { nombre: 'Martín Pereyra (ejemplo)', barrio: 'Nordelta · Los Castores', lote: '112' }, fecha: '2026-09-20', validez: 15,
      titulo: 'Puesta a punto de canteros',
      items: [
        { cantidad: 1, detalle: 'Desmalezado, limpieza y perfilado de canteros', precio: 180000, insumo: false },
        { cantidad: 10, detalle: 'Tierra negra (bolsa 50 dm³)', precio: 6500, insumo: true },
        { cantidad: 8, detalle: 'Corteza de pino (bolsa)', precio: 9000, insumo: true },
      ], notas: 'Incluye retiro de residuos verdes.', estado: 'enviado' },
  ];
  d.ordenes = [
    { id: 'o1', numero: 1, proveedor: 'Vivero (ejemplo)', contacto: '', fecha: '2026-09-22', clienteId: 'c2', entrega: 'Retiramos en el vivero',
      items: [
        { cantidad: 1, detalle: 'Olivo en maceta, 2,5 m', precio: 250000 },
        { cantidad: 12, detalle: 'Agapanto en maceta n.º 17', precio: 6000 },
      ], notas: '', estado: 'pendiente' },
  ];
  d.empleados = [
    { id: 'e1', nombre: 'Alejandro Gómez', dni: '', categoria: 'AUX. LIMPIEZA', tarea: 'JARDINERIA', ingreso: '2025-05-10' },
  ];
  d.recibos = [
    { id: 'r1', empleadoId: 'e1', periodo: '2026-08', quincena: 2, ultimoDeposito: 'jul-26', conceptos: conceptosBase({ dias: [13, 650000] }) },
  ];
  d.cobros = [
    { id: 'k1', numero: 1, clienteId: 'c2', cliente: { nombre: 'Martín Pereyra (ejemplo)', barrio: 'Nordelta · Los Castores', lote: '112' }, fecha: '2026-09-05',
      medio: 'Transferencia', referencia: '', aplicaciones: [{ facturaId: 'f2', monto: 350000 }], notas: '' },
  ];
  d.contadores = { P: 2, X: 3, OC: 2, R: 2 };
  return d;
}

// Conceptos fijos del recibo de quincena (como en la planilla)
const CONCEPTOS = [
  { clave: 'dias', nombre: 'Días trabajados' },
  { clave: 'md', nombre: 'MD trabajado', ayuda: 'medio día' },
  { clave: 'feriados', nombre: 'Feriados trabajados' },
  { clave: 'ausencias', nombre: 'Ausencias', resta: true },
  { clave: 'extra', nombre: 'Extra' },
  { clave: 'lluvia', nombre: 'Días de lluvia' },
  { clave: 'extra2', nombre: 'Extra' },
];
function conceptosBase(valores = {}) {
  const c = {};
  CONCEPTOS.forEach(k => { const v = valores[k.clave] || [0, 0]; c[k.clave] = { cantidad: v[0], monto: v[1] }; });
  return c;
}

// Completa lo que falte si los datos vienen de una versión anterior del panel
function normalizar(datos) {
  const d = Object.assign(datosVacios(), datos);
  d.ajustes = Object.assign(ajustesBase(), d.ajustes);
  d.contadores = Object.assign({ P: 1, X: 1, OC: 1, R: 1 }, d.contadores);
  return d;
}
let DB = datosVacios();

// ─── Cálculos ───
const totalFactura = f => f.items.reduce((s, i) => s + n0(i.importe), 0);
const totalConCantidad = d => d.items.reduce((s, i) => s + n0(i.cantidad) * n0(i.precio), 0);
const totalRecibo = r => CONCEPTOS.reduce((s, k) => s + (k.resta ? -1 : 1) * n0(r.conceptos[k.clave]?.monto), 0);
const cliente = id => DB.clientes.find(c => c.id === id);
const empleado = id => DB.empleados.find(e => e.id === id);
// Cobros: cada recibo se aplica a una o varias facturas (se aceptan pagos parciales)
const totalCobro = k => k.aplicaciones.reduce((s, a) => s + n0(a.monto), 0);
function cobradoFactura(f, salvoCobroId) {
  return DB.cobros.filter(k => k.id !== salvoCobroId).reduce((s, k) => s + k.aplicaciones.filter(a => a.facturaId === f.id).reduce((t, a) => t + n0(a.monto), 0), 0);
}
// Una factura marcada "cobrada" a mano (sin recibo) no tiene saldo
const saldoFactura = (f, salvoCobroId) => (f.estado === 'cobrada' ? 0 : Math.max(0, totalFactura(f) - cobradoFactura(f, salvoCobroId)));
const estadoFactura = f => (saldoFactura(f) <= 0 ? 'cobrada' : cobradoFactura(f) > 0 ? 'parcial' : 'pendiente');
// Después de guardar o borrar un recibo, cada factura tocada vuelve a calcular si quedó cobrada
function actualizarEstadoFacturas(ids) {
  ids.forEach(id => {
    const f = DB.facturas.find(x => x.id === id);
    if (f) f.estado = cobradoFactura(f) >= totalFactura(f) && totalFactura(f) > 0 ? 'cobrada' : 'pendiente';
  });
}
function pendienteCliente(id) {
  return DB.facturas.filter(f => f.clienteId === id).reduce((s, f) => s + saldoFactura(f), 0);
}
function siguienteNumero(tipo) { const n = DB.contadores[tipo] || 1; DB.contadores[tipo] = n + 1; return n; }

const ESTADOS = {
  presupuesto: { borrador: ['Borrador', 'gris'], enviado: ['Enviado', 'azul'], aceptado: ['Aceptado', 'verde'], rechazado: ['Rechazado', 'rojo'] },
  factura: { pendiente: ['Pendiente de cobro', 'ambar'], parcial: ['Cobro parcial', 'azul'], cobrada: ['Cobrada', 'verde'] },
  orden: { pendiente: ['Pendiente', 'ambar'], recibida: ['Recibida', 'verde'] },
};
const chipEstado = (tipo, e) => { const [t, c] = ESTADOS[tipo][e] || [e, 'gris']; return `<span class="estado estado--${c}">${t}</span>`; };

// ═══════════════════════════════════════════════════════════
// Interfaz general: aviso, diálogo, navegación
// ═══════════════════════════════════════════════════════════
const vista = $('#vista');
let avisoTimer;
function aviso(texto) {
  const t = $('#toast');
  t.textContent = texto;
  t.hidden = false;
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

function dialogo(html, alAbrir) {
  const d = $('#dialogo');
  $('#dialogoCaja').innerHTML = html;
  d.hidden = false;
  const cerrar = () => { d.hidden = true; };
  $$('[data-cerrar]', d).forEach(b => b.addEventListener('click', cerrar));
  if (alAbrir) alAbrir(d, cerrar);
  return cerrar;
}
function confirmar(titulo, texto, textoBoton, alConfirmar, peligro) {
  dialogo(`<h2>${titulo}</h2><p>${texto}</p>
    <div class="dialogo__botones"><button class="btn btn--secundario" data-cerrar>Cancelar</button>
    <button class="btn ${peligro ? 'btn--oscuro' : ''}" data-ok>${textoBoton}</button></div>`,
  (d, cerrar) => $('[data-ok]', d).addEventListener('click', () => { cerrar(); alConfirmar(); }));
}

const ir = ruta => { location.hash = ruta; };
function rutaActual() {
  const [camino, consulta = ''] = location.hash.slice(1).split('?');
  const [seccion = 'inicio', id] = camino.split('/');
  return { seccion: seccion || 'inicio', id, params: new URLSearchParams(consulta) };
}
const SECCION_MENU = { cliente: 'clientes', 'cliente-editar': 'clientes', presupuesto: 'presupuestos', factura: 'facturas', cobro: 'cobros', orden: 'ordenes', empleado: 'personal', recibo: 'personal' };

function render() {
  const { seccion, id, params } = rutaActual();
  const menu = SECCION_MENU[seccion] || seccion;
  $$('#menu a').forEach(a => a.classList.toggle('activo', a.dataset.seccion === menu));
  $('#lateral').classList.remove('abierto');
  $('#avisoDemo').hidden = !DB.demo;
  $('#avisoDemo').textContent = 'Hay datos de ejemplo cargados. Cuando empieces a usarlo en serio, borralos desde Ajustes.';
  actualizarContadorPedidos();

  const vistas = {
    inicio: vistaInicio,
    clientes: vistaClientes,
    cliente: () => vistaFichaCliente(id),
    'cliente-editar': () => editorCliente(id, params),
    pedidos: vistaPedidos,
    carrusel: vistaCarrusel,
    presupuestos: vistaPresupuestos,
    presupuesto: () => editorPresupuesto(id, params),
    facturas: vistaFacturas,
    factura: () => editorFactura(id, params),
    cobros: vistaCobros,
    cobro: () => editorCobro(id, params),
    ordenes: vistaOrdenes,
    orden: () => editorOrden(id, params),
    personal: vistaPersonal,
    empleado: () => editorEmpleado(id),
    recibo: () => editorRecibo(id, params),
    ajustes: vistaAjustes,
  };
  (vistas[seccion] || vistaInicio)();
  window.scrollTo(0, 0);
}

// Clic en cualquier elemento con data-ir navega
vista.addEventListener('click', e => {
  const el = e.target.closest('[data-ir]');
  if (el && !e.target.closest('button:not([data-ir]), a:not([data-ir])')) ir(el.dataset.ir);
});
$('#abrirMenu').addEventListener('click', () => $('#lateral').classList.toggle('abierto'));

// ─── Bloques comunes ───
function cabecera(titulo, subtitulo = '', acciones = '', volver = '') {
  return `${volver ? `<a class="volver" href="${volver[0]}">← ${volver[1]}</a>` : ''}
    <div class="cabecera"><div><h1>${titulo}</h1>${subtitulo ? `<p>${subtitulo}</p>` : ''}</div>
    <div class="cabecera__acciones">${acciones}</div></div>`;
}

function opcionesClientes(sel) {
  return `<option value="">— Sin ficha (escribir los datos) —</option>` +
    [...DB.clientes].sort((a, b) => a.nombre.localeCompare(b.nombre))
      .map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.nombre)}${c.barrio ? ' · ' + esc(c.barrio) : ''}${c.lote ? ' lote ' + esc(c.lote) : ''}</option>`).join('');
}
function opcionesPeriodo(sel) {
  const [a] = (sel || periodoActual()).split('-').map(Number);
  let html = '';
  for (let anio = a + 1; anio >= a - 1; anio--) {
    for (let m = 12; m >= 1; m--) { const p = `${anio}-${pad(m)}`; html += `<option value="${p}" ${p === sel ? 'selected' : ''}>${MESES[m - 1]} ${anio}</option>`; }
  }
  return html;
}

// Editor de renglones reutilizable (presupuesto, factura, orden de compra)
function montarRenglones(cont, items, columnas, subtotal, alCambiar) {
  const celda = (c, it) => {
    const v = it[c.campo];
    if (c.tipo === 'check') return `<td class="r-chk"><input type="checkbox" name="${c.campo}" ${v ? 'checked' : ''} title="${c.titulo}"></td>`;
    const tipo = c.tipo === 'numero' ? 'number' : c.tipo === 'fecha' ? 'date' : 'text';
    const extra = c.tipo === 'numero' ? 'min="0" step="any" inputmode="decimal"' : '';
    return `<td class="r-${c.campo === 'detalle' ? 'det' : c.tipo === 'numero' ? 'num' : c.campo}"><input type="${tipo}" name="${c.campo}" value="${esc(v ?? '')}" placeholder="${c.ejemplo || ''}" ${extra}></td>`;
  };
  function dibujar() {
    cont.innerHTML = `<div class="tabla-envoltura"><table class="renglones"><thead><tr>
      ${columnas.map(c => `<th style="width:${c.ancho || 'auto'}">${c.titulo}</th>`).join('')}
      ${subtotal ? '<th class="r-total" style="width:120px">Subtotal</th>' : ''}<th style="width:44px"></th></tr></thead>
      <tbody>${items.map((it, i) => `<tr data-i="${i}" class="${it.insumo ? 'insumo' : ''}">${columnas.map(c => celda(c, it)).join('')}
        ${subtotal ? `<td class="r-total">${plata(subtotal(it))}</td>` : ''}
        <td><button type="button" class="btn btn--peligro btn--icono" data-quitar title="Quitar renglón">✕</button></td></tr>`).join('')}</tbody></table></div>
      <button type="button" class="btn btn--secundario btn--chico" data-agregar style="margin-top:10px">+ Agregar renglón</button>`;
  }
  const actualizar = e => {
    const tr = e.target.closest('tr[data-i]');
    if (!tr || !e.target.name) return;
    const it = items[+tr.dataset.i];
    const col = columnas.find(c => c.campo === e.target.name);
    it[e.target.name] = col.tipo === 'check' ? e.target.checked : col.tipo === 'numero' ? n0(e.target.value) : e.target.value;
    if (col.tipo === 'check') tr.classList.toggle('insumo', !!it.insumo);
    if (subtotal) $('.r-total', tr).textContent = plata(subtotal(it));
    alCambiar();
  };
  cont.addEventListener('input', actualizar);
  cont.addEventListener('change', e => { if (e.target.type === 'checkbox') actualizar(e); });
  cont.addEventListener('click', e => {
    if (e.target.closest('[data-agregar]')) {
      const nuevo = {}; columnas.forEach(c => { nuevo[c.campo] = c.tipo === 'check' ? false : c.tipo === 'numero' ? (c.campo === 'cantidad' ? 1 : 0) : ''; });
      items.push(nuevo); dibujar(); alCambiar();
      const filas = $$('tr[data-i]', cont); $('input[name="detalle"]', filas[filas.length - 1])?.focus();
    }
    const q = e.target.closest('[data-quitar]');
    if (q) { items.splice(+q.closest('tr').dataset.i, 1); dibujar(); alCambiar(); }
  });
  dibujar();
}

// Campos de cliente dentro de un documento: elegir de la lista o escribir
function bloqueCliente(doc, extraHtml = '') {
  return `<div class="campos">
    <label class="campo campo--2"><span>Cliente</span><select name="clienteId">${opcionesClientes(doc.clienteId)}</select></label>
    <label class="campo"><span>Nombre en el documento</span><input name="c_nombre" value="${esc(doc.cliente?.nombre)}" required></label>
    <label class="campo"><span>Barrio</span><input name="c_barrio" value="${esc(doc.cliente?.barrio)}"></label>
    <label class="campo"><span>Lote</span><input name="c_lote" value="${esc(doc.cliente?.lote)}"></label>
    ${extraHtml}
  </div>`;
}
function enlazarCliente(form) {
  form.clienteId.addEventListener('change', () => {
    const c = cliente(form.clienteId.value);
    if (!c) return;
    form.c_nombre.value = c.nombre; form.c_barrio.value = c.barrio || ''; form.c_lote.value = c.lote || '';
  });
}
const leerCliente = form => ({ nombre: form.c_nombre.value.trim(), barrio: form.c_barrio.value.trim(), lote: form.c_lote.value.trim() });

// ═══════════════════════════════════════════════════════════
// Inicio
// ═══════════════════════════════════════════════════════════
function todosLosDocumentos() {
  return [
    ...DB.presupuestos.map(p => ({ tipo: 'P', titulo: 'Presupuesto', id: p.id, numero: p.numero, fecha: p.fecha, quien: p.cliente?.nombre, clienteId: p.clienteId, total: totalConCantidad(p), estado: chipEstado('presupuesto', p.estado), ruta: `presupuesto/${p.id}` })),
    ...DB.facturas.map(f => ({ tipo: 'X', titulo: 'Factura X', id: f.id, numero: f.numero, fecha: f.fecha, quien: f.cliente?.nombre, clienteId: f.clienteId, total: totalFactura(f), estado: chipEstado('factura', estadoFactura(f)), ruta: `factura/${f.id}` })),
    ...DB.cobros.map(k => ({ tipo: 'R', titulo: 'Recibo de cobro', id: k.id, numero: k.numero, fecha: k.fecha, quien: k.cliente?.nombre, clienteId: k.clienteId, total: totalCobro(k), estado: `<span class="estado estado--verde">${esc(k.medio)}</span>`, ruta: `cobro/${k.id}` })),
    ...DB.ordenes.map(o => ({ tipo: 'OC', titulo: 'Orden de compra', id: o.id, numero: o.numero, fecha: o.fecha, quien: o.proveedor, clienteId: o.clienteId, total: totalConCantidad(o), estado: chipEstado('orden', o.estado), ruta: `orden/${o.id}` })),
  ].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || b.numero - a.numero);
}
const TIPO_DOC = { P: 'presupuesto', X: 'factura', OC: 'orden', R: 'cobro' };

function filaDocumento(d, conQuien = true) {
  return `<tr class="clic" data-ir="${d.ruta}">
    <td><span class="tipo tipo--${d.tipo}">${d.tipo}</span></td>
    <td>Nº ${numero(d.numero)}<span class="sub">${d.titulo}</span></td>
    <td>${fechaAR(d.fecha)}</td>
    ${conQuien ? `<td>${esc(d.quien)}</td>` : ''}
    <td class="num">${plata(d.total)}</td>
    <td>${d.estado}</td>
    <td class="acciones"><button class="btn btn--secundario btn--chico" data-ver="${d.tipo}:${d.id}">Ver</button></td></tr>`;
}
function enlazarVer(raiz) {
  $$('[data-ver]', raiz).forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const [tipo, id] = b.dataset.ver.split(':');
    abrirDocumento(TIPO_DOC[tipo] || tipo, id);
  }));
}

function vistaInicio() {
  const per = periodoActual();
  const delMes = DB.facturas.filter(f => f.periodo === per);
  const pendientes = DB.facturas.filter(f => saldoFactura(f) > 0);
  const abiertos = DB.presupuestos.filter(p => p.estado === 'borrador' || p.estado === 'enviado');
  const ocPend = DB.ordenes.filter(o => o.estado === 'pendiente');
  const docs = todosLosDocumentos().slice(0, 8);

  vista.innerHTML = cabecera('Hola 👋', `Resumen de ${nombrePeriodo(per).toLowerCase()}`, `<a class="btn" href="#factura/nuevo">+ Nueva factura</a>`) + `
    <div class="indicadores">
      <div class="indicador indicador--destacado"><div class="indicador__etiqueta">Facturado este mes</div><div class="indicador__valor">${plata(delMes.reduce((s, f) => s + totalFactura(f), 0))}</div><div class="indicador__detalle">${delMes.length} factura(s)</div></div>
      <div class="indicador"><div class="indicador__etiqueta">Pendiente de cobro</div><div class="indicador__valor">${plata(pendientes.reduce((s, f) => s + saldoFactura(f), 0))}</div><div class="indicador__detalle">${pendientes.length} factura(s) sin cobrar</div></div>
      <div class="indicador"><div class="indicador__etiqueta">Presupuestos abiertos</div><div class="indicador__valor">${abiertos.length}</div><div class="indicador__detalle">por ${plata(abiertos.reduce((s, p) => s + totalConCantidad(p), 0))}</div></div>
      <div class="indicador"><div class="indicador__etiqueta">Órdenes de compra</div><div class="indicador__valor">${ocPend.length}</div><div class="indicador__detalle">pendientes de recibir</div></div>
    </div>
    <div class="rejilla-2">
      <section class="tarjeta">
        <div class="tarjeta__titulo"><h2>Últimos documentos</h2></div>
        <div class="tabla-envoltura"><table class="tabla"><thead><tr><th></th><th>Número</th><th>Fecha</th><th>Cliente / proveedor</th><th class="num">Total</th><th>Estado</th><th></th></tr></thead>
        <tbody>${docs.map(d => filaDocumento(d)).join('') || '<tr><td colspan="7" class="vacio">Todavía no hay documentos.</td></tr>'}</tbody></table></div>
      </section>
      <section class="tarjeta">
        <div class="tarjeta__titulo"><h2>Accesos rápidos</h2></div>
        <div class="accesos">
          <a class="acceso" href="#presupuesto/nuevo"><strong>Presupuesto</strong><span>Armar uno nuevo</span></a>
          <a class="acceso" href="#factura/nuevo"><strong>Factura X</strong><span>Comprobante del mes</span></a>
          <a class="acceso" href="#facturas" data-generar><strong>Facturas del mes</strong><span>Todas las de abono juntas</span></a>
          <a class="acceso" href="#cobro/nuevo"><strong>Recibo de cobro</strong><span>Registrar un pago</span></a>
          <a class="acceso" href="#orden/nuevo"><strong>Orden de compra</strong><span>Pedido a proveedor</span></a>
          <a class="acceso" href="#recibo/nuevo"><strong>Recibo de quincena</strong><span>Pago al personal</span></a>
          <a class="acceso" href="#cliente-editar/nuevo"><strong>Cliente</strong><span>Cargar una ficha</span></a>
        </div>
      </section>
    </div>`;
  enlazarVer(vista);
  $('[data-generar]', vista).addEventListener('click', e => { e.preventDefault(); generarFacturasDelMes(); });
}

// ═══════════════════════════════════════════════════════════
// Clientes
// ═══════════════════════════════════════════════════════════
function vistaClientes() {
  vista.innerHTML = cabecera('Clientes', `${DB.clientes.length} cliente(s)`, `<a class="btn" href="#cliente-editar/nuevo">+ Nuevo cliente</a>`) + `
    <section class="tarjeta">
      <div class="filtros"><input type="search" id="buscar" placeholder="Buscar por nombre, barrio o lote…"></div>
      <div class="tabla-envoltura"><table class="tabla"><thead><tr><th>Cliente</th><th>Barrio / lote</th><th>Teléfono</th><th class="num">Abono mensual</th><th class="num">Pendiente de cobro</th><th></th></tr></thead>
      <tbody id="filas"></tbody></table></div>
    </section>`;
  const dibujar = () => {
    const q = $('#buscar').value.trim().toLowerCase();
    const lista = DB.clientes.filter(c => !q || [c.nombre, c.barrio, c.lote].join(' ').toLowerCase().includes(q))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
    $('#filas').innerHTML = lista.map(c => {
      const pend = pendienteCliente(c.id);
      return `<tr class="clic" data-ir="cliente/${c.id}">
        <td><strong>${esc(c.nombre)}</strong><span class="sub">${c.tipo === 'empresa' ? 'Empresa' : 'Particular'}</span></td>
        <td>${esc(c.barrio) || '—'}${c.lote ? `<span class="sub">Lote ${esc(c.lote)}</span>` : ''}</td>
        <td>${esc(c.telefono) || '—'}</td>
        <td class="num">${c.abono ? plata(c.abono) : '—'}</td>
        <td class="num">${pend ? `<span class="estado estado--ambar">${plata(pend)}</span>` : '—'}</td>
        <td class="acciones"><a class="btn btn--secundario btn--chico" href="#cliente/${c.id}">Ficha</a></td></tr>`;
    }).join('') || '<tr><td colspan="6" class="vacio">No hay clientes que coincidan.</td></tr>';
  };
  $('#buscar').addEventListener('input', dibujar);
  dibujar();
}

function vistaFichaCliente(id) {
  const c = cliente(id);
  if (!c) { ir('clientes'); return; }
  const docs = todosLosDocumentos().filter(d => d.clienteId === id);
  const facturas = DB.facturas.filter(f => f.clienteId === id);
  const facturado = facturas.reduce((s, f) => s + totalFactura(f), 0);
  const cobros = DB.cobros.filter(k => k.clienteId === id);
  const pendiente = pendienteCliente(id);
  const wa = linkWa(c.telefono, `Hola ${c.nombre.split(' ')[0]}, te escribimos de Aires de Jardín.`);

  vista.innerHTML = cabecera(esc(c.nombre), [c.barrio, c.lote && 'lote ' + c.lote].filter(Boolean).map(esc).join(' · ') || (c.tipo === 'empresa' ? 'Empresa' : ''),
    `<a class="btn btn--secundario" href="#presupuesto/nuevo?cliente=${id}">+ Presupuesto</a>
     <a class="btn btn--secundario" href="#orden/nuevo?cliente=${id}">+ Orden de compra</a>
     <a class="btn btn--secundario" href="#factura/nuevo?cliente=${id}">+ Factura X</a>
     <a class="btn" href="#cobro/nuevo?cliente=${id}">+ Recibo de cobro</a>`, ['#clientes', 'Clientes']) + `
    <div class="ficha">
      <section class="tarjeta ficha__datos">
        <div class="tarjeta__titulo"><div class="ficha__avatar">${esc(c.nombre.charAt(0))}</div><a class="btn btn--secundario btn--chico" href="#cliente-editar/${id}">Editar datos</a></div>
        <dl>
          <div><dt>Tipo</dt><dd>${c.tipo === 'empresa' ? 'Empresa' : 'Particular'}</dd></div>
          <div><dt>Barrio y lote</dt><dd>${esc(c.barrio) || '—'}${c.lote ? ', lote ' + esc(c.lote) : ''}</dd></div>
          <div><dt>Teléfono</dt><dd>${esc(c.telefono) || '—'} ${wa ? `· <a href="${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</dd></div>
          <div><dt>Email</dt><dd>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '—'}</dd></div>
          <div><dt>Dirección</dt><dd>${esc(c.direccion) || '—'}</dd></div>
          <div><dt>Abono mensual</dt><dd>${c.abono ? plata(c.abono) : 'Sin abono fijo'}</dd></div>
          ${c.notas ? `<div><dt>Notas</dt><dd>${esc(c.notas)}</dd></div>` : ''}
        </dl>
      </section>
      <div>
        <div class="ficha__saldo">
          <div class="indicador"><div class="indicador__etiqueta">Facturado</div><div class="indicador__valor">${plata(facturado)}</div><div class="indicador__detalle">${facturas.length} factura(s)</div></div>
          <div class="indicador"><div class="indicador__etiqueta">Cobrado</div><div class="indicador__valor">${plata(facturado - pendiente)}</div><div class="indicador__detalle">${cobros.length} recibo(s)</div></div>
          <div class="indicador ${pendiente ? 'indicador--destacado' : ''}"><div class="indicador__etiqueta">Pendiente</div><div class="indicador__valor">${plata(pendiente)}</div></div>
        </div>
        <section class="tarjeta">
          <div class="tarjeta__titulo"><h2>Documentos</h2></div>
          <div class="pestanas" id="pestanas">
            <button class="pestana activa" data-f="">Todos (${docs.length})</button>
            <button class="pestana" data-f="P">Presupuestos (${docs.filter(d => d.tipo === 'P').length})</button>
            <button class="pestana" data-f="X">Facturas (${docs.filter(d => d.tipo === 'X').length})</button>
            <button class="pestana" data-f="R">Recibos (${docs.filter(d => d.tipo === 'R').length})</button>
            <button class="pestana" data-f="OC">Órdenes de compra (${docs.filter(d => d.tipo === 'OC').length})</button>
          </div>
          <div class="tabla-envoltura"><table class="tabla"><thead><tr><th></th><th>Número</th><th>Fecha</th><th class="num">Total</th><th>Estado</th><th></th></tr></thead>
          <tbody id="docsCliente"></tbody></table></div>
        </section>
      </div>
    </div>`;
  const dibujar = f => {
    const lista = docs.filter(d => !f || d.tipo === f);
    $('#docsCliente').innerHTML = lista.map(d => filaDocumento(d, false)).join('') || '<tr><td colspan="6" class="vacio">Sin documentos todavía.</td></tr>';
    enlazarVer($('#docsCliente'));
  };
  $$('.pestana', vista).forEach(p => p.addEventListener('click', () => {
    $$('.pestana', vista).forEach(x => x.classList.toggle('activa', x === p)); dibujar(p.dataset.f);
  }));
  dibujar('');
}

function editorCliente(id, params) {
  const nuevo = id === 'nuevo';
  const pedido = nuevo ? PEDIDOS.find(x => x.id === params?.get('pedido')) : null;
  const c = nuevo ? { tipo: 'particular', nombre: pedido?.nombre || '', barrio: pedido?.barrio || '', lote: pedido?.lote || '', telefono: pedido?.telefono || '',
    email: pedido?.email || '', direccion: '', abono: 0, notas: pedido ? `Llegó por la web (${fechaAR(pedido.fecha.slice(0, 10))}). ${pedido.servicio ? 'Servicio: ' + pedido.servicio + '. ' : ''}${pedido.mensaje || ''}`.trim() : '' } : cliente(id);
  if (!c) { ir('clientes'); return; }
  vista.innerHTML = cabecera(nuevo ? 'Nuevo cliente' : 'Editar cliente', 'Cada cliente se identifica por barrio + lote.', '',
    nuevo ? ['#clientes', 'Clientes'] : [`#cliente/${id}`, c.nombre]) + `
    <form class="tarjeta" id="form">
      <div class="campos">
        <label class="campo campo--2"><span>Nombre y apellido / razón social</span><input name="nombre" value="${esc(c.nombre)}" required></label>
        <label class="campo"><span>Tipo</span><select name="tipo"><option value="particular" ${c.tipo !== 'empresa' ? 'selected' : ''}>Particular</option><option value="empresa" ${c.tipo === 'empresa' ? 'selected' : ''}>Empresa</option></select></label>
        <label class="campo"><span>Abono mensual ($)</span><input name="abono" type="number" min="0" step="any" value="${c.abono || ''}" placeholder="0 = sin abono"></label>
        <label class="campo campo--2"><span>Barrio</span><input name="barrio" value="${esc(c.barrio)}" placeholder="Ej.: Nordelta · Los Castores"></label>
        <label class="campo"><span>Lote</span><input name="lote" value="${esc(c.lote)}"></label>
        <label class="campo"><span>Teléfono / WhatsApp</span><input name="telefono" value="${esc(c.telefono)}" placeholder="11 1234-5678"></label>
        <label class="campo campo--2"><span>Email</span><input name="email" type="email" value="${esc(c.email)}"></label>
        <label class="campo campo--2"><span>Dirección</span><input name="direccion" value="${esc(c.direccion)}"></label>
        <label class="campo campo--4"><span>Notas</span><textarea name="notas">${esc(c.notas)}</textarea></label>
      </div>
      <div class="pie-form">
        ${!nuevo ? '<button type="button" class="btn btn--peligro" id="borrar">Borrar cliente</button>' : ''}
        <a class="btn btn--secundario" href="${nuevo ? '#clientes' : '#cliente/' + id}">Cancelar</a>
        <button class="btn">Guardar</button>
      </div>
    </form>`;
  const form = $('#form');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const datos = Object.fromEntries(new FormData(form));
    Object.keys(datos).forEach(k => { datos[k] = datos[k].trim(); });
    datos.abono = n0(datos.abono);
    if (nuevo) { datos.id = uid(); DB.clientes.push(datos); } else Object.assign(c, datos);
    Datos.guardar(); aviso('Cliente guardado'); ir(`cliente/${nuevo ? datos.id : id}`);
    if (pedido) cambiarEstadoPedido(pedido.id, 'cliente', datos.id);
  });
  $('#borrar')?.addEventListener('click', () => {
    const tiene = todosLosDocumentos().some(d => d.clienteId === id);
    confirmar('¿Borrar este cliente?', tiene ? 'Tiene documentos: esos documentos se conservan, pero quedan sin ficha.' : 'Esta acción no se puede deshacer.', 'Borrar', () => {
      DB.clientes = DB.clientes.filter(x => x.id !== id); Datos.guardar(); aviso('Cliente borrado'); ir('clientes');
    }, true);
  });
}

// ═══════════════════════════════════════════════════════════
// Presupuestos
// ═══════════════════════════════════════════════════════════
function vistaPresupuestos() {
  vista.innerHTML = cabecera('Presupuestos', 'Se convierten en factura X con un clic cuando el cliente acepta.', `<a class="btn" href="#presupuesto/nuevo">+ Nuevo presupuesto</a>`) + `
    <section class="tarjeta">
      <div class="filtros"><input type="search" id="buscar" placeholder="Buscar cliente…">
        <select id="estado"><option value="">Todos los estados</option>${Object.entries(ESTADOS.presupuesto).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join('')}</select></div>
      <div class="tabla-envoltura"><table class="tabla"><thead><tr><th>Número</th><th>Fecha</th><th>Cliente</th><th class="num">Total</th><th>Estado</th><th></th></tr></thead><tbody id="filas"></tbody></table></div>
    </section>`;
  const dibujar = () => {
    const q = $('#buscar').value.trim().toLowerCase(), est = $('#estado').value;
    const lista = DB.presupuestos.filter(p => (!est || p.estado === est) && (!q || JSON.stringify(p.cliente).toLowerCase().includes(q)))
      .sort((a, b) => b.numero - a.numero);
    $('#filas').innerHTML = lista.map(p => `<tr class="clic" data-ir="presupuesto/${p.id}">
      <td><strong>Nº ${numero(p.numero)}</strong>${p.titulo ? `<span class="sub">${esc(p.titulo)}</span>` : ''}</td>
      <td>${fechaAR(p.fecha)}</td><td>${esc(p.cliente?.nombre)}<span class="sub">${esc(p.cliente?.barrio)}${p.cliente?.lote ? ' · lote ' + esc(p.cliente.lote) : ''}</span></td>
      <td class="num">${plata(totalConCantidad(p))}</td><td>${chipEstado('presupuesto', p.estado)}</td>
      <td class="acciones">${!p.facturaId ? `<button class="btn btn--secundario btn--chico" data-convertir="${p.id}">→ Factura</button> ` : ''}<button class="btn btn--secundario btn--chico" data-ver="P:${p.id}">Ver</button></td></tr>`).join('')
      || '<tr><td colspan="6" class="vacio">No hay presupuestos.</td></tr>';
    enlazarVer(vista);
    $$('[data-convertir]', vista).forEach(b => b.addEventListener('click', e => { e.stopPropagation(); convertirEnFactura(b.dataset.convertir); }));
  };
  $('#buscar').addEventListener('input', dibujar); $('#estado').addEventListener('change', dibujar);
  dibujar();
}

function editorPresupuesto(id, params) {
  const nuevo = id === 'nuevo';
  let p;
  if (nuevo) {
    const c = cliente(params.get('cliente'));
    p = { clienteId: c?.id || '', cliente: { nombre: c?.nombre || '', barrio: c?.barrio || '', lote: c?.lote || '' }, fecha: hoyISO(), validez: DB.ajustes.validezPresupuesto,
      titulo: '', items: [{ cantidad: 1, detalle: '', precio: 0, insumo: false }], notas: '', estado: 'borrador' };
  } else {
    const orig = DB.presupuestos.find(x => x.id === id);
    if (!orig) { ir('presupuestos'); return; }
    p = structuredClone(orig);
  }
  vista.innerHTML = cabecera(nuevo ? 'Nuevo presupuesto' : `Presupuesto Nº ${numero(p.numero)}`, p.facturaId ? 'Ya se convirtió en factura.' : '',
    !nuevo ? `<button class="btn btn--secundario" id="verDoc">Ver documento</button>${!p.facturaId ? '<button class="btn btn--oscuro" id="convertir">Convertir en factura X</button>' : `<a class="btn btn--secundario" href="#factura/${p.facturaId}">Ir a la factura</a>`}` : '',
    ['#presupuestos', 'Presupuestos']) + `
    <form id="form">
      <section class="tarjeta">
        <div class="tarjeta__titulo"><h2>Datos</h2></div>
        ${bloqueCliente(p, `
          <label class="campo"><span>Fecha</span><input type="date" name="fecha" value="${p.fecha}" required></label>
          <label class="campo"><span>Validez (días)</span><input type="number" name="validez" min="1" value="${p.validez}"></label>
          <label class="campo"><span>Estado</span><select name="estado">${Object.entries(ESTADOS.presupuesto).map(([k, v]) => `<option value="${k}" ${p.estado === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></label>
          <label class="campo campo--4"><span>Título del trabajo (opcional)</span><input name="titulo" value="${esc(p.titulo)}" placeholder="Ej.: Puesta a punto de canteros"></label>`)}
      </section>
      <section class="tarjeta">
        <div class="tarjeta__titulo"><h2>Detalle</h2><span class="ayuda">Tildá "Insumo" para que el renglón salga en rojo.</span></div>
        <div id="renglones"></div>
        <div class="totales"><span class="ayuda">Los valores no incluyen IVA.</span><div class="totales__monto"><small>TOTAL</small><span id="total"></span></div></div>
      </section>
      <section class="tarjeta">
        <label class="campo"><span>Observaciones / condiciones</span><textarea name="notas" placeholder="Forma de pago, plazos, qué incluye…">${esc(p.notas)}</textarea></label>
      </section>
      <div class="pie-form">
        ${!nuevo ? '<button type="button" class="btn btn--peligro" id="borrar">Borrar</button>' : ''}
        <a class="btn btn--secundario" href="#presupuestos">Cancelar</a>
        <button type="button" class="btn btn--secundario" id="guardarVer">Guardar y ver</button>
        <button class="btn">Guardar</button>
      </div>
    </form>`;
  const form = $('#form');
  enlazarCliente(form);
  const totalEl = $('#total');
  const recalcular = () => { totalEl.textContent = plata(totalConCantidad(p)); };
  montarRenglones($('#renglones'), p.items, [
    { campo: 'cantidad', titulo: 'Cant.', tipo: 'numero', ancho: '80px' },
    { campo: 'detalle', titulo: 'Detalle', ejemplo: 'Ej.: Corte de césped y bordeado' },
    { campo: 'precio', titulo: 'Precio unit. ($)', tipo: 'numero', ancho: '140px' },
    { campo: 'insumo', titulo: 'Insumo', tipo: 'check', ancho: '60px' },
  ], it => n0(it.cantidad) * n0(it.precio), recalcular);
  recalcular();

  const guardar = (ver) => {
    if (!form.reportValidity()) return;
    Object.assign(p, { clienteId: form.clienteId.value, cliente: leerCliente(form), fecha: form.fecha.value, validez: n0(form.validez.value),
      estado: form.estado.value, titulo: form.titulo.value.trim(), notas: form.notas.value.trim(), items: p.items.filter(i => i.detalle.trim() || n0(i.precio)) });
    if (nuevo) { p.id = uid(); p.numero = siguienteNumero('P'); DB.presupuestos.push(p); }
    else DB.presupuestos[DB.presupuestos.findIndex(x => x.id === id)] = p;
    Datos.guardar(); aviso(`Presupuesto Nº ${numero(p.numero)} guardado`);
    if (nuevo) ir(`presupuesto/${p.id}`);
    if (ver) abrirDocumento('presupuesto', p.id);
  };
  form.addEventListener('submit', e => { e.preventDefault(); guardar(false); });
  $('#guardarVer').addEventListener('click', () => guardar(true));
  $('#verDoc')?.addEventListener('click', () => abrirDocumento('presupuesto', id));
  $('#convertir')?.addEventListener('click', () => convertirEnFactura(id));
  $('#borrar')?.addEventListener('click', () => confirmar('¿Borrar este presupuesto?', 'Esta acción no se puede deshacer.', 'Borrar', () => {
    DB.presupuestos = DB.presupuestos.filter(x => x.id !== id); Datos.guardar(); aviso('Presupuesto borrado'); ir('presupuestos');
  }, true));
}

function convertirEnFactura(idP) {
  const p = DB.presupuestos.find(x => x.id === idP);
  if (!p) return;
  if (p.facturaId) { ir(`factura/${p.facturaId}`); return; }
  confirmar('Convertir en factura X', `Se crea una factura con los ${p.items.length} renglón(es) del presupuesto Nº ${numero(p.numero)} y el presupuesto queda como aceptado. Después la podés editar.`, 'Crear factura', () => {
    const hoy = hoyISO();
    const f = { id: uid(), numero: siguienteNumero('X'), clienteId: p.clienteId, cliente: { ...p.cliente }, fecha: hoy, periodo: hoy.slice(0, 7),
      items: p.items.map((i, k) => ({ dia: k === 0 ? hoy : '', detalle: n0(i.cantidad) > 1 ? `${i.detalle} (x${n0(i.cantidad)})` : i.detalle, importe: n0(i.cantidad) * n0(i.precio), insumo: !!i.insumo })),
      nota: p.titulo ? `Según presupuesto Nº ${numero(p.numero)}: ${p.titulo}` : `Según presupuesto Nº ${numero(p.numero)}`, estado: 'pendiente', presupuestoId: p.id };
    DB.facturas.push(f);
    p.estado = 'aceptado'; p.facturaId = f.id;
    Datos.guardar(); aviso(`Factura X Nº ${numero(f.numero)} creada`); ir(`factura/${f.id}`);
  });
}

// ═══════════════════════════════════════════════════════════
// Facturas X
// ═══════════════════════════════════════════════════════════
function vistaFacturas() {
  const periodos = [...new Set(DB.facturas.map(f => f.periodo))].sort().reverse();
  vista.innerHTML = cabecera('Facturas X', 'Un comprobante por cliente y por mes: abono + extras.',
    `<button class="btn btn--secundario" id="generar">Generar facturas del mes</button><a class="btn" href="#factura/nuevo">+ Nueva factura</a>`) + `
    <section class="tarjeta">
      <div class="filtros"><input type="search" id="buscar" placeholder="Buscar cliente o barrio…">
        <select id="periodo"><option value="">Todos los meses</option>${periodos.map(p => `<option value="${p}">${nombrePeriodo(p)}</option>`).join('')}</select>
        <select id="estado"><option value="">Todos los estados</option><option value="pendiente">Pendientes de cobro</option><option value="parcial">Con cobro parcial</option><option value="cobrada">Cobradas</option></select></div>
      <div class="tabla-envoltura"><table class="tabla"><thead><tr><th>Número</th><th>Fecha</th><th>Cliente</th><th>Mes</th><th class="num">Total</th><th>Estado</th><th></th></tr></thead><tbody id="filas"></tbody></table></div>
      <div class="totales"><span class="ayuda" id="cuenta"></span><div class="totales__monto"><small>TOTAL FILTRADO</small><span id="sumaFiltro"></span></div></div>
    </section>`;
  const dibujar = () => {
    const q = $('#buscar').value.trim().toLowerCase(), per = $('#periodo').value, est = $('#estado').value;
    const lista = DB.facturas.filter(f => (!per || f.periodo === per) && (!est || estadoFactura(f) === est) && (!q || JSON.stringify(f.cliente).toLowerCase().includes(q)))
      .sort((a, b) => b.numero - a.numero);
    $('#filas').innerHTML = lista.map(f => `<tr class="clic" data-ir="factura/${f.id}">
      <td><strong>Nº ${numero(f.numero)}</strong></td><td>${fechaAR(f.fecha)}</td>
      <td>${esc(f.cliente?.nombre)}<span class="sub">${esc(f.cliente?.barrio)}${f.cliente?.lote ? ' · lote ' + esc(f.cliente.lote) : ''}</span></td>
      <td>${nombrePeriodo(f.periodo)}</td><td class="num">${plata(totalFactura(f))}</td><td>${chipEstado('factura', estadoFactura(f))}${estadoFactura(f) === 'parcial' ? `<span class="sub">Saldo ${plata(saldoFactura(f))}</span>` : ''}</td>
      <td class="acciones">${saldoFactura(f) > 0 ? `<button class="btn btn--secundario btn--chico" data-cobrar="${f.id}">Cobrar</button> ` : ''}<button class="btn btn--secundario btn--chico" data-ver="X:${f.id}">Ver</button></td></tr>`).join('')
      || '<tr><td colspan="7" class="vacio">No hay facturas.</td></tr>';
    $('#cuenta').textContent = `${lista.length} factura(s)`;
    $('#sumaFiltro').textContent = plata(lista.reduce((s, f) => s + totalFactura(f), 0));
    enlazarVer(vista);
    $$('[data-cobrar]', vista).forEach(b => b.addEventListener('click', e => { e.stopPropagation(); marcarCobrada(b.dataset.cobrar, dibujar); }));
  };
  ['buscar', 'periodo', 'estado'].forEach(i => $('#' + i).addEventListener('input', dibujar));
  $('#generar').addEventListener('click', generarFacturasDelMes);
  dibujar();
}

function marcarCobrada(id, alTerminar) {
  const f = DB.facturas.find(x => x.id === id);
  dialogo(`<h2>Cobrar factura</h2><p>Factura X Nº ${numero(f.numero)} de ${esc(f.cliente?.nombre)}: saldo ${plata(saldoFactura(f))}.</p>
    <p>Lo recomendable es hacer un <strong>recibo de cobro</strong>: queda el comprobante para el cliente y acepta pagos parciales.</p>
    <details><summary class="ayuda" style="cursor:pointer">Solo marcarla como cobrada, sin recibo</summary>
      <label class="campo" style="margin-top:10px"><span>Fecha de cobro</span><input type="date" id="fechaCobro" value="${hoyISO()}"></label>
      <button class="btn btn--secundario btn--chico" data-marcar style="margin-top:10px">Marcar cobrada</button></details>
    <div class="dialogo__botones"><button class="btn btn--secundario" data-cerrar>Cancelar</button><button class="btn" data-ok>Hacer recibo de cobro</button></div>`,
  (d, cerrar) => {
    $('[data-ok]', d).addEventListener('click', () => { cerrar(); ir(`cobro/nuevo?cliente=${f.clienteId}&factura=${f.id}`); });
    $('[data-marcar]', d).addEventListener('click', () => {
      f.estado = 'cobrada'; f.fechaCobro = $('#fechaCobro').value; Datos.guardar(); cerrar(); aviso('Factura marcada como cobrada'); alTerminar?.();
    });
  });
}

function generarFacturasDelMes() {
  const conAbono = DB.clientes.filter(c => n0(c.abono) > 0).sort((a, b) => a.nombre.localeCompare(b.nombre));
  dialogo(`<h2>Generar facturas del mes</h2>
    <p>Crea una factura X para cada cliente con abono fijo, con el renglón "Mantenimiento integral de jardín". Después le sumás los extras a cada una.</p>
    <div class="campos" style="grid-template-columns:1fr 1fr">
      <label class="campo"><span>Mes</span><select id="gPeriodo">${opcionesPeriodo(periodoActual())}</select></label>
      <label class="campo"><span>Fecha de las facturas</span><input type="date" id="gFecha" value="${hoyISO()}"></label>
    </div>
    <div id="gLista" style="margin-top:14px;max-height:220px;overflow:auto"></div>
    <div class="dialogo__botones"><button class="btn btn--secundario" data-cerrar>Cancelar</button><button class="btn" data-ok>Generar</button></div>`,
  (d, cerrar) => {
    const lista = () => {
      const per = $('#gPeriodo').value;
      $('#gLista').innerHTML = conAbono.length ? `<table class="tabla"><tbody>${conAbono.map(c => {
        const ya = DB.facturas.some(f => f.clienteId === c.id && f.periodo === per);
        return `<tr><td>${esc(c.nombre)}<span class="sub">${esc(c.barrio)}</span></td><td class="num">${plata(c.abono)}</td><td>${ya ? '<span class="estado estado--gris">Ya tiene</span>' : '<span class="estado estado--verde">Se crea</span>'}</td></tr>`;
      }).join('')}</tbody></table>` : '<p class="vacio">No hay clientes con abono mensual cargado.</p>';
    };
    $('#gPeriodo').addEventListener('change', lista); lista();
    $('[data-ok]', d).addEventListener('click', () => {
      const per = $('#gPeriodo').value, fecha = $('#gFecha').value;
      let creadas = 0;
      conAbono.forEach(c => {
        if (DB.facturas.some(f => f.clienteId === c.id && f.periodo === per)) return;
        DB.facturas.push({ id: uid(), numero: siguienteNumero('X'), clienteId: c.id, cliente: { nombre: c.nombre, barrio: c.barrio, lote: c.lote }, fecha, periodo: per,
          items: [{ dia: fecha, detalle: 'Mantenimiento integral de jardín', importe: n0(c.abono), insumo: false }], nota: '', estado: 'pendiente' });
        creadas++;
      });
      Datos.guardar(); cerrar();
      aviso(creadas ? `Se crearon ${creadas} factura(s) de ${nombrePeriodo(per).toLowerCase()}` : 'No había facturas nuevas para crear');
      if (rutaActual().seccion === 'facturas') render(); else ir('facturas');
    });
  });
}

function editorFactura(id, params) {
  const nuevo = id === 'nuevo';
  let f;
  if (nuevo) {
    const c = cliente(params.get('cliente'));
    const hoy = hoyISO();
    f = { clienteId: c?.id || '', cliente: { nombre: c?.nombre || '', barrio: c?.barrio || '', lote: c?.lote || '' }, fecha: hoy, periodo: hoy.slice(0, 7),
      items: [{ dia: hoy, detalle: c?.abono ? 'Mantenimiento integral de jardín' : '', importe: n0(c?.abono), insumo: false }], nota: '', estado: 'pendiente' };
  } else {
    const orig = DB.facturas.find(x => x.id === id);
    if (!orig) { ir('facturas'); return; }
    f = structuredClone(orig);
  }
  const cobrosF = nuevo ? [] : DB.cobros.filter(k => k.aplicaciones.some(a => a.facturaId === id));
  vista.innerHTML = cabecera(nuevo ? 'Nueva factura X' : `Factura X Nº ${numero(f.numero)}`, 'Comprobante no válido como factura.',
    !nuevo ? `<button class="btn btn--secundario" id="verDoc">Ver documento</button>${saldoFactura(f) > 0 ? `<a class="btn" href="#cobro/nuevo?cliente=${f.clienteId}&factura=${id}">Cobrar</a>` : ''}` : '', ['#facturas', 'Facturas X']) + `
    ${cobrosF.length ? `<section class="tarjeta" style="margin-bottom:18px"><div class="tarjeta__titulo"><h2>Cobros</h2>${chipEstado('factura', estadoFactura(f))}</div>
      <table class="tabla"><tbody>${cobrosF.map(k => `<tr class="clic" data-ir="cobro/${k.id}"><td>Recibo Nº ${numero(k.numero)}<span class="sub">${esc(k.medio)}</span></td><td>${fechaAR(k.fecha)}</td>
      <td class="num">${plata(k.aplicaciones.filter(a => a.facturaId === id).reduce((t, a) => t + n0(a.monto), 0))}</td></tr>`).join('')}</tbody></table>
      <div class="totales"><span class="ayuda">Saldo pendiente</span><div class="totales__monto">${plata(saldoFactura(f))}</div></div></section>` : ''}
    <form id="form">
      <section class="tarjeta">
        <div class="tarjeta__titulo"><h2>Datos</h2></div>
        ${bloqueCliente(f, `
          <label class="campo"><span>Fecha</span><input type="date" name="fecha" value="${f.fecha}" required></label>
          <label class="campo"><span>Mes facturado</span><select name="periodo">${opcionesPeriodo(f.periodo)}</select></label>
          <label class="campo"><span>Estado</span><select name="estado" ${cobrosF.length ? 'disabled title="Se calcula con los recibos de cobro"' : ''}>${['pendiente', 'cobrada'].map(k => `<option value="${k}" ${f.estado === k ? 'selected' : ''}>${ESTADOS.factura[k][0]}</option>`).join('')}</select></label>
          <label class="campo"><span>Fecha de cobro</span><input type="date" name="fechaCobro" value="${f.fechaCobro || ''}"></label>`)}
      </section>
      <section class="tarjeta">
        <div class="tarjeta__titulo"><h2>Detalle</h2><span class="ayuda">Los insumos (productos, tierra, plantas) se marcan para que salgan en rojo.</span></div>
        <div id="renglones"></div>
        <div class="totales"><span class="ayuda">${esc(DB.ajustes.leyendaIva)}</span><div class="totales__monto"><small>TOTAL</small><span id="total"></span></div></div>
      </section>
      <section class="tarjeta">
        <label class="campo"><span>Nota (sale en el renglón amarillo)</span><textarea name="nota">${esc(f.nota)}</textarea></label>
      </section>
      <div class="pie-form">
        ${!nuevo ? '<button type="button" class="btn btn--peligro" id="borrar">Borrar</button>' : ''}
        <a class="btn btn--secundario" href="#facturas">Cancelar</a>
        <button type="button" class="btn btn--secundario" id="guardarVer">Guardar y ver</button>
        <button class="btn">Guardar</button>
      </div>
    </form>`;
  const form = $('#form');
  enlazarCliente(form);
  // Al elegir un cliente con abono en una factura vacía, se completa el renglón del abono
  form.clienteId.addEventListener('change', () => {
    const c = cliente(form.clienteId.value);
    if (c?.abono && f.items.length === 1 && !f.items[0].detalle && !n0(f.items[0].importe)) {
      Object.assign(f.items[0], { detalle: 'Mantenimiento integral de jardín', importe: n0(c.abono) });
      montar();
    }
  });
  const totalEl = $('#total');
  const recalcular = () => { totalEl.textContent = plata(totalFactura(f)); };
  const montar = () => {
    const cont = $('#renglones'); const nuevoCont = cont.cloneNode(false); cont.replaceWith(nuevoCont);
    montarRenglones(nuevoCont, f.items, [
      { campo: 'dia', titulo: 'Día', tipo: 'fecha', ancho: '150px' },
      { campo: 'detalle', titulo: 'Detalle', ejemplo: 'Ej.: Mantenimiento integral de jardín' },
      { campo: 'importe', titulo: 'Importe ($)', tipo: 'numero', ancho: '150px' },
      { campo: 'insumo', titulo: 'Insumo', tipo: 'check', ancho: '60px' },
    ], null, recalcular);
    recalcular();
  };
  montar();

  const guardar = ver => {
    if (!form.reportValidity()) return;
    const estado = cobrosF.length ? f.estado : form.estado.value;
    Object.assign(f, { clienteId: form.clienteId.value, cliente: leerCliente(form), fecha: form.fecha.value, periodo: form.periodo.value, estado,
      fechaCobro: estado === 'cobrada' ? (form.fechaCobro.value || hoyISO()) : '', nota: form.nota.value.trim(),
      items: f.items.filter(i => i.detalle.trim() || n0(i.importe)) });
    if (nuevo) { f.id = uid(); f.numero = siguienteNumero('X'); DB.facturas.push(f); }
    else DB.facturas[DB.facturas.findIndex(x => x.id === id)] = f;
    if (cobrosF.length) actualizarEstadoFacturas([f.id]);
    Datos.guardar(); aviso(`Factura X Nº ${numero(f.numero)} guardada`);
    if (nuevo) ir(`factura/${f.id}`);
    if (ver) abrirDocumento('factura', f.id);
  };
  form.addEventListener('submit', e => { e.preventDefault(); guardar(false); });
  $('#guardarVer').addEventListener('click', () => guardar(true));
  $('#verDoc')?.addEventListener('click', () => abrirDocumento('factura', id));
  $('#borrar')?.addEventListener('click', () => cobrosF.length ? aviso('Tiene recibos de cobro: primero borrá esos recibos') : confirmar('¿Borrar esta factura?', 'Esta acción no se puede deshacer.', 'Borrar', () => {
    DB.facturas = DB.facturas.filter(x => x.id !== id);
    DB.presupuestos.forEach(p => { if (p.facturaId === id) delete p.facturaId; });
    Datos.guardar(); aviso('Factura borrada'); ir('facturas');
  }, true));
}

// ═══════════════════════════════════════════════════════════
// Recibos de cobro
// ═══════════════════════════════════════════════════════════
const MEDIOS_PAGO = ['Transferencia', 'Efectivo', 'Mercado Pago', 'Cheque', 'Otro'];
const facturaPorId = id => DB.facturas.find(f => f.id === id);

function vistaCobros() {
  vista.innerHTML = cabecera('Recibos de cobro', 'Pagos de los clientes, aplicados a una o varias facturas.', `<a class="btn" href="#cobro/nuevo">+ Nuevo recibo</a>`) + `
    <section class="tarjeta">
      <div class="filtros"><input type="search" id="buscar" placeholder="Buscar cliente…"></div>
      <div class="tabla-envoltura"><table class="tabla"><thead><tr><th>Número</th><th>Fecha</th><th>Cliente</th><th>Paga facturas</th><th>Medio</th><th class="num">Total</th><th></th></tr></thead><tbody id="filas"></tbody></table></div>
      <div class="totales"><span class="ayuda" id="cuenta"></span><div class="totales__monto"><small>TOTAL COBRADO</small><span id="suma"></span></div></div>
    </section>`;
  const dibujar = () => {
    const q = $('#buscar').value.trim().toLowerCase();
    const lista = DB.cobros.filter(k => !q || JSON.stringify(k.cliente).toLowerCase().includes(q)).sort((a, b) => b.numero - a.numero);
    $('#filas').innerHTML = lista.map(k => `<tr class="clic" data-ir="cobro/${k.id}">
      <td><strong>Nº ${numero(k.numero)}</strong></td><td>${fechaAR(k.fecha)}</td>
      <td>${esc(k.cliente?.nombre)}<span class="sub">${esc(k.cliente?.barrio)}${k.cliente?.lote ? ' · lote ' + esc(k.cliente.lote) : ''}</span></td>
      <td>${k.aplicaciones.map(a => { const f = facturaPorId(a.facturaId); return f ? `X Nº ${numero(f.numero)}` : '—'; }).join(', ')}</td>
      <td>${esc(k.medio)}</td><td class="num">${plata(totalCobro(k))}</td>
      <td class="acciones"><button class="btn btn--secundario btn--chico" data-ver="R:${k.id}">Ver</button></td></tr>`).join('')
      || '<tr><td colspan="7" class="vacio">Todavía no hay recibos de cobro.</td></tr>';
    $('#cuenta').textContent = `${lista.length} recibo(s)`;
    $('#suma').textContent = plata(lista.reduce((s, k) => s + totalCobro(k), 0));
    enlazarVer(vista);
  };
  $('#buscar').addEventListener('input', dibujar);
  dibujar();
}

function editorCobro(id, params) {
  const nuevo = id === 'nuevo';
  let k, original = null;
  if (nuevo) {
    const c = cliente(params.get('cliente'));
    k = { clienteId: c?.id || '', cliente: { nombre: c?.nombre || '', barrio: c?.barrio || '', lote: c?.lote || '' }, fecha: hoyISO(), medio: 'Transferencia', referencia: '', aplicaciones: [], notas: '' };
    const f = facturaPorId(params.get('factura'));
    if (f && saldoFactura(f) > 0) k.aplicaciones.push({ facturaId: f.id, monto: saldoFactura(f) });
  } else {
    original = DB.cobros.find(x => x.id === id);
    if (!original) { ir('cobros'); return; }
    k = structuredClone(original);
  }
  const clientesOrdenados = [...DB.clientes].sort((a, b) => a.nombre.localeCompare(b.nombre));
  vista.innerHTML = cabecera(nuevo ? 'Nuevo recibo de cobro' : `Recibo de cobro Nº ${numero(k.numero)}`, 'Elegí el cliente y a qué facturas corresponde el pago. Podés cobrar una parte.',
    !nuevo ? `<button class="btn btn--secundario" id="verDoc">Ver documento</button>` : '', ['#cobros', 'Recibos de cobro']) + `
    <form id="form">
      <section class="tarjeta"><div class="campos">
        <label class="campo campo--2"><span>Cliente</span><select name="clienteId" required><option value="">— Elegí un cliente —</option>
          ${clientesOrdenados.map(c => `<option value="${c.id}" ${c.id === k.clienteId ? 'selected' : ''}>${esc(c.nombre)}${c.barrio ? ' · ' + esc(c.barrio) : ''}${c.lote ? ' lote ' + esc(c.lote) : ''}</option>`).join('')}</select></label>
        <label class="campo"><span>Fecha</span><input type="date" name="fecha" value="${k.fecha}" required></label>
        <label class="campo"><span>Medio de pago</span><select name="medio">${MEDIOS_PAGO.map(m => `<option ${m === k.medio ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
        <label class="campo campo--2"><span>Referencia (opcional)</span><input name="referencia" value="${esc(k.referencia)}" placeholder="Nº de operación, banco, cheque…"></label>
      </div></section>
      <section class="tarjeta">
        <div class="tarjeta__titulo"><h2>Facturas que paga</h2><span class="ayuda">Tildá la factura y, si paga una parte, cambiá el importe.</span></div>
        <div id="facturasCliente"></div>
        <div class="totales"><span class="ayuda" id="letras"></span><div class="totales__monto"><small>TOTAL RECIBIDO</small><span id="total"></span></div></div>
      </section>
      <section class="tarjeta"><label class="campo"><span>Observaciones</span><textarea name="notas">${esc(k.notas)}</textarea></label></section>
      <div class="pie-form">
        ${!nuevo ? '<button type="button" class="btn btn--peligro" id="borrar">Borrar</button>' : ''}
        <a class="btn btn--secundario" href="#cobros">Cancelar</a>
        <button type="button" class="btn btn--secundario" id="guardarVer">Guardar y ver</button>
        <button class="btn">Guardar</button>
      </div>
    </form>`;
  const form = $('#form');
  const recalcular = () => { const t = totalCobro(k); $('#total').textContent = plata(t); $('#letras').textContent = t ? 'Son ' + enLetras(t) : ''; };

  // Facturas del cliente con saldo (sin contar este mismo recibo) + las que ya paga este recibo
  const dibujarFacturas = () => {
    const cont = $('#facturasCliente');
    if (!k.clienteId) { cont.innerHTML = '<p class="vacio">Elegí un cliente para ver sus facturas.</p>'; recalcular(); return; }
    const lista = DB.facturas.filter(f => f.clienteId === k.clienteId && (saldoFactura(f, k.id) > 0 || k.aplicaciones.some(a => a.facturaId === f.id)))
      .sort((a, b) => a.numero - b.numero);
    cont.innerHTML = lista.length ? `<div class="tabla-envoltura"><table class="renglones"><thead><tr><th style="width:44px"></th><th>Factura</th><th>Mes</th>
      <th class="r-total">Total</th><th class="r-total">Saldo</th><th style="width:170px">Importe que paga ($)</th></tr></thead><tbody>
      ${lista.map(f => { const a = k.aplicaciones.find(x => x.facturaId === f.id); return `<tr data-f="${f.id}">
        <td class="r-chk"><input type="checkbox" ${a ? 'checked' : ''}></td>
        <td>X Nº ${numero(f.numero)}</td><td>${nombrePeriodo(f.periodo)}</td>
        <td class="r-total">${plata(totalFactura(f))}</td><td class="r-total">${plata(saldoFactura(f, k.id))}</td>
        <td class="r-num"><input type="number" min="0" step="any" value="${a ? a.monto : ''}" ${a ? '' : 'disabled'}></td></tr>`; }).join('')}
      </tbody></table></div>` : '<p class="vacio">Este cliente no tiene facturas con saldo pendiente.</p>';
    recalcular();
  };
  $('#facturasCliente').addEventListener('change', e => {
    if (e.target.type !== 'checkbox') return;
    const tr = e.target.closest('tr'), f = facturaPorId(tr.dataset.f), monto = $('input[type="number"]', tr);
    if (e.target.checked) { const v = saldoFactura(f, k.id); k.aplicaciones.push({ facturaId: f.id, monto: v }); monto.disabled = false; monto.value = v; monto.focus(); }
    else { k.aplicaciones = k.aplicaciones.filter(a => a.facturaId !== f.id); monto.disabled = true; monto.value = ''; }
    recalcular();
  });
  $('#facturasCliente').addEventListener('input', e => {
    if (e.target.type !== 'number') return;
    const a = k.aplicaciones.find(x => x.facturaId === e.target.closest('tr').dataset.f);
    if (a) { a.monto = n0(e.target.value); recalcular(); }
  });
  form.clienteId.addEventListener('change', () => {
    k.clienteId = form.clienteId.value; k.aplicaciones = [];
    const c = cliente(k.clienteId); k.cliente = { nombre: c?.nombre || '', barrio: c?.barrio || '', lote: c?.lote || '' };
    dibujarFacturas();
  });
  dibujarFacturas();

  const guardar = ver => {
    if (!form.reportValidity()) return;
    k.aplicaciones = k.aplicaciones.filter(a => n0(a.monto) > 0);
    if (!k.aplicaciones.length) { aviso('Tildá al menos una factura con un importe'); return; }
    const pasada = k.aplicaciones.find(a => n0(a.monto) > saldoFactura(facturaPorId(a.facturaId), k.id) + 0.5);
    if (pasada) { aviso(`El importe de la factura X Nº ${numero(facturaPorId(pasada.facturaId).numero)} supera su saldo`); return; }
    const c = cliente(form.clienteId.value);
    Object.assign(k, { clienteId: c.id, cliente: { nombre: c.nombre, barrio: c.barrio || '', lote: c.lote || '' }, fecha: form.fecha.value, medio: form.medio.value,
      referencia: form.referencia.value.trim(), notas: form.notas.value.trim() });
    const tocadas = new Set([...k.aplicaciones.map(a => a.facturaId), ...(original?.aplicaciones || []).map(a => a.facturaId)]);
    if (nuevo) { k.id = uid(); k.numero = siguienteNumero('R'); DB.cobros.push(k); }
    else DB.cobros[DB.cobros.findIndex(x => x.id === id)] = k;
    actualizarEstadoFacturas([...tocadas]);
    Datos.guardar(); aviso(`Recibo Nº ${numero(k.numero)} guardado`);
    if (nuevo) ir(`cobro/${k.id}`);
    if (ver) abrirDocumento('cobro', k.id);
  };
  form.addEventListener('submit', e => { e.preventDefault(); guardar(false); });
  $('#guardarVer').addEventListener('click', () => guardar(true));
  $('#verDoc')?.addEventListener('click', () => abrirDocumento('cobro', id));
  $('#borrar')?.addEventListener('click', () => confirmar('¿Borrar este recibo?', 'Las facturas que pagaba vuelven a quedar con saldo pendiente.', 'Borrar', () => {
    const tocadas = original.aplicaciones.map(a => a.facturaId);
    DB.cobros = DB.cobros.filter(x => x.id !== id);
    actualizarEstadoFacturas(tocadas);
    Datos.guardar(); aviso('Recibo borrado'); ir('cobros');
  }, true));
}

// ═══════════════════════════════════════════════════════════
// Órdenes de compra
// ═══════════════════════════════════════════════════════════
function vistaOrdenes() {
  vista.innerHTML = cabecera('Órdenes de compra', 'Pedidos a proveedores: vivero, insumos, materiales.', `<a class="btn" href="#orden/nuevo">+ Nueva orden</a>`) + `
    <section class="tarjeta">
      <div class="filtros"><input type="search" id="buscar" placeholder="Buscar proveedor…">
        <select id="estado"><option value="">Todos los estados</option><option value="pendiente">Pendientes</option><option value="recibida">Recibidas</option></select></div>
      <div class="tabla-envoltura"><table class="tabla"><thead><tr><th>Número</th><th>Fecha</th><th>Proveedor</th><th>Para</th><th class="num">Total</th><th>Estado</th><th></th></tr></thead><tbody id="filas"></tbody></table></div>
    </section>`;
  const dibujar = () => {
    const q = $('#buscar').value.trim().toLowerCase(), est = $('#estado').value;
    const lista = DB.ordenes.filter(o => (!est || o.estado === est) && (!q || (o.proveedor || '').toLowerCase().includes(q))).sort((a, b) => b.numero - a.numero);
    $('#filas').innerHTML = lista.map(o => `<tr class="clic" data-ir="orden/${o.id}">
      <td><strong>Nº ${numero(o.numero)}</strong></td><td>${fechaAR(o.fecha)}</td><td>${esc(o.proveedor)}</td>
      <td>${esc(cliente(o.clienteId)?.nombre) || '<span class="sub">Stock propio</span>'}</td>
      <td class="num">${plata(totalConCantidad(o))}</td><td>${chipEstado('orden', o.estado)}</td>
      <td class="acciones"><button class="btn btn--secundario btn--chico" data-ver="OC:${o.id}">Ver</button></td></tr>`).join('')
      || '<tr><td colspan="7" class="vacio">No hay órdenes de compra.</td></tr>';
    enlazarVer(vista);
  };
  $('#buscar').addEventListener('input', dibujar); $('#estado').addEventListener('change', dibujar);
  dibujar();
}

function editorOrden(id, params) {
  const nuevo = id === 'nuevo';
  let o;
  if (nuevo) {
    o = { proveedor: '', contacto: '', fecha: hoyISO(), clienteId: params.get('cliente') || '', entrega: '', items: [{ cantidad: 1, detalle: '', precio: 0 }], notas: '', estado: 'pendiente' };
  } else {
    const orig = DB.ordenes.find(x => x.id === id);
    if (!orig) { ir('ordenes'); return; }
    o = structuredClone(orig);
  }
  const proveedores = [...new Set(DB.ordenes.map(x => x.proveedor).filter(Boolean))];
  vista.innerHTML = cabecera(nuevo ? 'Nueva orden de compra' : `Orden de compra Nº ${numero(o.numero)}`, '',
    !nuevo ? `<button class="btn btn--secundario" id="verDoc">Ver documento</button>` : '', ['#ordenes', 'Órdenes de compra']) + `
    <form id="form">
      <section class="tarjeta">
        <div class="tarjeta__titulo"><h2>Datos</h2></div>
        <div class="campos">
          <label class="campo campo--2"><span>Proveedor</span><input name="proveedor" value="${esc(o.proveedor)}" list="listaProveedores" required placeholder="Ej.: Vivero Botánico"></label>
          <label class="campo campo--2"><span>Contacto del proveedor</span><input name="contacto" value="${esc(o.contacto)}" placeholder="Teléfono o email"></label>
          <label class="campo"><span>Fecha</span><input type="date" name="fecha" value="${o.fecha}" required></label>
          <label class="campo"><span>Estado</span><select name="estado">${Object.entries(ESTADOS.orden).map(([k, v]) => `<option value="${k}" ${o.estado === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></label>
          <label class="campo campo--2"><span>Es para el cliente (opcional)</span><select name="clienteId"><option value="">— Stock propio —</option>${opcionesClientes(o.clienteId).replace(/^<option value="">[^<]*<\/option>/, '')}</select></label>
          <label class="campo campo--4"><span>Entrega</span><input name="entrega" value="${esc(o.entrega)}" placeholder="Ej.: Entregar en Nordelta, Los Castores lote 112 / Retiramos en el vivero"></label>
        </div>
        <datalist id="listaProveedores">${proveedores.map(p => `<option value="${esc(p)}">`).join('')}</datalist>
      </section>
      <section class="tarjeta">
        <div class="tarjeta__titulo"><h2>Detalle</h2></div>
        <div id="renglones"></div>
        <div class="totales"><span></span><div class="totales__monto"><small>TOTAL</small><span id="total"></span></div></div>
      </section>
      <section class="tarjeta"><label class="campo"><span>Observaciones</span><textarea name="notas">${esc(o.notas)}</textarea></label></section>
      <div class="pie-form">
        ${!nuevo ? '<button type="button" class="btn btn--peligro" id="borrar">Borrar</button>' : ''}
        <a class="btn btn--secundario" href="#ordenes">Cancelar</a>
        <button type="button" class="btn btn--secundario" id="guardarVer">Guardar y ver</button>
        <button class="btn">Guardar</button>
      </div>
    </form>`;
  const form = $('#form');
  const totalEl = $('#total');
  const recalcular = () => { totalEl.textContent = plata(totalConCantidad(o)); };
  montarRenglones($('#renglones'), o.items, [
    { campo: 'cantidad', titulo: 'Cant.', tipo: 'numero', ancho: '80px' },
    { campo: 'detalle', titulo: 'Detalle', ejemplo: 'Ej.: Tierra negra, bolsa 50 dm³' },
    { campo: 'precio', titulo: 'Precio unit. ($)', tipo: 'numero', ancho: '140px' },
  ], it => n0(it.cantidad) * n0(it.precio), recalcular);
  recalcular();
  const guardar = ver => {
    if (!form.reportValidity()) return;
    Object.assign(o, { proveedor: form.proveedor.value.trim(), contacto: form.contacto.value.trim(), fecha: form.fecha.value, estado: form.estado.value,
      clienteId: form.clienteId.value, entrega: form.entrega.value.trim(), notas: form.notas.value.trim(), items: o.items.filter(i => i.detalle.trim() || n0(i.precio)) });
    if (nuevo) { o.id = uid(); o.numero = siguienteNumero('OC'); DB.ordenes.push(o); }
    else DB.ordenes[DB.ordenes.findIndex(x => x.id === id)] = o;
    Datos.guardar(); aviso(`Orden de compra Nº ${numero(o.numero)} guardada`);
    if (nuevo) ir(`orden/${o.id}`);
    if (ver) abrirDocumento('orden', o.id);
  };
  form.addEventListener('submit', e => { e.preventDefault(); guardar(false); });
  $('#guardarVer').addEventListener('click', () => guardar(true));
  $('#verDoc')?.addEventListener('click', () => abrirDocumento('orden', id));
  $('#borrar')?.addEventListener('click', () => confirmar('¿Borrar esta orden de compra?', 'Esta acción no se puede deshacer.', 'Borrar', () => {
    DB.ordenes = DB.ordenes.filter(x => x.id !== id); Datos.guardar(); aviso('Orden borrada'); ir('ordenes');
  }, true));
}

// ═══════════════════════════════════════════════════════════
// Personal y recibos de quincena
// ═══════════════════════════════════════════════════════════
const nombreQuincena = r => `${r.quincena === 1 ? '1RA' : '2DA'} QUINCENA MES DE ${nombrePeriodo(r.periodo)}`;

function vistaPersonal() {
  const recibos = [...DB.recibos].sort((a, b) => b.periodo.localeCompare(a.periodo) || b.quincena - a.quincena);
  vista.innerHTML = cabecera('Personal y recibos', 'Recibos de pago de quincena para el equipo.',
    `<a class="btn btn--secundario" href="#empleado/nuevo">+ Empleado</a><a class="btn" href="#recibo/nuevo">+ Recibo de quincena</a>`) + `
    <div class="rejilla-2">
      <section class="tarjeta">
        <div class="tarjeta__titulo"><h2>Recibos</h2></div>
        <div class="tabla-envoltura"><table class="tabla"><thead><tr><th>Empleado</th><th>Período</th><th class="num">Total</th><th></th></tr></thead>
        <tbody>${recibos.map(r => `<tr class="clic" data-ir="recibo/${r.id}">
          <td>${esc(empleado(r.empleadoId)?.nombre || '—')}</td>
          <td>${r.quincena === 1 ? '1ra' : '2da'} quincena<span class="sub">${nombrePeriodo(r.periodo)}</span></td>
          <td class="num">${plata(totalRecibo(r))}</td>
          <td class="acciones"><button class="btn btn--secundario btn--chico" data-ver="recibo:${r.id}">Ver</button></td></tr>`).join('')
          || '<tr><td colspan="4" class="vacio">Todavía no hay recibos.</td></tr>'}</tbody></table></div>
      </section>
      <section class="tarjeta">
        <div class="tarjeta__titulo"><h2>Empleados</h2></div>
        <div class="tabla-envoltura"><table class="tabla"><tbody>${DB.empleados.map(e => `<tr class="clic" data-ir="empleado/${e.id}">
          <td><strong>${esc(e.nombre)}</strong><span class="sub">${esc(e.categoria)} · ${esc(e.tarea)}</span></td>
          <td class="acciones"><a class="btn btn--secundario btn--chico" href="#recibo/nuevo?empleado=${e.id}">+ Recibo</a></td></tr>`).join('')
          || '<tr><td class="vacio">No hay empleados cargados.</td></tr>'}</tbody></table></div>
      </section>
    </div>`;
  enlazarVer(vista);
}

function editorEmpleado(id) {
  const nuevo = id === 'nuevo';
  const e = nuevo ? { nombre: '', dni: '', categoria: '', tarea: 'JARDINERIA', ingreso: '' } : empleado(id);
  if (!e) { ir('personal'); return; }
  vista.innerHTML = cabecera(nuevo ? 'Nuevo empleado' : esc(e.nombre), '', '', ['#personal', 'Personal y recibos']) + `
    <form class="tarjeta" id="form"><div class="campos">
      <label class="campo campo--2"><span>Nombre y apellido</span><input name="nombre" value="${esc(e.nombre)}" required></label>
      <label class="campo"><span>DNI</span><input name="dni" value="${esc(e.dni)}"></label>
      <label class="campo"><span>Fecha de ingreso</span><input type="date" name="ingreso" value="${e.ingreso}"></label>
      <label class="campo campo--2"><span>Categoría</span><input name="categoria" value="${esc(e.categoria)}" placeholder="Ej.: AUX. LIMPIEZA"></label>
      <label class="campo campo--2"><span>Tarea desempeñada</span><input name="tarea" value="${esc(e.tarea)}" placeholder="Ej.: JARDINERIA"></label>
    </div>
    <div class="pie-form">
      ${!nuevo ? '<button type="button" class="btn btn--peligro" id="borrar">Borrar empleado</button>' : ''}
      <a class="btn btn--secundario" href="#personal">Cancelar</a><button class="btn">Guardar</button></div></form>`;
  const form = $('#form');
  form.addEventListener('submit', ev => {
    ev.preventDefault();
    const datos = Object.fromEntries(new FormData(form));
    Object.keys(datos).forEach(k => { datos[k] = datos[k].trim(); });
    datos.categoria = datos.categoria.toUpperCase(); datos.tarea = datos.tarea.toUpperCase();
    if (nuevo) { datos.id = uid(); DB.empleados.push(datos); } else Object.assign(e, datos);
    Datos.guardar(); aviso('Empleado guardado'); ir('personal');
  });
  $('#borrar')?.addEventListener('click', () => confirmar('¿Borrar este empleado?', 'Sus recibos se conservan.', 'Borrar', () => {
    DB.empleados = DB.empleados.filter(x => x.id !== id); Datos.guardar(); aviso('Empleado borrado'); ir('personal');
  }, true));
}

function editorRecibo(id, params) {
  const nuevo = id === 'nuevo';
  let r;
  if (nuevo) {
    const per = periodoActual();
    r = { empleadoId: params.get('empleado') || DB.empleados[0]?.id || '', periodo: per, quincena: new Date().getDate() > 15 ? 2 : 1, ultimoDeposito: periodoCorto(periodoAnterior(per)), conceptos: conceptosBase() };
  } else {
    const orig = DB.recibos.find(x => x.id === id);
    if (!orig) { ir('personal'); return; }
    r = structuredClone(orig);
  }
  if (!DB.empleados.length) {
    vista.innerHTML = cabecera('Recibo de quincena', '', '', ['#personal', 'Personal y recibos']) +
      `<section class="tarjeta"><p class="vacio">Primero cargá un empleado.</p><a class="btn" href="#empleado/nuevo">+ Empleado</a></section>`;
    return;
  }
  vista.innerHTML = cabecera(nuevo ? 'Nuevo recibo de quincena' : 'Recibo de quincena', 'Recibo de pago retribución complementaria no remunerativa.',
    !nuevo ? `<button class="btn btn--secundario" id="verDoc">Ver documento</button>` : '', ['#personal', 'Personal y recibos']) + `
    <form id="form">
      <section class="tarjeta"><div class="campos">
        <label class="campo campo--2"><span>Empleado</span><select name="empleadoId">${DB.empleados.map(e => `<option value="${e.id}" ${e.id === r.empleadoId ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}</select></label>
        <label class="campo"><span>Mes</span><select name="periodo">${opcionesPeriodo(r.periodo)}</select></label>
        <label class="campo"><span>Quincena</span><select name="quincena"><option value="1" ${r.quincena === 1 ? 'selected' : ''}>1ra quincena</option><option value="2" ${r.quincena === 2 ? 'selected' : ''}>2da quincena</option></select></label>
        <label class="campo"><span>Período último depósito</span><input name="ultimoDeposito" value="${esc(r.ultimoDeposito)}" placeholder="Ej.: jul-26"></label>
      </div></section>
      <section class="tarjeta">
        <div class="tarjeta__titulo"><h2>Conceptos</h2><span class="ayuda">Las ausencias se descuentan del total.</span></div>
        <div class="tabla-envoltura"><table class="renglones"><thead><tr><th>Concepto</th><th style="width:110px">Cantidad</th><th style="width:170px">Importe ($)</th></tr></thead>
        <tbody>${CONCEPTOS.map(k => `<tr><td>${k.nombre}${k.ayuda ? ` <span class="ayuda">(${k.ayuda})</span>` : ''}${k.resta ? ' <span class="estado estado--rojo">descuenta</span>' : ''}</td>
          <td class="r-num"><input type="number" min="0" step="any" data-c="${k.clave}" data-k="cantidad" value="${r.conceptos[k.clave]?.cantidad || ''}"></td>
          <td class="r-num"><input type="number" min="0" step="any" data-c="${k.clave}" data-k="monto" value="${r.conceptos[k.clave]?.monto || ''}"></td></tr>`).join('')}</tbody></table></div>
        <div class="totales"><span class="ayuda" id="letras"></span><div class="totales__monto"><small>TOTAL</small><span id="total"></span></div></div>
      </section>
      <div class="pie-form">
        ${!nuevo ? '<button type="button" class="btn btn--peligro" id="borrar">Borrar</button>' : ''}
        <a class="btn btn--secundario" href="#personal">Cancelar</a>
        <button type="button" class="btn btn--secundario" id="guardarVer">Guardar y ver</button>
        <button class="btn">Guardar</button>
      </div>
    </form>`;
  const form = $('#form');
  const recalcular = () => { const t = totalRecibo(r); $('#total').textContent = plata(t); $('#letras').textContent = 'Recibí conforme la suma de ' + enLetras(t); };
  form.addEventListener('input', e => {
    const { c, k } = e.target.dataset;
    if (c) { r.conceptos[c] = r.conceptos[c] || { cantidad: 0, monto: 0 }; r.conceptos[c][k] = n0(e.target.value); recalcular(); }
  });
  recalcular();
  const guardar = ver => {
    Object.assign(r, { empleadoId: form.empleadoId.value, periodo: form.periodo.value, quincena: +form.quincena.value, ultimoDeposito: form.ultimoDeposito.value.trim() });
    const repetido = DB.recibos.find(x => x.id !== r.id && x.empleadoId === r.empleadoId && x.periodo === r.periodo && x.quincena === r.quincena);
    if (repetido) { aviso('Ya hay un recibo de esa quincena para ese empleado'); return; }
    if (nuevo) { r.id = uid(); DB.recibos.push(r); } else DB.recibos[DB.recibos.findIndex(x => x.id === id)] = r;
    Datos.guardar(); aviso('Recibo guardado');
    if (nuevo) ir(`recibo/${r.id}`);
    if (ver) abrirDocumento('recibo', r.id);
  };
  form.addEventListener('submit', e => { e.preventDefault(); guardar(false); });
  $('#guardarVer').addEventListener('click', () => guardar(true));
  $('#verDoc')?.addEventListener('click', () => abrirDocumento('recibo', id));
  $('#borrar')?.addEventListener('click', () => confirmar('¿Borrar este recibo?', 'Esta acción no se puede deshacer.', 'Borrar', () => {
    DB.recibos = DB.recibos.filter(x => x.id !== id); Datos.guardar(); aviso('Recibo borrado'); ir('personal');
  }, true));
}

// ═══════════════════════════════════════════════════════════
// Ajustes y respaldo
// ═══════════════════════════════════════════════════════════
function vistaAjustes() {
  const a = DB.ajustes;
  vista.innerHTML = cabecera('Ajustes', 'Datos que salen en los documentos, numeración y copias de respaldo.') + `
    <form class="tarjeta" id="form">
      <div class="tarjeta__titulo"><h2>Datos de la empresa</h2></div>
      <div class="campos">
        <label class="campo campo--2"><span>Celular</span><input name="celular" value="${esc(a.celular)}"></label>
        <label class="campo campo--2"><span>Email</span><input name="email" value="${esc(a.email)}"></label>
        <label class="campo campo--4"><span>Dirección</span><input name="direccion" value="${esc(a.direccion)}"></label>
        <label class="campo campo--2"><span>CBU</span><input name="cbu" value="${esc(a.cbu)}"></label>
        <label class="campo campo--2"><span>Banco</span><input name="banco" value="${esc(a.banco)}"></label>
        <label class="campo campo--2"><span>Título de la factura</span><input name="servicio" value="${esc(a.servicio)}"></label>
        <label class="campo campo--2"><span>Leyenda del pie</span><input name="leyendaIva" value="${esc(a.leyendaIva)}"></label>
        <label class="campo"><span>Validez de presupuestos (días)</span><input type="number" min="1" name="validezPresupuesto" value="${a.validezPresupuesto}"></label>
      </div>
      <div class="tarjeta__titulo" style="margin-top:22px"><h2>Próximos números</h2></div>
      <div class="campos">
        <label class="campo"><span>Presupuesto</span><input type="number" min="1" name="nP" value="${DB.contadores.P}"></label>
        <label class="campo"><span>Factura X</span><input type="number" min="1" name="nX" value="${DB.contadores.X}"></label>
        <label class="campo"><span>Orden de compra</span><input type="number" min="1" name="nOC" value="${DB.contadores.OC}"></label>
        <label class="campo"><span>Recibo de cobro</span><input type="number" min="1" name="nR" value="${DB.contadores.R}"></label>
      </div>
      <div class="pie-form" style="position:static"><button class="btn">Guardar ajustes</button></div>
    </form>
    <form class="tarjeta" id="formClave">
      <div class="tarjeta__titulo"><h2>Contraseña del panel</h2></div>
      <div class="campos">
        <label class="campo"><span>Contraseña actual</span><input type="password" name="actual" required autocomplete="current-password"></label>
        <label class="campo"><span>Contraseña nueva</span><input type="password" name="nueva" required minlength="8" autocomplete="new-password"></label>
        <label class="campo"><span>Repetir la nueva</span><input type="password" name="repetir" required minlength="8" autocomplete="new-password"></label>
        <div class="campo" style="align-content:end"><button class="btn btn--secundario">Cambiar contraseña</button></div>
      </div>
      <p class="ayuda" style="margin:10px 0 0">Al cambiarla se cierra la sesión en los demás dispositivos.</p>
    </form>
    <section class="tarjeta">
      <div class="tarjeta__titulo"><h2>Copia de respaldo</h2></div>
      <p class="ayuda" style="margin-top:0">Los datos se guardan en la nube y además quedan las últimas 60 versiones por si hay que recuperar algo. Igual conviene descargar una copia cada tanto y guardarla en un lugar seguro.</p>
      <div class="cabecera__acciones">
        <button class="btn btn--secundario" id="exportar">Descargar copia</button>
        <label class="btn btn--secundario">Restaurar copia<input type="file" id="importar" accept="application/json" hidden></label>
        ${DB.demo ? '<button class="btn btn--oscuro" id="empezar">Borrar los ejemplos y empezar de cero</button>' : '<button class="btn btn--fantasma" id="ejemplos">Cargar datos de ejemplo</button>'}
      </div>
    </section>`;
  const form = $('#form');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form));
    Object.keys(ajustesBase()).forEach(k => { if (k in d) a[k] = k === 'validezPresupuesto' ? n0(d[k]) || 15 : d[k].trim(); });
    DB.contadores = { P: Math.max(1, n0(d.nP)), X: Math.max(1, n0(d.nX)), OC: Math.max(1, n0(d.nOC)), R: Math.max(1, n0(d.nR)) };
    Datos.guardar(); aviso('Ajustes guardados');
  });
  $('#formClave').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    if (f.nueva.value !== f.repetir.value) { aviso('Las dos contraseñas nuevas no coinciden'); return; }
    try {
      const r = await Datos.api('POST', '/clave', { actual: f.actual.value, nueva: f.nueva.value });
      if (!r.ok) { aviso(r.error); return; }
      Datos.sesion = r.token; escribirLocal(CLAVE_SESION, r.token);
      f.reset(); aviso('Contraseña cambiada');
    } catch { aviso('No hay conexión con el servidor'); }
  });
  $('#exportar').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(DB, null, 2)], { type: 'application/json' });
    const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `aires-de-jardin-respaldo-${hoyISO()}.json` });
    link.click(); URL.revokeObjectURL(link.href);
  });
  $('#importar').addEventListener('change', async e => {
    const archivo = e.target.files[0];
    if (!archivo) return;
    try {
      const datos = JSON.parse(await archivo.text());
      if (!Array.isArray(datos.clientes)) throw new Error();
      confirmar('Restaurar copia', 'Se reemplazan todos los datos actuales por los de la copia.', 'Restaurar', () => {
        DB = normalizar(datos);
        Datos.guardar(); aviso('Copia restaurada'); ir('inicio'); render();
      }, true);
    } catch { aviso('Ese archivo no es una copia válida'); }
  });
  $('#empezar')?.addEventListener('click', () => confirmar('Empezar de cero', 'Se borran todos los clientes, documentos y empleados de ejemplo. Los datos de la empresa se conservan.', 'Borrar todo', () => {
    const aj = DB.ajustes; DB = datosVacios(); DB.ajustes = aj; Datos.guardar(); aviso('Listo, el panel quedó vacío'); ir('inicio'); render();
  }, true));
  $('#ejemplos')?.addEventListener('click', () => confirmar('Cargar datos de ejemplo', 'Se reemplazan los datos actuales por los de ejemplo.', 'Cargar', () => {
    DB = datosEjemplo(); Datos.guardar(); ir('inicio'); render();
  }, true));
}

// ═══════════════════════════════════════════════════════════
// Documentos (hoja A4)
// ═══════════════════════════════════════════════════════════
function cabeceraDoc({ t1, t2, letra, nro, fecha }) {
  const a = DB.ajustes;
  return `<div class="doc__cab">
    <div class="doc__empresa">
      <img src="assets/logo/logo-web.png" alt="Aires de Jardín">
      <div>Cel: ${esc(a.celular)}</div><div>${esc(a.email)}</div><div>${esc(a.direccion)}</div>
      <div class="cbu">CBU: ${esc(a.cbu)} | ${esc(a.banco)}</div>
    </div>
    <div class="doc__tipo">
      <div class="t1 lima">${t1}</div>
      <div class="t2 lima-claro">${t2}</div>
      <div class="doc__letra">${letra}</div>
      <div class="doc__numero">${nro}</div>
      <div class="doc__fecha"><div class="et lima">FECHA</div><div class="val lima-claro">${fechaGuiones(fecha)}</div></div>
    </div>
  </div>`;
}
const filaCliente = (e1, v1, e2, v2, clase) => `<tr><td class="et">${e1}</td><td class="val ${clase}">${esc(v1)}</td><td class="et">${e2}</td><td class="val ${clase}">${esc(v2)}</td></tr>`;
const relleno = (n, celdas) => Array.from({ length: Math.max(0, n) }, () => `<tr>${celdas}</tr>`).join('');

function docFactura(f) {
  const filas = f.items.map((i, k) => `<tr class="${k === 0 && !i.insumo ? 'destacado' : ''}">
      <td class="dia">${fechaAR(i.dia)}</td>
      <td class="det ${i.insumo ? 'rojo b' : ''} ${k === 0 && !i.insumo ? 'lima' : ''}">${esc(i.detalle)}</td>
      <td class="imp"><span>$</span>${k === 0 ? `<b>${Math.round(n0(i.importe)).toLocaleString('es-AR')}</b>` : `<em>${Math.round(n0(i.importe)).toLocaleString('es-AR')}</em>`}</td></tr>`).join('');
  return `<div class="doc">
    ${cabeceraDoc({ t1: esc(DB.ajustes.servicio), t2: 'COMPROBANTE NO VÁLIDO COMO FACTURA', letra: 'X', nro: `Nº ${numero(f.numero)}`, fecha: f.fecha })}
    <table class="doc__cliente">
      ${filaCliente('Señor (es):', f.cliente?.nombre, 'Barrio:', f.cliente?.barrio, 'lima')}
      ${filaCliente('Mes:', MESES[+f.periodo.split('-')[1] - 1], 'Lote:', f.cliente?.lote, 'lima-claro')}
    </table>
    <table class="doc__items" style="margin-top:14px">
      <thead><tr><th class="lima-claro dia">DIA</th><th class="lima-claro">DETALLE</th><th class="lima-claro imp" style="text-align:center">IMPORTE</th></tr></thead>
      <tbody>${filas}
        <tr><td class="dia"></td><td></td><td class="imp"></td></tr>
        <tr><td class="dia"></td><td class="amarillo b">NOTA: <span style="font-weight:400">${esc(f.nota)}</span></td><td class="imp"></td></tr>
        ${relleno(17 - f.items.length, '<td class="dia"></td><td></td><td class="imp"></td>')}
      </tbody>
    </table>
    <table class="doc__pie"><tr><td class="serif c">${esc(DB.ajustes.leyendaIva)}</td><td class="total lima" style="width:22%"><span>$</span><b>${Math.round(totalFactura(f)).toLocaleString('es-AR')}</b></td></tr></table>
  </div>`;
}

function docConCantidades({ t1, t2, nro, fecha, filasCliente, items, obs, firmas }) {
  const filas = items.map(i => `<tr><td class="cant">${n0(i.cantidad).toLocaleString('es-AR')}</td>
      <td class="det ${i.insumo ? 'rojo b' : ''}">${esc(i.detalle)}</td>
      <td class="pu">${plata(i.precio)}</td>
      <td class="imp"><span>$</span><em>${Math.round(n0(i.cantidad) * n0(i.precio)).toLocaleString('es-AR')}</em></td></tr>`).join('');
  const total = items.reduce((s, i) => s + n0(i.cantidad) * n0(i.precio), 0);
  return `<div class="doc">
    ${cabeceraDoc({ t1, t2, letra: '', nro, fecha })}
    <table class="doc__cliente">${filasCliente}</table>
    <table class="doc__items" style="margin-top:14px">
      <thead><tr><th class="lima-claro cant">CANT.</th><th class="lima-claro">DETALLE</th><th class="lima-claro pu" style="text-align:center">P. UNIT.</th><th class="lima-claro imp" style="text-align:center">IMPORTE</th></tr></thead>
      <tbody>${filas}${relleno(14 - items.length, '<td class="cant"></td><td></td><td class="pu"></td><td class="imp"></td>')}</tbody>
    </table>
    <table class="doc__pie"><tr><td class="serif c">${esc(DB.ajustes.leyendaIva)}</td><td class="total lima" style="width:22%"><span>$</span><b>${Math.round(total).toLocaleString('es-AR')}</b></td></tr></table>
    <div class="doc__obs">${obs}</div>
  </div>${firmas || ''}`;
}

function docPresupuesto(p) {
  const vence = new Date(p.fecha + 'T12:00'); vence.setDate(vence.getDate() + n0(p.validez));
  return docConCantidades({
    t1: 'PRESUPUESTO', t2: esc(p.titulo) || 'SERVICIO DE PAISAJISMO Y MANTENIMIENTO', nro: `<span style="font-size:20pt">Nº ${numero(p.numero)}</span>`, fecha: p.fecha,
    filasCliente: filaCliente('Señor (es):', p.cliente?.nombre, 'Barrio:', p.cliente?.barrio, 'lima') + filaCliente('Válido hasta:', vence.toLocaleDateString('es-AR'), 'Lote:', p.cliente?.lote, 'lima-claro'),
    items: p.items,
    obs: `<strong>OBSERVACIONES:</strong>${esc(p.notas).replace(/\n/g, '<br>') || '—'}<br>Presupuesto válido por ${n0(p.validez)} días. Los insumos se detallan en rojo.`,
  });
}

function docOrden(o) {
  const c = cliente(o.clienteId);
  return docConCantidades({
    t1: 'ORDEN DE COMPRA', t2: 'PEDIDO A PROVEEDOR', nro: `<span style="font-size:20pt">Nº ${numero(o.numero)}</span>`, fecha: o.fecha,
    filasCliente: filaCliente('Proveedor:', o.proveedor, 'Contacto:', o.contacto, 'lima') + filaCliente('Para:', c ? `${c.nombre}${c.lote ? ' (lote ' + c.lote + ')' : ''}` : 'Stock propio', 'Entrega:', o.entrega, 'lima-claro'),
    items: o.items,
    obs: `<strong>OBSERVACIONES:</strong>${esc(o.notas).replace(/\n/g, '<br>') || '—'}`,
    firmas: '<div class="doc__firmas"><div>AUTORIZÓ</div><div>RECIBÍ CONFORME</div></div>',
  });
}

function docRecibo(r) {
  const e = empleado(r.empleadoId) || { nombre: '—' };
  const total = totalRecibo(r);
  const otra = DB.recibos.find(x => x.id !== r.id && x.empleadoId === r.empleadoId && x.periodo === r.periodo && x.quincena !== r.quincena);
  const q1 = r.quincena === 1 ? total : otra ? totalRecibo(otra) : null;
  const q2 = r.quincena === 2 ? total : otra ? totalRecibo(otra) : null;
  const totalMes = q1 !== null && q2 !== null ? q1 + q2 : null;
  const valor = v => (v === null ? '-' : Math.round(v).toLocaleString('es-AR') + ',00');
  const filas = CONCEPTOS.map((k, i) => {
    const c = r.conceptos[k.clave] || {};
    const monto = n0(c.monto) ? `$ ${k.resta ? '-' : ''}${Math.round(n0(c.monto)).toLocaleString('es-AR')},00` : '';
    return `<tr><td>${k.nombre}</td><td>${k.clave === 'extra2' && !n0(c.cantidad) ? '' : n0(c.cantidad)}</td><td class="d">${monto}</td>
      <td class="tbl">${i === 0 && r.quincena === 1 ? '$ ' + valor(total) : ''}</td><td class="tbl">${i === 0 && r.quincena === 2 ? '$ ' + valor(total) : ''}</td><td class="tbl"></td></tr>`;
  }).join('');
  return `<div class="recibo__titulo">RECIBO DE PAGO RETRIBUCION COMPLEMENTARIA NO REMUNERATIVA</div>
  <table class="recibo" style="width:100%;border-collapse:collapse">
    <colgroup><col style="width:24%"><col style="width:13%"><col style="width:17%"><col style="width:14%"><col style="width:15%"><col style="width:17%"></colgroup>
    <tr><td colspan="6" class="cel c b">RECIBO<br>${periodoCorto(r.periodo)}</td></tr>
    <tr><td colspan="6" class="c b serif tbt" style="padding:6px">${esc(e.nombre.toUpperCase())}</td></tr>
    <tr class="tbt"><td class="tbt">PERIODO LIQUIDADO:</td><td colspan="2" class="c b serif tbt">${nombreQuincena(r)}</td><td colspan="3" class="tbl tbt"></td></tr>
    <tr><td style="padding-top:8px">CATEGORIA:<br>TAREA DESEMPEÑADA:</td><td colspan="2" class="c b" style="padding-top:8px">${esc(e.categoria)}<br>${esc(e.tarea)}</td>
      <td colspan="2" class="tbl b serif" style="vertical-align:bottom">FECHA DE INGRESO:</td><td class="d" style="vertical-align:bottom">${e.ingreso ? new Date(e.ingreso + 'T12:00').toLocaleDateString('es-AR') : ''}</td></tr>
    <tr><td class="tbt" style="padding:10px 6px">PERIODO ULTIMO DEPOSITO:</td><td colspan="2" class="c b tbt">${esc(r.ultimoDeposito)}</td><td colspan="3" class="tbl tbt"></td></tr>
    <tr><td class="tbt">CONCEPTOS</td><td class="tbt">Cantidad</td><td class="tbt"></td><td class="tbl tbt c">1er Quincena</td><td class="tbl tbt c">2da Quincena</td><td class="tbl tbt c">Total del mes</td></tr>
    ${filas}
    <tr><td class="tbt">TOTALES</td><td class="tbt"></td><td class="tbt"></td>
      <td class="tbl tbt b">$ <span style="float:right">${valor(q1)}</span></td><td class="tbl tbt b">$ <span style="float:right">${valor(q2)}</span></td>
      <td class="tbl tbt b verde">${totalMes !== null ? '$ <span style="float:right">' + valor(totalMes) + '</span>' : ''}</td></tr>
    <tr><td colspan="3" class="tbt" style="padding:6px">Recibí conforme la suma de <b>${enLetras(total)}</b><br>en concepto de pago quincenal correspondiente al mes de ${nombrePeriodo(r.periodo)}</td>
      <td class="tbl tbt"></td><td class="tbl tbt"></td><td class="tbl tbt"></td></tr>
    <tr><td colspan="6" class="tbt" style="height:60px"></td></tr>
    <tr><td colspan="6" class="tbt" style="height:12px"></td></tr>
  </table>
  <div class="doc__firmas"><div>FIRMA</div><div>ACLARACION</div><div>LUGAR Y FECHA</div><div>Nº DNI</div></div>`;
}

// Saldo de una factura justo después de un recibo (no cuenta los pagos posteriores)
function saldoLuegoDe(f, k) {
  const previos = DB.cobros.filter(x => x.fecha < k.fecha || (x.fecha === k.fecha && x.numero <= k.numero));
  const pagado = previos.reduce((s, x) => s + x.aplicaciones.filter(a => a.facturaId === f.id).reduce((t, a) => t + n0(a.monto), 0), 0);
  return Math.max(0, totalFactura(f) - pagado);
}

function docCobro(k) {
  const total = totalCobro(k);
  const filas = k.aplicaciones.map(a => {
    const f = facturaPorId(a.facturaId);
    return `<tr><td class="cant" style="width:15%">${f ? 'X Nº ' + numero(f.numero) : '—'}</td>
      <td class="det">${f ? 'Servicio de mantenimiento · ' + nombrePeriodo(f.periodo) : ''}</td>
      <td class="pu">${f ? plata(totalFactura(f)) : ''}</td>
      <td class="pu">${f ? plata(saldoLuegoDe(f, k)) : ''}</td>
      <td class="imp"><span>$</span><em>${Math.round(n0(a.monto)).toLocaleString('es-AR')}</em></td></tr>`;
  }).join('');
  return `<div class="doc">
    ${cabeceraDoc({ t1: 'RECIBO', t2: 'COMPROBANTE NO VÁLIDO COMO FACTURA', letra: 'X', nro: `Nº ${numero(k.numero)}`, fecha: k.fecha })}
    <table class="doc__cliente">
      ${filaCliente('Señor (es):', k.cliente?.nombre, 'Barrio:', k.cliente?.barrio, 'lima')}
      ${filaCliente('Medio de pago:', k.medio + (k.referencia ? ' · ' + k.referencia : ''), 'Lote:', k.cliente?.lote, 'lima-claro')}
    </table>
    <div class="doc__obs" style="min-height:0;margin-top:14px;font-size:10pt">Recibí de <b>${esc((k.cliente?.nombre || '').toUpperCase())}</b> la suma de <b>${enLetras(total)}</b> (${plata(total)}) en concepto de pago de las facturas que se detallan:</div>
    <table class="doc__items">
      <thead><tr><th class="lima-claro cant">FACTURA</th><th class="lima-claro">DETALLE</th><th class="lima-claro pu" style="text-align:center">TOTAL FACT.</th>
        <th class="lima-claro pu" style="text-align:center">SALDO</th><th class="lima-claro imp" style="text-align:center">IMPORTE</th></tr></thead>
      <tbody>${filas}${relleno(8 - k.aplicaciones.length, '<td class="cant"></td><td></td><td class="pu"></td><td class="pu"></td><td class="imp"></td>')}</tbody>
    </table>
    <table class="doc__pie"><tr><td class="serif c">TOTAL RECIBIDO</td><td class="total lima" style="width:22%"><span>$</span><b>${Math.round(total).toLocaleString('es-AR')}</b></td></tr></table>
    ${k.notas ? `<div class="doc__obs" style="min-height:0"><strong>OBSERVACIONES:</strong>${esc(k.notas).replace(/\n/g, '<br>')}</div>` : ''}
  </div>
  <p style="font-size:8.5pt;margin:6px 2px 0">"Saldo" es lo que queda pendiente de cada factura después de este pago.</p>
  <div class="doc__firmas" style="grid-template-columns:1fr;margin:24mm 55mm 0"><div>FIRMA Y ACLARACIÓN</div></div>`;
}

// Abre la hoja con las acciones (imprimir/PDF, WhatsApp, mail, editar)
function abrirDocumento(tipo, id) {
  let html, titulo, ruta, tel = '', email = '', mensaje = '';
  const a = DB.ajustes;
  if (tipo === 'factura') {
    const f = DB.facturas.find(x => x.id === id); if (!f) return;
    const c = cliente(f.clienteId);
    html = docFactura(f); titulo = `Factura X Nº ${numero(f.numero)} — ${f.cliente?.nombre}`; ruta = `factura/${id}`;
    tel = c?.telefono; email = c?.email;
    mensaje = `Hola ${(f.cliente?.nombre || '').split(' ')[0]}, te enviamos el comprobante de ${nombrePeriodo(f.periodo).toLowerCase()} por ${plata(totalFactura(f))}.\nPodés transferir al CBU ${a.cbu} (${a.banco}).\n¡Gracias! Aires de Jardín`;
  } else if (tipo === 'presupuesto') {
    const p = DB.presupuestos.find(x => x.id === id); if (!p) return;
    const c = cliente(p.clienteId);
    html = docPresupuesto(p); titulo = `Presupuesto Nº ${numero(p.numero)} — ${p.cliente?.nombre}`; ruta = `presupuesto/${id}`;
    tel = c?.telefono; email = c?.email;
    mensaje = `Hola ${(p.cliente?.nombre || '').split(' ')[0]}, te enviamos el presupuesto${p.titulo ? ' de ' + p.titulo.toLowerCase() : ''} por ${plata(totalConCantidad(p))}. Cualquier consulta, escribinos.\nAires de Jardín`;
  } else if (tipo === 'cobro') {
    const k = DB.cobros.find(x => x.id === id); if (!k) return;
    const c = cliente(k.clienteId);
    html = docCobro(k); titulo = `Recibo de cobro Nº ${numero(k.numero)} — ${k.cliente?.nombre}`; ruta = `cobro/${id}`;
    tel = c?.telefono; email = c?.email;
    mensaje = `Hola ${(k.cliente?.nombre || '').split(' ')[0]}, te enviamos el recibo Nº ${numero(k.numero)} por tu pago de ${plata(totalCobro(k))}. ¡Muchas gracias!\nAires de Jardín`;
  } else if (tipo === 'orden') {
    const o = DB.ordenes.find(x => x.id === id); if (!o) return;
    html = docOrden(o); titulo = `Orden de compra Nº ${numero(o.numero)} — ${o.proveedor}`; ruta = `orden/${id}`;
    tel = /\d{6,}/.test((o.contacto || '').replace(/\D/g, '')) ? o.contacto : ''; email = /@/.test(o.contacto || '') ? o.contacto : '';
    mensaje = `Hola, les enviamos la orden de compra Nº ${numero(o.numero)} de Aires de Jardín.`;
  } else if (tipo === 'recibo') {
    const r = DB.recibos.find(x => x.id === id); if (!r) return;
    html = docRecibo(r); titulo = `Recibo — ${empleado(r.empleadoId)?.nombre || ''} — ${r.quincena === 1 ? '1ra' : '2da'} quincena ${nombrePeriodo(r.periodo).toLowerCase()}`; ruta = `recibo/${id}`;
  }
  $('#hoja').innerHTML = html;
  $('#modalDocTitulo').textContent = titulo;
  // Para quién es el documento (sirve para ofrecer guardar el teléfono en la ficha)
  const clienteDoc = tipo === 'factura' ? DB.facturas.find(x => x.id === id)?.clienteId
    : tipo === 'presupuesto' ? DB.presupuestos.find(x => x.id === id)?.clienteId
    : tipo === 'cobro' ? DB.cobros.find(x => x.id === id)?.clienteId : '';
  $('#modalDocAcciones').innerHTML = `
    <button class="btn" id="imprimir">Imprimir / Guardar PDF</button>
    ${tipo !== 'recibo' ? '<button class="btn btn--secundario" id="enviarWa">Enviar por WhatsApp</button>' : ''}
    <button class="btn btn--secundario" id="descargarPdf">Descargar PDF</button>
    ${email ? `<a class="btn btn--secundario" href="mailto:${esc(email)}?subject=${encodeURIComponent(titulo)}&body=${encodeURIComponent(mensaje)}">Enviar por mail</a>` : ''}
    <button class="btn btn--fantasma" id="editarDoc">Editar</button>`;
  $('#imprimir').addEventListener('click', () => {
    const anterior = document.title; document.title = titulo.replace(/[\\/:*?"<>|]/g, '-');
    window.print(); document.title = anterior;
  });
  $('#editarDoc').addEventListener('click', () => { cerrarDocumento(); ir(ruta); });
  $('#enviarWa')?.addEventListener('click', () => enviarPorWhatsapp({ titulo, mensaje, tel, clienteId: clienteDoc }));
  $('#descargarPdf').addEventListener('click', async e => {
    const b = e.currentTarget; b.disabled = true; b.textContent = 'Preparando…';
    try { descargarArchivo(await generarPdf(), nombreArchivo(titulo)); }
    catch { aviso('No se pudo armar el PDF. Probá con "Imprimir / Guardar PDF".'); }
    finally { b.disabled = false; b.textContent = 'Descargar PDF'; }
  });
  $('#modalDoc').hidden = false;
  document.body.style.overflow = 'hidden';
}
// ─── PDF del documento y envío por WhatsApp ───
// El PDF se arma en el navegador a partir de la hoja que se ve en pantalla
// (html2canvas + jsPDF, que se cargan recién la primera vez que hacen falta).
const nombreArchivo = titulo => titulo.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim() + '.pdf';
let libreriasPdf = null;
function cargarLibreriasPdf() {
  const script = src => new Promise((ok, mal) => {
    const s = Object.assign(document.createElement('script'), { src, onload: ok, onerror: () => mal(new Error('No se pudo cargar ' + src)) });
    document.head.appendChild(s);
  });
  libreriasPdf ??= Promise.all([
    script('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'),
    script('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'),
  ]).catch(e => { libreriasPdf = null; throw e; });
  return libreriasPdf;
}

async function generarPdf() {
  await cargarLibreriasPdf();
  await document.fonts?.ready;
  const hoja = $('#hoja');
  const lienzo = await window.html2canvas(hoja, { scale: 2, backgroundColor: '#ffffff', useCORS: true, windowWidth: 1200, logging: false });
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const ancho = 210, altoPagina = 297;
  const altoTotal = lienzo.height * ancho / lienzo.width;
  // Si la hoja es más alta que una A4, se corta en varias páginas
  const pxPorPagina = Math.floor(lienzo.width * altoPagina / ancho);
  // (un resto menor al 3 % de una página es redondeo: no genera una hoja en blanco)
  for (let y = 0, pagina = 0; y < lienzo.height && (pagina === 0 || lienzo.height - y > pxPorPagina * 0.03); y += pxPorPagina, pagina++) {
    const trozo = document.createElement('canvas');
    trozo.width = lienzo.width; trozo.height = Math.min(pxPorPagina, lienzo.height - y);
    const ctx = trozo.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, trozo.width, trozo.height);
    ctx.drawImage(lienzo, 0, y, lienzo.width, trozo.height, 0, 0, lienzo.width, trozo.height);
    if (pagina) pdf.addPage();
    pdf.addImage(trozo.toDataURL('image/jpeg', 0.86), 'JPEG', 0, 0, ancho, Math.min(altoPagina, altoTotal - pagina * altoPagina));
  }
  return pdf.output('blob');
}

function descargarArchivo(blob, nombre) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: nombre });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const blobADataUrl = blob => new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(blob); });

function enviarPorWhatsapp({ titulo, mensaje, tel, clienteId }) {
  const c = cliente(clienteId);
  const pdfListo = generarPdf(); // se arma mientras se completa el diálogo
  pdfListo.catch(() => {});
  const puedeCompartirArchivo = !!(navigator.canShare && window.File && navigator.canShare({ files: [new File(['x'], 'x.pdf', { type: 'application/pdf' })] }));
  dialogo(`<h2>Enviar por WhatsApp</h2>
    <p>Se abre el chat con el mensaje listo y el <strong>link al PDF</strong>; el cliente lo abre con un toque.</p>
    <div class="campos" style="grid-template-columns:1fr">
      <label class="campo"><span>WhatsApp del ${c ? 'cliente' : 'destinatario'}</span><input id="waTel" type="tel" inputmode="tel" value="${esc(tel || '')}" placeholder="11 1234-5678" autocomplete="off"></label>
      ${c ? `<label class="ayuda" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="waGuardar" ${tel ? '' : 'checked'}> Guardar este número en la ficha de ${esc(c.nombre)}</label>` : ''}
      <label class="campo"><span>Mensaje</span><textarea id="waMensaje" rows="4">${esc(mensaje)}</textarea></label>
    </div>
    <p class="ayuda" id="waEstado" style="margin:10px 0 0">Preparando el PDF…</p>
    <div class="dialogo__botones" style="flex-wrap:wrap">
      <button class="btn btn--secundario" data-cerrar>Cancelar</button>
      ${puedeCompartirArchivo ? '<button class="btn btn--secundario" id="waArchivo">Mandar el archivo PDF</button>' : ''}
      <button class="btn" id="waEnviar">Abrir WhatsApp</button>
    </div>`, (d, cerrar) => {
    const estado = $('#waEstado', d);
    pdfListo.then(() => { estado.textContent = 'PDF listo ✓'; }, () => { estado.textContent = 'No se pudo armar el PDF: se va a mandar solo el mensaje.'; });
    const guardarTelefono = numero => {
      if (c && $('#waGuardar', d)?.checked && numero && numero !== c.telefono) { c.telefono = numero; Datos.guardar(); }
    };

    $('#waEnviar', d).addEventListener('click', async () => {
      const numero = $('#waTel', d).value.trim();
      if (numero.replace(/\D/g, '').length < 8) { aviso('Escribí un número de WhatsApp válido'); $('#waTel', d).focus(); return; }
      // La ventana se abre ya, dentro del clic, para que el navegador no la bloquee
      const ventana = window.open('', '_blank');
      const boton = $('#waEnviar', d); boton.disabled = true;
      let texto = $('#waMensaje', d).value.trim();
      try {
        estado.textContent = 'Subiendo el PDF…';
        const blob = await pdfListo;
        const r = await Datos.api('POST', '/documento', { pdf: await blobADataUrl(blob), nombre: nombreArchivo(titulo) });
        if (!r.ok) throw new Error(r.error);
        texto += `\n\n📄 ${titulo.split(' — ')[0]}: ${r.url}`;
      } catch {
        // Sin servidor: se descarga el PDF para adjuntarlo a mano
        try { descargarArchivo(await pdfListo, nombreArchivo(titulo)); aviso('Se descargó el PDF: adjuntalo en el chat (clip 📎).'); } catch { /* sin PDF */ }
      }
      guardarTelefono(numero);
      const link = linkWa(numero, texto);
      if (ventana) ventana.location.href = link; else location.href = link;
      cerrar();
    });

    $('#waArchivo', d)?.addEventListener('click', async () => {
      const numero = $('#waTel', d).value.trim();
      guardarTelefono(numero);
      try {
        const archivo = new File([await pdfListo], nombreArchivo(titulo), { type: 'application/pdf' });
        await navigator.share({ files: [archivo], text: $('#waMensaje', d).value.trim(), title: titulo });
        cerrar();
      } catch (e) {
        if (e?.name !== 'AbortError') aviso('No se pudo compartir el archivo. Probá con "Abrir WhatsApp".');
      }
    });
  });
}

function cerrarDocumento() { $('#modalDoc').hidden = true; document.body.style.overflow = ''; }
$('#modalDocCerrar').addEventListener('click', cerrarDocumento);
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('#dialogo').hidden) $('#dialogo').hidden = true;
  else if (!$('#modalDoc').hidden) cerrarDocumento();
});

// ═══════════════════════════════════════════════════════════
// Pedidos de la web (formulario "Pedí tu presupuesto")
// ═══════════════════════════════════════════════════════════
let PEDIDOS = [];
const ESTADOS_PEDIDO = { nuevo: ['Nuevo', 'ambar'], contactado: ['Contactado', 'azul'], cliente: ['Ya es cliente', 'verde'], descartado: ['Descartado', 'gris'] };

async function cargarPedidos() {
  try { const r = await Datos.api('GET', '/pedidos'); if (r.ok) PEDIDOS = r.pedidos; } catch { /* sin conexión */ }
  actualizarContadorPedidos();
}
function actualizarContadorPedidos() {
  const n = PEDIDOS.filter(p => p.estado === 'nuevo').length;
  const el = $('#contadorPedidos');
  if (el) { el.textContent = n; el.hidden = !n; }
}
async function cambiarEstadoPedido(id, estado, clienteId) {
  const p = PEDIDOS.find(x => x.id === id);
  if (p) { p.estado = estado; if (clienteId) p.clienteId = clienteId; }
  actualizarContadorPedidos();
  try { await Datos.api('PATCH', '/pedido', { id, estado, clienteId }); } catch { aviso('No se pudo actualizar el pedido'); }
}

async function vistaPedidos() {
  vista.innerHTML = cabecera('Pedidos de la web', 'Lo que llega desde el formulario "Pedí tu presupuesto" de airesdejardin.com.ar.') +
    '<section class="tarjeta"><p class="vacio">Cargando pedidos…</p></section>';
  await cargarPedidos();
  if (rutaActual().seccion !== 'pedidos') return;
  vista.innerHTML = cabecera('Pedidos de la web', 'Lo que llega desde el formulario "Pedí tu presupuesto" de airesdejardin.com.ar.') + `
    <section class="tarjeta">
      <div class="filtros"><select id="estado"><option value="">Todos</option>${Object.entries(ESTADOS_PEDIDO).map(([k, v]) => `<option value="${k}" ${k === 'nuevo' ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></div>
      <div id="listaPedidos"></div>
    </section>`;
  const dibujar = () => {
    const est = $('#estado').value;
    const lista = PEDIDOS.filter(p => !est || p.estado === est);
    $('#listaPedidos').innerHTML = lista.map(p => {
      const wa = linkWa(p.telefono, `Hola ${p.nombre.split(' ')[0]}, te escribimos de Aires de Jardín por tu pedido de presupuesto${p.servicio ? ' de ' + p.servicio.toLowerCase() : ''}.`);
      const [t, c] = ESTADOS_PEDIDO[p.estado] || [p.estado, 'gris'];
      return `<article class="pedido" data-id="${p.id}">
        <div class="pedido__cab"><div><strong>${esc(p.nombre)}</strong> <span class="estado estado--${c}">${t}</span>
          <span class="sub">${new Date(p.fecha).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}${p.servicio ? ' · ' + esc(p.servicio) : ''}</span></div>
          <div class="cabecera__acciones">
            ${wa ? `<a class="btn btn--secundario btn--chico" href="${wa}" target="_blank" rel="noopener" data-contactar>WhatsApp</a>` : ''}
            ${p.estado === 'cliente' && p.clienteId ? `<a class="btn btn--secundario btn--chico" href="#cliente/${p.clienteId}">Ver ficha</a>` : `<a class="btn btn--chico" href="#cliente-editar/nuevo?pedido=${p.id}">Crear cliente</a>`}
            <select class="pedido__estado">${Object.entries(ESTADOS_PEDIDO).map(([k, v]) => `<option value="${k}" ${k === p.estado ? 'selected' : ''}>${v[0]}</option>`).join('')}</select>
          </div></div>
        <div class="pedido__datos">
          <span>📞 ${esc(p.telefono)}</span>${p.email ? `<span>✉️ <a href="mailto:${esc(p.email)}">${esc(p.email)}</a></span>` : ''}
          ${p.barrio || p.lote ? `<span>📍 ${esc(p.barrio)}${p.lote ? ' · lote ' + esc(p.lote) : ''}</span>` : ''}
        </div>
        ${p.mensaje ? `<p class="pedido__mensaje">${esc(p.mensaje).replace(/\n/g, '<br>')}</p>` : ''}
      </article>`;
    }).join('') || `<p class="vacio">${est === 'nuevo' ? 'No hay pedidos nuevos. 🎉' : 'No hay pedidos.'}</p>`;
  };
  $('#estado').addEventListener('change', dibujar);
  $('#listaPedidos').addEventListener('change', async e => {
    if (!e.target.matches('.pedido__estado')) return;
    await cambiarEstadoPedido(e.target.closest('[data-id]').dataset.id, e.target.value);
    dibujar();
  });
  // Escribirle por WhatsApp a un pedido nuevo lo pasa a "Contactado"
  $('#listaPedidos').addEventListener('click', e => {
    const a = e.target.closest('[data-contactar]');
    const id = a?.closest('[data-id]').dataset.id;
    if (id && PEDIDOS.find(p => p.id === id)?.estado === 'nuevo') { cambiarEstadoPedido(id, 'contactado'); setTimeout(dibujar, 300); }
  });
  dibujar();
}

// ═══════════════════════════════════════════════════════════
// Carrusel de la portada de la web
// ═══════════════════════════════════════════════════════════
const WEB = 'https://airesdejardin.com.ar';
const FOTOS_PREDETERMINADAS = [
  ['carrusel-1.jpg', 'Jardín con borduras de boj recortadas en forma geométrica, rosales blancos y árboles al fondo'],
  ['carrusel-2.jpg', 'Cantero curvo con formios, plantas de follaje rojo y helechos sobre césped'],
  ['carrusel-3.jpg', 'Césped parejo con bordura de boj y senderos de piedra frente a una casa moderna'],
  ['carrusel-4.jpg', 'Sendero de piedra partida entre borduras de boj con una casa de ladrillo al fondo'],
  ['carrusel-5.jpg', 'Borduras redondeadas de boj junto a un camino de lajas y césped recién cortado'],
];

// Achica la foto en el navegador antes de subirla (máx. 1920 px, JPG) para que la web cargue rápido
function prepararFoto(origen) {
  return new Promise((ok, mal) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const escala = Math.min(1, 1920 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * escala); c.height = Math.round(img.naturalHeight * escala);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      let calidad = 0.82, datos = c.toDataURL('image/jpeg', calidad);
      while (datos.length > 1_300_000 && calidad > 0.5) { calidad -= 0.08; datos = c.toDataURL('image/jpeg', calidad); }
      ok({ datos, vertical: c.height > c.width });
      if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
    };
    img.onerror = () => mal(new Error('No se pudo leer la imagen'));
    img.src = origen instanceof File ? URL.createObjectURL(origen) : origen;
  });
}

async function vistaCarrusel() {
  const titulo = cabecera('Carrusel de portada', 'Las fotos que pasan en el primer banner de airesdejardin.com.ar.',
    `<a class="btn btn--secundario" href="${WEB}" target="_blank" rel="noopener">Ver la web ↗</a>
     <label class="btn">+ Agregar fotos<input type="file" id="subirFotos" accept="image/jpeg,image/png,image/webp" multiple hidden></label>`);
  vista.innerHTML = titulo + '<section class="tarjeta"><p class="vacio">Cargando fotos…</p></section>';
  let fotos = [];
  try { const r = await Datos.api('GET', '/carrusel'); fotos = r.fotos || []; }
  catch { vista.innerHTML = titulo + '<section class="tarjeta"><p class="vacio">No hay conexión con el servidor.</p></section>'; return; }
  if (rutaActual().seccion !== 'carrusel') return;

  vista.innerHTML = titulo + `
    <section class="tarjeta">
      <div class="tarjeta__titulo"><h2>Fotos (${fotos.length})</h2><span class="ayuda">Pasan en este orden, una cada 6 segundos. Hasta 12 fotos.</span></div>
      ${fotos.length ? '' : `<div class="aviso-carrusel">
        <p>Todavía no cargaste fotos: la web muestra las <strong>5 fotos predeterminadas</strong>. Cuando agregues la primera, el carrusel pasa a mostrar solo las tuyas.</p>
        <button class="btn btn--secundario btn--chico" id="importarPredeterminadas">Copiar las 5 predeterminadas acá para editarlas</button></div>`}
      <div class="carrusel-admin" id="listaFotos">
        ${(fotos.length ? fotos : FOTOS_PREDETERMINADAS.map(([f, alt]) => ({ url: `assets/img/hero/${f}`, alt, predeterminada: true }))).map((f, i, todas) => `
        <article class="foto-carrusel${f.predeterminada ? ' foto-carrusel--muestra' : ''}" data-id="${f.id || ''}">
          <div class="foto-carrusel__img"><img src="${esc(f.url)}" alt="" loading="lazy"><span class="foto-carrusel__num">${i + 1}</span></div>
          ${f.predeterminada ? `<p class="foto-carrusel__alt">${esc(f.alt)}</p>` : `
          <label class="campo"><span>Descripción (para buscadores y lectores de pantalla)</span><input class="alt" value="${esc(f.alt)}" maxlength="160" placeholder="Ej.: Cantero con formios y césped recién cortado"></label>
          <div class="foto-carrusel__acciones">
            <button class="btn btn--secundario btn--icono" data-mover="-1" ${i === 0 ? 'disabled' : ''} title="Mover antes">←</button>
            <button class="btn btn--secundario btn--icono" data-mover="1" ${i === todas.length - 1 ? 'disabled' : ''} title="Mover después">→</button>
            <button class="btn btn--peligro btn--chico" data-borrar>Borrar</button>
          </div>`}
        </article>`).join('')}
      </div>
      ${fotos.length ? '<div class="pie-form" style="position:static;background:none;padding-bottom:0"><button class="btn" id="guardarCarrusel">Guardar orden y descripciones</button></div>' : ''}
    </section>
    <p class="ayuda">Consejo: usá fotos <strong>horizontales</strong> y bien iluminadas. En el celular la foto se recorta a los costados, así que conviene que lo importante esté en el centro.</p>`;

  const subir = async archivosOUrls => {
    const lista = [...archivosOUrls];
    if (fotos.length + lista.length > 12) { aviso(`Podés tener hasta 12 fotos (hay ${fotos.length}).`); return; }
    let hechas = 0, verticales = 0;
    for (const item of lista) {
      estadoGuardado(`Subiendo foto ${hechas + 1} de ${lista.length}…`, 'guardando');
      try {
        const { datos, vertical } = await prepararFoto(item.url || item);
        if (vertical) verticales++;
        const r = await Datos.api('POST', '/carrusel', { imagen: datos, alt: item.alt || '' });
        if (!r.ok) { aviso(r.error); break; }
        hechas++;
      } catch (e) { aviso(e.message || 'No se pudo subir una foto'); break; }
    }
    estadoGuardado('Guardado ✓', 'ok');
    if (hechas) aviso(`${hechas} foto(s) agregada(s)${verticales ? `. ${verticales} es vertical: en la portada se va a recortar.` : ''}`);
    vistaCarrusel();
  };
  $('#subirFotos').addEventListener('change', e => { if (e.target.files.length) subir(e.target.files); });
  $('#importarPredeterminadas')?.addEventListener('click', () =>
    subir(FOTOS_PREDETERMINADAS.map(([f, alt]) => ({ url: `assets/img/hero/${f}`, alt }))));

  const lista = $('#listaFotos');
  lista.addEventListener('click', e => {
    const tarjeta = e.target.closest('.foto-carrusel');
    if (e.target.closest('[data-mover]')) {
      const paso = +e.target.closest('[data-mover]').dataset.mover;
      const hermano = paso < 0 ? tarjeta.previousElementSibling : tarjeta.nextElementSibling;
      if (hermano) { paso < 0 ? hermano.before(tarjeta) : hermano.after(tarjeta); renumerar(); }
    }
    if (e.target.closest('[data-borrar]')) {
      confirmar('¿Borrar esta foto?', 'Deja de aparecer en la portada de la web.', 'Borrar', async () => {
        try { await Datos.api('DELETE', '/carrusel/' + tarjeta.dataset.id); aviso('Foto borrada'); } catch { aviso('No se pudo borrar'); }
        vistaCarrusel();
      }, true);
    }
  });
  const renumerar = () => $$('.foto-carrusel', lista).forEach((t, i, todas) => {
    $('.foto-carrusel__num', t).textContent = i + 1;
    const [antes, despues] = $$('[data-mover]', t);
    if (antes) { antes.disabled = i === 0; despues.disabled = i === todas.length - 1; }
  });
  $('#guardarCarrusel')?.addEventListener('click', async () => {
    const tarjetas = $$('.foto-carrusel', lista);
    const textos = {}; tarjetas.forEach(t => { textos[t.dataset.id] = $('.alt', t).value.trim(); });
    try {
      const r = await Datos.api('PUT', '/carrusel', { orden: tarjetas.map(t => t.dataset.id), textos });
      aviso(r.ok ? 'Carrusel guardado. La web ya muestra los cambios.' : r.error);
    } catch { aviso('No hay conexión con el servidor'); }
  });
}

// ═══════════════════════════════════════════════════════════
// Ingreso con contraseña y arranque
// ═══════════════════════════════════════════════════════════
function pantallaIngreso(mensaje = '') {
  const el = $('#ingreso');
  el.hidden = false;
  $('#ingresoError').textContent = mensaje;
  $('#ingresoClave').value = '';
  $('#ingresoClave').focus();
}
function cerrarSesion(mensaje) {
  Datos.sesion = null; escribirLocal(CLAVE_SESION, null);
  pantallaIngreso(mensaje);
}
$('#formIngreso').addEventListener('submit', async e => {
  e.preventDefault();
  const boton = $('#ingresoBoton');
  boton.disabled = true; boton.textContent = 'Ingresando…'; $('#ingresoError').textContent = '';
  try {
    const r = await Datos.api('POST', '/login', { clave: $('#ingresoClave').value });
    if (!r.ok) { $('#ingresoError').textContent = r.error; return; }
    Datos.sesion = r.token; escribirLocal(CLAVE_SESION, r.token);
    $('#ingreso').hidden = true;
    iniciar();
  } catch { $('#ingresoError').textContent = 'No hay conexión con el servidor. Revisá internet y probá de nuevo.'; }
  finally { boton.disabled = false; boton.textContent = 'Ingresar'; }
});
$('#salir').addEventListener('click', () => confirmar('Cerrar sesión', 'Vas a tener que volver a poner la contraseña para entrar.', 'Cerrar sesión', () => cerrarSesion('')));

let arrancado = false;
async function iniciar() {
  if (!Datos.sesion) { pantallaIngreso(); return; }
  vista.innerHTML = '<p class="vacio">Cargando datos…</p>';
  let r;
  try { r = await Datos.api('GET', '/datos'); }
  catch (e) {
    if (!Datos.sesion) return; // la sesión venció: ya se mostró el ingreso
    vista.innerHTML = `<section class="tarjeta"><p class="vacio">No hay conexión con el servidor.</p><button class="btn" onclick="iniciar()">Reintentar</button></section>`;
    return;
  }
  if (!r.ok) { vista.innerHTML = `<section class="tarjeta"><p class="vacio">${esc(r.error)}</p></section>`; return; }
  const arrancar = () => {
    estadoGuardado('Guardado ✓', 'ok');
    if (!arrancado) { arrancado = true; window.addEventListener('hashchange', render); }
    render();
    cargarPedidos();
  };
  if (r.db) { DB = normalizar(r.db); Datos.version = r.version; arrancar(); return; }

  // Primera vez: la nube está vacía
  Datos.version = 0;
  let local = null;
  try { local = JSON.parse(leerLocal(CLAVE) || 'null'); } catch { /* nada */ }
  const resumen = local && Array.isArray(local.clientes) ? `${local.clientes.length} cliente(s), ${(local.facturas || []).length} factura(s)` : '';
  dialogo(`<h2>¡Bienvenido al panel!</h2><p>Es la primera vez que se usa en la nube. ¿Con qué datos arrancamos?</p>
    <div style="display:grid;gap:10px">
      <button class="btn" data-op="vacio">Empezar de cero</button>
      ${resumen ? `<button class="btn btn--secundario" data-op="local">Subir lo que tengo en esta compu (${resumen}${local.demo ? ', de ejemplo' : ''})</button>` : ''}
      <button class="btn btn--secundario" data-op="ejemplo">Cargar datos de ejemplo para probar</button>
    </div>`, (d, cerrar) => $$('[data-op]', d).forEach(b => b.addEventListener('click', () => {
    DB = b.dataset.op === 'local' ? normalizar(local) : b.dataset.op === 'ejemplo' ? datosEjemplo() : datosVacios();
    cerrar(); Datos.guardar(); arrancar();
  })));
}

iniciar();
