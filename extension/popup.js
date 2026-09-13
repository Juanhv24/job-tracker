let config = {};
let extractedDescription = '';

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('date').valueAsDate = new Date();
  config = await loadConfig();

  document.getElementById('btn-extract').addEventListener('click', extractJob);
  document.getElementById('btn-settings').addEventListener('click', showSettings);
  document.getElementById('btn-back').addEventListener('click', showMain);
  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
  document.getElementById('btn-show-cover').addEventListener('click', showCoverSection);
  document.getElementById('btn-gen').addEventListener('click', generateCover);
  document.getElementById('btn-regen').addEventListener('click', generateCover);
  document.getElementById('btn-submit').addEventListener('click', submitForm);
  // Botones de idioma: al cambiar, ajusta el CV y regenera el mensaje
  document.getElementById('btn-lang-es').addEventListener('click', () => setLang('es', true));
  document.getElementById('btn-lang-en').addEventListener('click', () => setLang('en', true));
  // Restaura la última elección de idioma (por defecto: español)
  chrome.storage.sync.get('uiLang', (d) => setLang(d.uiLang || 'es', false));

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const SUPPORTED = ['linkedin.com/jobs', 'elempleo.com/co/ofertas-trabajo', 'elempleo.com/co/JobOffers', 'computrabajo.com', 'himalayas.app/companies', 'magneto365.com/co/empleos'];
  if (!SUPPORTED.some(s => tab.url.includes(s))) {
    document.getElementById('main-view').style.display = 'none';
    document.getElementById('not-linkedin').style.display = 'block';
  }
});

async function loadConfig() {
  const DEFAULTS = {
    scriptUrl: ""
  };
  return new Promise(resolve => {
    chrome.storage.sync.get(["scriptUrl"], (stored) => {
      resolve({ ...DEFAULTS, ...Object.fromEntries(Object.entries(stored).filter(([, v]) => v)) });
    });
  });
}

async function extractJob() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const btn = document.getElementById('btn-extract');
  btn.disabled = true;
  btn.textContent = '⏳ Extrayendo...';

  try {
    // Inyecta content.js primero por si acaso, luego manda mensaje
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });

    const data = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, { action: 'extractJob' }, (response) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(response);
      });
    });

    extractedDescription = data.description || '';

    document.getElementById('company').value = data.company || '';
    document.getElementById('position').value = data.position || '';
    document.getElementById('url').value = data.url || '';
    document.getElementById('form-section').style.display = 'block';
    btn.textContent = '🔍 Extraer datos de esta vacante';
    btn.disabled = false;

    await analyzeWithClaude(data.company, data.position, data.description);

  } catch (e) {
    show('Error al extraer datos: ' + e.message, 'error');
    btn.disabled = false;
    btn.textContent = '🔍 Extraer datos de esta vacante';
  }
}

// ── Idioma MANUAL ────────────────────────────────────────────
// Tú eliges el idioma con los botones. Define el CV y el idioma
// del mensaje. La elección se guarda para la próxima vez.
let currentLang = 'es';

function setLang(lang, regenerate) {
  currentLang = lang;
  chrome.storage.sync.set({ uiLang: lang });

  // Botones
  document.getElementById('btn-lang-es').classList.toggle('lang-active', lang === 'es');
  document.getElementById('btn-lang-en').classList.toggle('lang-active', lang === 'en');

  // El link de CV ahora lo devuelve el backend junto con el mensaje generado.
  // Si ya hay una vacante extraída, regenera el mensaje (y el CV) en el nuevo idioma
  if (regenerate) {
    const company = document.getElementById('company').value.trim();
    const position = document.getElementById('position').value.trim();
    if (company && position) {
      analyzeWithClaude(company, position, extractedDescription);
    }
  }
}

async function analyzeWithClaude(company, position, description) {
  console.log('descripción extraída:', (description || '').length, 'caracteres | idioma elegido:', currentLang);
  // El idioma lo decides TÚ con los botones — aquí no se detecta nada.
  setLang(currentLang, false); // asegura botones consistentes
  document.getElementById('stage').value = 'Aplicado';

  if (!config.scriptUrl) {
    show('Agrega la URL del Apps Script en ⚙️ Config para generar el mensaje y el CV.', 'error');
    return;
  }

  show('Claude está redactando el mensaje en ' + (currentLang === 'es' ? 'español' : 'inglés') + '...', 'info');

  try {
    const res = await fetch(config.scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'analyze', company, position, description, language: currentLang })
    });
    const result = await res.json();
    if (result.error) throw new Error(result.error);

    if (result.contact) setField('contact', result.contact);
    if (result.message) setField('message', result.message);
    if (result.resume) setField('resume', result.resume);

    show('✓ Datos listos. Mensaje en ' + (currentLang === 'es' ? 'español' : 'inglés') + '.', 'success');

  } catch (e) {
    show('No se pudo generar el mensaje: ' + e.message, 'error');
  }
}

