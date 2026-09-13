const SHEET_NAME = 'Sheet1';
const ANTHROPIC_API_KEY = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
const CV_EN = PropertiesService.getScriptProperties().getProperty('CV_EN');
const CV_ES = PropertiesService.getScriptProperties().getProperty('CV_ES');
const SHEET_ID = '1l2Fe_lV7tHYgt4OUvA1tUM5dj8Z91IxXhgK5xsHex28';
const RESUME_TEXT_EN = PropertiesService.getScriptProperties().getProperty('RESUME_TEXT_EN');
const RESUME_TEXT_ES = PropertiesService.getScriptProperties().getProperty('RESUME_TEXT_ES');
const LETTERHEAD_CONTACT = PropertiesService.getScriptProperties().getProperty('LETTERHEAD_CONTACT');

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Nueva Aplicación')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    let result;

    if (data.action === 'addRow') {
      result = addRow(data);
    } else if (data.action === 'coverLetter') {
      Logger.log('doPost received language: ' + data.language);
      result = generateCoverLetter(data.company, data.position, data.description, data.language);
    } else if (data.action === 'analyze') {
      result = generateOutreach(data.company, data.position, data.description, data.language);
    } else {
      result = { error: 'Acción no reconocida' };
    }

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function addRow(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  sheet.appendRow([
    data.company,
    data.contact,
    data.date || '',
    data.stage,
    data.type,
    data.position,
    data.deadline || '',
    data.resume,
    data.cover || 'No solicitada',
    data.url,
    data.message
  ]);
  return { success: true };
}