function showCoverSection() {
  document.getElementById('cover-box').style.display = 'block';
  document.getElementById('btn-show-cover').style.display = 'none';
}

async function generateCover() {
  const company = document.getElementById('company').value.trim();
  const position = document.getElementById('position').value.trim();
  const extra = document.getElementById('cover-details').value.trim();
  const fullDesc = extractedDescription + (extra ? '\n\nDetalles adicionales:\n' + extra : '');

  if (!company || !position) { show('Completa Empresa y Cargo primero.', 'error'); return; }
  if (!config.scriptUrl) { show('Agrega la URL del Apps Script en ⚙️ Config.', 'error'); return; }

  const btnGen = document.getElementById('btn-gen');
  const btnRegen = document.getElementById('btn-regen');
  btnGen.disabled = true;
  btnGen.textContent = '⏳ Generando...';
  btnRegen.disabled = true;
  show('Generando cover letter...', 'info');

  try {
    const res = await fetch(config.scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'coverLetter', company, position, description: fullDesc, language: currentLang })
    });
    const result = await res.json();
    if (result.error) throw new Error(result.error);
    document.getElementById('cover').value = result.url;
    const preview = document.getElementById('cover-preview');
    preview.textContent = result.text;
    preview.style.display = 'block';
    btnGen.style.display = 'none';
    btnRegen.style.display = 'inline-block';
    btnRegen.disabled = false;
    show('✓ Cover letter guardada en Drive.', 'success');
  } catch (e) {
    show('Error: ' + e.message, 'error');
    btnGen.disabled = false;
    btnGen.textContent = '✍️ Generar';
    btnRegen.disabled = false;
  }
}

async function submitForm() {
  const company = document.getElementById('company').value.trim();
  const position = document.getElementById('position').value.trim();
  const date = document.getElementById('date').value;

  if (!company || !position || !date) { show('Completa Empresa, Cargo y Fecha.', 'error'); return; }
  if (!config.scriptUrl) { show('Agrega la URL del Apps Script en ⚙️ Config.', 'error'); return; }

  const btn = document.getElementById('btn-submit');
  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';

  try {
    const res = await fetch(config.scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'addRow',
        company, position, date,
        contact: document.getElementById('contact').value.trim(),
        stage: document.getElementById('stage').value,
        type: detectPortalType(document.getElementById('url').value),
        url: document.getElementById('url').value.trim(),
        resume: document.getElementById('resume').value.trim(),
        cover: document.getElementById('cover').value.trim(),
        deadline: document.getElementById('deadline').value,
        message: document.getElementById('message').value.trim()
      })
    });
    const result = await res.json();
    if (result.success) {
      show('✓ ¡Agregado al tracker exitosamente!', 'success');
      setTimeout(() => window.close(), 1500);
    } else {
      throw new Error(result.error || 'Error desconocido');
    }
  } catch (e) {
    show('Error: ' + e.message, 'error');
    btn.disabled = false;
    btn.textContent = '✅ Agregar al tracker';
  }
}

function showSettings() {
  document.getElementById('main-view').style.display = 'none';
  document.getElementById('settings-view').style.display = 'block';
  chrome.storage.sync.get(['scriptUrl'], (data) => {
    document.getElementById('s-script').value = data.scriptUrl || '';
  });
}

function showMain() {
  document.getElementById('settings-view').style.display = 'none';
  document.getElementById('main-view').style.display = 'block';
}

function saveSettings() {
  const settings = {
    scriptUrl: document.getElementById('s-script').value.trim()
  };
  chrome.storage.sync.set(settings, () => {
    config = settings;
    const el = document.getElementById('settings-status');
    el.style.display = 'block';
    el.textContent = '✓ Configuración guardada';
    setTimeout(() => { el.style.display = 'none'; showMain(); }, 1500);
  });
}

function setField(id, val) {
  const el = document.getElementById(id);
  el.value = val;
  el.classList.add('highlight');
  setTimeout(() => el.classList.remove('highlight'), 2000);
}

function show(msg, type) {
  const el = document.getElementById('status');
  el.style.display = 'block';
  el.textContent = msg;
  el.className = type;
}

function detectPortalType(url) {
  if (!url) return 'Otro';
  if (url.includes('linkedin.com')) return 'LinkedIn';
  if (url.includes('elempleo.com')) return 'El Empleo';
  if (url.includes('computrabajo.com')) return 'Computrabajo';
  if (url.includes('himalayas.app')) return 'Himalayas';
  if (url.includes('magneto365.com')) return 'Magneto';
  return 'Sitio web empresa';
}