function generateCoverLetter(company, position, jobDescription, language) {
  try {
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY no está configurada. Ve a Configuración del proyecto → Propiedades del script y agrégala.');
    }

    const lang = language === 'en' ? 'en' : 'es';
    Logger.log('generateCoverLetter received language: ' + language + ' | resolved lang: ' + lang);

    const resumeText = lang === 'en' ? RESUME_TEXT_EN : RESUME_TEXT_ES;
    if (!resumeText) {
      const propName = lang === 'en' ? 'RESUME_TEXT_EN' : 'RESUME_TEXT_ES';
      throw new Error(propName + ' no está configurada. Ve a Configuración del proyecto → Propiedades del script y agrégala.');
    }
    if (!LETTERHEAD_CONTACT) {
      throw new Error('LETTERHEAD_CONTACT no está configurada. Ve a Configuración del proyecto → Propiedades del script y agrégala.');
    }

    const langInstruction = lang === 'en' ? 'ENGLISH' : 'SPANISH (español)';
    const salutation = lang === 'en' ? 'Dear Hiring Manager,' : 'Estimado equipo de selección,';
    const closing = lang === 'en' ? 'Sincerely, Juan Hernandez Vargas' : 'Atentamente, Juan Hernandez Vargas';
    const dateLocale = lang === 'en' ? 'en-US' : 'es-CO';
    const dateStr = new Date().toLocaleDateString(dateLocale, { year: 'numeric', month: 'long', day: 'numeric' });
    const reLine = lang === 'en'
      ? `Re: Application for ${position} at ${company}`
      : `Re: Solicitud para el cargo de ${position} en ${company}`;

    const prompt = `You are an expert career coach. Write a professional, personalized cover letter entirely in ${langInstruction}.

Candidate profile:
${resumeText}

Job details:
- Company: ${company}
- Position: ${position}
- Job description: ${(jobDescription || '').substring(0, 5000)}

Instructions:
- 3 paragraphs: opening (interest + strongest match), middle (2-3 specific achievements matching the role), closing (call to action).
- Tone: professional but warm, confident, not generic.
- Salutation: check the job details above (including any "Detalles adicionales" section) for a
  hiring manager's name. If one is given, address the letter to that person by name instead
  (e.g. "Dear [Name]," / "Estimado(a) [Nombre],"). If no name is given, use the generic
  salutation "${salutation}" exactly as given.
- End with "${closing}".
- Length: 250-320 words. No date, address, or subject line.
- The entire letter, including the salutation and closing, must be in ${langInstruction}.
- Hard constraint: only use facts stated in the candidate profile above. Do not attribute
  projects to the wrong employer, claim skills that are not listed, or invent details about the
  company. The items under KEY PROJECTS are portfolio/bootcamp work, not work done at
  Teleperformance — never describe them as part of the Teleperformance role. If the job
  description asks for something not present in the candidate profile, do not claim that skill;
  instead honestly connect the closest adjacent experience that is actually listed.`;

    const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      payload: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const claudeData = JSON.parse(res.getContentText());
    if (claudeData.error) throw new Error(claudeData.error.message);
    const letterText = claudeData.content[0].text.trim();
    const folder = getOrCreateFolder('Cover Letters');
    const fileName = `Cover Letter - ${company} - ${position}`;

    const doc = DocumentApp.create(fileName);
    const body = doc.getBody();
    body.appendParagraph('Juan Hernandez Vargas')
      .setAttributes({ [DocumentApp.Attribute.FONT_SIZE]: 14, [DocumentApp.Attribute.BOLD]: true });
    body.appendParagraph(LETTERHEAD_CONTACT)
      .setAttributes({ [DocumentApp.Attribute.FONT_SIZE]: 10, [DocumentApp.Attribute.FOREGROUND_COLOR]: '#666666' });
    body.appendHorizontalRule();
    body.appendParagraph('');
    body.appendParagraph(dateStr)
      .setAttributes({ [DocumentApp.Attribute.FONT_SIZE]: 11 });
    body.appendParagraph('');
    body.appendParagraph(reLine)
      .setAttributes({ [DocumentApp.Attribute.BOLD]: true, [DocumentApp.Attribute.FONT_SIZE]: 11 });
    body.appendParagraph('');
    letterText.split('\n').filter(p => p.trim()).forEach(p => {
      body.appendParagraph(p).setAttributes({
        [DocumentApp.Attribute.FONT_SIZE]: 11,
        [DocumentApp.Attribute.LINE_SPACING]: 1.5
      });
      body.appendParagraph('');
    });
    doc.saveAndClose();

    const docFile = DriveApp.getFileById(doc.getId());
    docFile.moveTo(folder);
    const pdfBlob = docFile.getAs('application/pdf');
    pdfBlob.setName(fileName + '.pdf');
    const pdfFile = folder.createFile(pdfBlob);
    docFile.setTrashed(true);

    return {
      success: true,
      url: 'https://drive.google.com/file/d/' + pdfFile.getId() + '/view?usp=sharing',
      text: letterText
    };
  } catch (e) {
    throw new Error('Error generando cover letter: ' + e.message);
  }
}

function generateOutreach(company, position, jobDescription, language) {
  try {
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY no está configurada. Ve a Configuración del proyecto → Propiedades del script y agrégala.');
    }

    const lang = language === 'en' ? 'en' : 'es';
    const idioma = lang === 'en' ? 'INGLÉS (English)' : 'ESPAÑOL';
    const cvLink = lang === 'en' ? CV_EN : CV_ES;
    const cleanDesc = (jobDescription || '').replace(/\s+/g, ' ').trim().substring(0, 3500);

    const prompt = `Vacante: ${position} en ${company}.
Descripción: ${cleanDesc}

Devuelve SOLO este JSON en una sola línea, sin texto adicional:
{"contact":"nombre del reclutador si aparece en la descripción, si no string vacío","message":"mensaje profesional de máximo 3 oraciones dirigido al reclutador expresando interés en este cargo, escrito OBLIGATORIAMENTE en ${idioma}, sin comillas dobles internas"}`;

    const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      payload: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 350,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const claudeData = JSON.parse(res.getContentText());
    if (claudeData.error) throw new Error(claudeData.error.message);

    const raw = claudeData.content[0].text.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Respuesta sin JSON');
    const parsed = JSON.parse(jsonMatch[0]);

    return {
      success: true,
      contact: parsed.contact || '',
      message: (parsed.message || '').trim(),
      resume: cvLink || ''
    };
  } catch (e) {
    throw new Error('Error generando mensaje: ' + e.message);
  }
}

function getOrCreateFolder(name) {
  const folders = DriveApp.getFoldersByName(name);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(name);
}

function autorizar() {
  UrlFetchApp.fetch('https://www.google.com');
}

// ─────────────────────────────────────────────────────────────
// ACTUALIZADOR DE ESTADOS DESDE CORREO — v4 (CERO TOKENS)
// No usa Claude ni ninguna IA, ni hace ninguna llamada externa
// (sin UrlFetchApp). Solo GmailApp + SpreadsheetApp + PropertiesService.
// Costo: $0 siempre.
//
// Mejoras vs v3:
//  6. Regla de "Sin respuesta": si una fila lleva EST_STALE_DAYS (30) sin
//     ningún cambio de estado y no está en Rechazado/Oferta, se marca como
//     "Sin respuesta" — nunca como "Rechazado" (el silencio no es un
//     rechazo). Un correo real posterior sigue pudiendo reemplazarla por
//     cualquier estado detectado. Requiere la nueva columna L (ver
//     INSTALACIÓN) para saber cuándo fue el último cambio real.
//  7. Regla de "Oferta" corregida: ya no dispara con "oferta de empleo",
//     que en español casi siempre significa "job posting" (así hablan los
//     portales de la vacante en sí), no una oferta real hecha al candidato.
//
// Mejoras vs v2:
//  1. Emparejamiento por PALABRAS, no por frase exacta:
//     "NTT DATA Europe & Latam" en tu hoja ahora coincide con un
//     correo que solo diga "NTT DATA". Ignora tildes, mayúsculas
//     y sufijos corporativos (S.A.S., Ltda, Inc...).
//  2. Búsqueda dirigida en Gmail: solo correos de plataformas de
//     empleo o con asunto de postulación (los newsletters ya no
//     desplazan a los correos importantes).
//  3. Seguimiento por MENSAJE, no por hilo: v2 etiquetaba el hilo
//     completo como "procesado", así que una respuesta nueva con
//     información de estado en un hilo ya visto nunca se evaluaba.
//     Ahora se guarda en Script Properties el ID de cada MENSAJE ya
//     evaluado (EST_PROCESSED_PROP), así que un mensaje nuevo en un
//     hilo conocido sí se lee.
//  4. Ventana de búsqueda basada en la última ejecución exitosa
//     (EST_LAST_RUN_PROP), no en un "newer_than:4d" fijo: v2 perdía
//     para siempre cualquier correo si el trigger dejaba de correr
//     por más de 4 días. Ahora, mientras el trigger se reactive en
//     algún momento, retoma la búsqueda desde la última corrida (con
//     un margen de seguridad de 1 día). Solo en la primerísima
//     ejecución (sin fecha guardada) usa una ventana amplia por
//     defecto (EST_DEFAULT_LOOKBACK_DAYS).
//  5. Función diagnosticoEstados() para ver POR QUÉ un correo
//     coincidió o no, sin adivinar.
//
// INSTALACIÓN:
//  1) En tu Code.gs borra el bloque viejo del actualizador
//     (funciones actualizarEstadosDesdeCorreo, instalarTriggerEstados,
//     probarEstados y las constantes EST_*).
//  2) Pega este archivo completo al final del Code.gs.
//  3) IMPORTANTE: en tu hoja, columna D, agrega "Visto por reclutador" Y
//     "Sin respuesta" a la lista del menú desplegable (validación de
//     datos). Si la validación rechaza valores fuera de la lista, la
//     escritura falla.
//  4) IMPORTANTE: agrega una columna L llamada, por ejemplo, "Última
//     actualización de estado" (formato fecha) — ahí se guarda cuándo
//     cambió el estado por última vez, para poder calcular los 30 días de
//     silencio. Si en tu hoja la columna L ya se usa para otra cosa,
//     avísame para mover EST_COL_LAST_CHANGE a una columna libre. Las
//     filas existentes no necesitan que la llenes a mano: si está vacía,
//     el script usa la fecha de aplicación (columna C) como respaldo.
//  5) Ejecuta probarEstados (▶ Run) y revisa el Execution log.
//  6) Si todo bien, ejecuta instalarTriggerEstados una vez.
// ─────────────────────────────────────────────────────────────

const EST_COL_COMPANY      = 1;  // A
const EST_COL_DATE         = 3;  // C — fecha de aplicación, usada como respaldo
const EST_COL_STAGE        = 4;  // D
const EST_COL_POSITION     = 6;  // F
const EST_COL_LAST_CHANGE  = 12; // L — fecha del último cambio de estado (nueva columna)

// Seguimiento de progreso, guardado en Script Properties (no en Gmail):
// evita releer mensajes ya evaluados y recuerda desde cuándo buscar.
const EST_PROCESSED_PROP = 'EST_PROCESSED_MSG_IDS';
const EST_LAST_RUN_PROP  = 'EST_LAST_RUN';
// Ventana por defecto SOLO para la primera ejecución (sin EST_LAST_RUN aún).
const EST_DEFAULT_LOOKBACK_DAYS = 30;
// Cuánto más allá de la ventana de búsqueda se conserva un ID procesado
// antes de descartarlo (nunca se volverá a buscar tan atrás, así que no
// hace falta seguir recordándolo — esto evita que la propiedad crezca
// sin límite).
const EST_PROCESSED_RETENTION_DAYS = EST_DEFAULT_LOOKBACK_DAYS + 5;

// Días sin ningún cambio de estado antes de marcar la fila como "Sin respuesta".
const EST_STALE_DAYS = 30;
// Etapas que NUNCA se marcan como stale: los dos desenlaces finales, y
// "Sin respuesta" misma (para no reprocesarla en cada corrida).
const EST_STALE_EXCLUDE = ['Rechazado', 'Oferta', 'Sin respuesta'];

// Solo se avanza de estado, nunca se retrocede. Rechazado es terminal.
// "Sin respuesta" no es un desenlace real (el silencio no es un rechazo), por
// eso queda con rango 0: cualquier estado real detectado luego la reemplaza.
const EST_RANK = {
  '': 0, 'Aplicado': 0, 'Sin respuesta': 0, 'Visto por reclutador': 1, 'En revisión': 2,
  'Entrevista': 3, 'Oferta': 4, 'Rechazado': 5
};

// Palabras genéricas que NO identifican a una empresa o cargo
const EST_STOP = ['para','con','una','los','las','del','the','and','for','with',
  'sas','ltda','inc','llc','corp','group','grupo','company','cia','sucursal',
  'colombia','bogota','medellin','junior','senior','analista','analyst'];

const EST_REGLAS = [
  { stage: 'Rechazado', kws: [
    'no seguir con tu proceso','no continuar con tu','no continuaremos',
    'hemos decidido no','no fuiste seleccionado','no has sido seleccionado',
    'decidimos avanzar con otros','otros candidatos','no avanzar con tu',
    'lamentablemente','proceso ha finalizado','no podremos continuar',
    'unfortunately','not moving forward','will not be moving forward',
    'decided not to proceed','other candidates','not to move forward',
    'no longer under consideration'
  ]},
  { stage: 'Oferta', kws: [
    // OJO: "oferta de empleo" NO va aquí — en español es la forma genérica de
    // decir "job posting" (portales y newsletters la usan todo el tiempo para
    // referirse a la vacante misma, no a que te estén ofreciendo el puesto).
    // Solo frases donde el verbo "ofrecer" apunta directamente al candidato.
    'nos complace ofrecerte','nos complace ofrecerle',
    'queremos ofrecerte el cargo','queremos ofrecerte la posición',
    'te ofrecemos el puesto','te ofrecemos la posición',
    'carta de oferta',
    'we are pleased to offer','job offer','offer letter','extend an offer'
  ]},
  { stage: 'Entrevista', kws: [
    'entrevista','agendar una','programar una llamada','coordinar una',
    'invitarte a','siguiente etapa','siguiente fase','avanzar a la siguiente',
    'schedule an interview','invite you to interview','like to speak',
    'next steps','move forward to the next','set up a call'
  ]},
  { stage: 'En revisión', kws: [
    'en revision','esta siendo revisada','estamos revisando',
    'tu candidatura esta','bajo revision','reviewing your application',
    'under review','being considered'
  ]},
  { stage: 'Visto por reclutador', kws: [
    'ha visto tu solicitud','tu solicitud fue vista','vio tu solicitud',
    'tu solicitud ha sido vista','viewed your application',
    'your application was viewed','recruiter viewed'
  ]}
];

// ── utilidades de texto ──────────────────────────────────────
function estNorm(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // quita tildes
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function estTokens(s) {
  return estNorm(s).split(' ')
    .filter(w => w.length >= 4 && EST_STOP.indexOf(w) === -1);
}

// ¿El correo habla de esta vacante? Devuelve un puntaje.
function estPuntaje(job, textoNorm) {
  const cT = estTokens(job.company);
  const pT = estTokens(job.position);
  const cHits = cT.filter(t => textoNorm.indexOf(t) !== -1).length;
  const pHits = pT.filter(t => textoNorm.indexOf(t) !== -1).length;
  const companyOk  = cT.length > 0 && cHits >= Math.max(1, Math.ceil(cT.length / 2));
  const positionOk = pT.length > 0 && pHits >= Math.min(2, pT.length);
  return { score: (companyOk ? 3 : 0) + cHits + pHits, companyOk, positionOk };
}

function estParseFecha(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

// ── seguimiento de mensajes procesados (Script Properties, no Gmail) ──
function estCargarProcesados() {
  const raw = PropertiesService.getScriptProperties().getProperty(EST_PROCESSED_PROP);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

function estGuardarProcesados(mapa) {
  PropertiesService.getScriptProperties().setProperty(EST_PROCESSED_PROP, JSON.stringify(mapa));
}

// Descarta IDs de mensajes que ya quedaron fuera de toda ventana de
// búsqueda futura, para que la propiedad no crezca sin límite.
function estPodarProcesados(mapa) {
  const limite = Date.now() - EST_PROCESSED_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  Object.keys(mapa).forEach(id => {
    if (mapa[id] < limite) delete mapa[id];
  });
  return mapa;
}

function estFormatFechaGmail(fecha) {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const d = String(fecha.getDate()).padStart(2, '0');
  return y + '/' + m + '/' + d;
}

// Desde cuándo buscar: desde la última corrida exitosa (con 1 día de
// margen por seguridad), o una ventana amplia por defecto si es la
// primera vez que corre.
function estFechaDesde() {
  const lastRunIso = PropertiesService.getScriptProperties().getProperty(EST_LAST_RUN_PROP);
  if (lastRunIso) {
    const desde = new Date(lastRunIso);
    desde.setDate(desde.getDate() - 1);
    return desde;
  }
  return new Date(Date.now() - EST_DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
}

function estBuscarCorreos() {
  const q = 'after:' + estFormatFechaGmail(estFechaDesde()) + ' ' +
    '(from:linkedin.com OR from:elempleo.com OR from:computrabajo.com ' +
    'OR from:magneto365.com OR from:himalayas.app ' +
    'OR subject:(postulacion OR solicitud OR candidatura OR application))';
  return GmailApp.search(q, 0, 100);
}

function actualizarEstadosDesdeCorreo() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  const data = sheet.getDataRange().getValues();

  const jobs = [];
  for (let i = 1; i < data.length; i++) {
    const company  = String(data[i][EST_COL_COMPANY  - 1] || '').trim();
    const position = String(data[i][EST_COL_POSITION - 1] || '').trim();
    const current  = String(data[i][EST_COL_STAGE    - 1] || '').trim();
    if (!(company || position)) continue;
    // Fecha de referencia para "sin respuesta": el último cambio de estado
    // registrado, o si nunca se ha registrado uno, la fecha de aplicación
    // (columna C) — así las filas ya existentes en la hoja también se evalúan
    // desde el principio, sin necesitar un backfill manual.
    const lastChange = estParseFecha(data[i][EST_COL_LAST_CHANGE - 1]) ||
                        estParseFecha(data[i][EST_COL_DATE - 1]);
    jobs.push({ row: i + 1, company, position, current, lastChange });
  }
  if (jobs.length === 0) { Logger.log('Tracker vacío.'); return; }

  const runStart = new Date();
  const threads = estBuscarCorreos();
  Logger.log('Hilos candidatos: ' + threads.length);

  const procesados = estCargarProcesados();
  let mensajesNuevos = 0;
  let updates = 0;

  threads.forEach(thread => {
    thread.getMessages().forEach(msg => {
      const msgId = msg.getId();
      if (procesados[msgId]) return; // este mensaje puntual ya fue evaluado

      mensajesNuevos++;
      const texto = estNorm(thread.getFirstMessageSubject() + ' ' + msg.getPlainBody().substring(0, 4000));

      // mejor vacante candidata
      let best = null;
      const candidatos = [];
      jobs.forEach(job => {
        const p = estPuntaje(job, texto);
        if (p.companyOk || p.positionOk) {
          candidatos.push({ job, p });
          if (!best || p.score > best.p.score) best = { job, p };
        }
      });

      // Si solo coincide el cargo (no la empresa) y hay varias vacantes con
      // ese cargo, es ambiguo: no tocar nada.
      if (best && !best.p.companyOk) {
        const mismos = candidatos.filter(c => c.p.positionOk && !c.p.companyOk).length;
        if (mismos > 1) best = null;
      }

      procesados[msgId] = msg.getDate().getTime(); // no volver a evaluar este mensaje

      if (!best) return;

      let nuevo = null;
      for (const regla of EST_REGLAS) {
        if (regla.kws.some(k => texto.indexOf(estNorm(k)) !== -1)) { nuevo = regla.stage; break; }
      }
      if (!nuevo) return;

      const actual = best.job.current;
      if ((EST_RANK[nuevo] || 0) <= (EST_RANK[actual] || 0)) return;

      const ahora = new Date();
      sheet.getRange(best.job.row, EST_COL_STAGE).setValue(nuevo);
      sheet.getRange(best.job.row, EST_COL_LAST_CHANGE).setValue(ahora);
      best.job.current = nuevo;
      best.job.lastChange = ahora;
      Logger.log('Fila ' + best.job.row + ' (' + best.job.company + '): ' + (actual || 'Aplicado') + ' → ' + nuevo);
      updates++;
    });
  });

  // Regla de "sin respuesta": filas que llevan EST_STALE_DAYS sin ningún
  // cambio de estado y no están ya en un desenlace (Rechazado/Oferta) ni
  // marcadas como Sin respuesta. El silencio no es un rechazo, así que esto
  // NUNCA escribe "Rechazado" — solo "Sin respuesta", y queda listo para que
  // un correo real posterior lo reemplace (ver EST_RANK).
  let stale = 0;
  const limiteStale = Date.now() - EST_STALE_DAYS * 24 * 60 * 60 * 1000;
  jobs.forEach(job => {
    if (EST_STALE_EXCLUDE.indexOf(job.current) !== -1) return;
    if (!job.lastChange || job.lastChange.getTime() > limiteStale) return;

    const ahora = new Date();
    sheet.getRange(job.row, EST_COL_STAGE).setValue('Sin respuesta');
    sheet.getRange(job.row, EST_COL_LAST_CHANGE).setValue(ahora);
    const diasSinCambios = Math.floor((Date.now() - job.lastChange.getTime()) / (24 * 60 * 60 * 1000));
    Logger.log('Fila ' + job.row + ' (' + job.company + '): ' + (job.current || 'Aplicado') + ' → Sin respuesta (' + diasSinCambios + ' días sin cambios)');
    job.current = 'Sin respuesta';
    job.lastChange = ahora;
    stale++;
  });

  estGuardarProcesados(estPodarProcesados(procesados));
  PropertiesService.getScriptProperties().setProperty(EST_LAST_RUN_PROP, runStart.toISOString());

  Logger.log('Listo. Mensajes nuevos evaluados: ' + mensajesNuevos + ' | Filas actualizadas: ' + updates + ' | Marcadas sin respuesta: ' + stale);
}

// Muestra, para cada correo candidato, qué vacante coincide y qué estado
// detecta — SIN escribir nada en la hoja. Úsala cuando algo no cuadre.
function diagnosticoEstados() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  const jobs = [];
  for (let i = 1; i < data.length; i++) {
    const company  = String(data[i][EST_COL_COMPANY  - 1] || '').trim();
    const position = String(data[i][EST_COL_POSITION - 1] || '').trim();
    if (company || position) jobs.push({ row: i + 1, company, position, current: String(data[i][EST_COL_STAGE - 1] || '') });
  }

  // ventana fija de 4 días solo para este diagnóstico manual, independiente
  // de EST_LAST_RUN — incluye mensajes ya procesados a propósito, para poder
  // inspeccionarlos
  const q = 'newer_than:4d (from:linkedin.com OR from:elempleo.com OR from:computrabajo.com OR from:magneto365.com OR from:himalayas.app OR subject:(postulacion OR solicitud OR candidatura OR application))';
  const threads = GmailApp.search(q, 0, 20);

  threads.forEach(thread => {
    const msgs = thread.getMessages();
    const texto = estNorm(thread.getFirstMessageSubject() + ' ' + msgs[msgs.length - 1].getPlainBody().substring(0, 4000));
    let best = null;
    jobs.forEach(job => {
      const p = estPuntaje(job, texto);
      if ((p.companyOk || p.positionOk) && (!best || p.score > best.p.score)) best = { job, p };
    });
    let estado = '(ninguno)';
    for (const regla of EST_REGLAS) {
      if (regla.kws.some(k => texto.indexOf(estNorm(k)) !== -1)) { estado = regla.stage; break; }
    }
    Logger.log('— "' + thread.getFirstMessageSubject() + '"');
    Logger.log('   vacante: ' + (best ? best.job.company + ' / ' + best.job.position + ' (companyOk=' + best.p.companyOk + ')' : 'SIN COINCIDENCIA') + ' | estado detectado: ' + estado);
  });
}

// Borra el seguimiento (mensajes procesados + última corrida) para poder
// re-procesar todo desde cero en pruebas. Ya no usa etiquetas de Gmail.
function estLimpiarEtiqueta() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(EST_PROCESSED_PROP);
  props.deleteProperty(EST_LAST_RUN_PROP);
  Logger.log('Seguimiento reiniciado: se re-evaluará todo dentro de la ventana por defecto (' + EST_DEFAULT_LOOKBACK_DAYS + ' días) en la próxima corrida.');
}

function instalarTriggerEstados() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'actualizarEstadosDesdeCorreo') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('actualizarEstadosDesdeCorreo').timeBased().everyHours(6).create();
  Logger.log('Trigger instalado (cada 6 horas, costo cero).');
}

function probarEstados() {
  actualizarEstadosDesdeCorreo();
  Logger.log('Prueba completada. Revisa el log y tu hoja.');
}