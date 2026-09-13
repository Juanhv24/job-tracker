// Decodifica entidades HTML (&amp;, &#39;, etc.) usando el parser nativo del navegador,
// sin insertar el elemento en el documento ni ejecutar nada.
function decodeHtmlEntities(text) {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
}

function stripHtml(html) {
  const withoutTags = String(html).replace(/<[^>]*>/g, ' ');
  return decodeHtmlEntities(withoutTags).replace(/\s+/g, ' ').trim();
}

// JobPosting vía JSON-LD: la fuente más confiable cuando el portal la publica, porque no
// depende de nombres de clase, etiquetas de página ni estructura de DOM que cambian con
// cada rediseño (a diferencia de un <h2> genérico, que puede ser cualquier encabezado de
// la página, como "Red empresarial" en vez del nombre real del empleador).
function findJsonLdJobPosting() {
  const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
  for (const script of scripts) {
    let data;
    try {
      data = JSON.parse(script.textContent);
    } catch (e) {
      continue;
    }
    const items = Array.isArray(data) ? data
      : Array.isArray(data['@graph']) ? data['@graph']
      : [data];
    const jobPosting = items.find(item => {
      if (!item || !item['@type']) return false;
      const type = item['@type'];
      return type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'));
    });
    if (jobPosting) return jobPosting;
  }
  return null;
}

function extractJobData() {
  const host = window.location.hostname;
  const url  = window.location.href.split('?')[0];

  let company = '', position = '', description = '';
  let companySource = '', positionSource = '', descriptionSource = '';

  const jobPosting = findJsonLdJobPosting();
  if (jobPosting) {
    if (jobPosting.title) {
      position = stripHtml(jobPosting.title);
      if (position) positionSource = 'JSON-LD';
    }
    const orgName = jobPosting.hiringOrganization && jobPosting.hiringOrganization.name;
    if (orgName) {
      company = stripHtml(orgName);
      if (company) companySource = 'JSON-LD';
    }
    if (jobPosting.description) {
      description = stripHtml(jobPosting.description);
      if (description) descriptionSource = 'JSON-LD';
    }
  }

  // ── LINKEDIN ──────────────────────────────────────────────
  if (host.includes('linkedin.com')) {
    if (!company) {
      // Empresa: primer link a /company/ que tenga texto (evita el logo, que suele venir vacío)
      const companyLinks = Array.from(document.querySelectorAll('a[href*="/company/"]'));
      const companyEl = companyLinks.find(a => a.innerText.trim().length > 0);
      company = companyEl ? companyEl.innerText.trim() : '';
      if (company) companySource = 'selectores DOM';
    }

    if (!position) {
      // Cargo: el <p> que sigue al nombre de la empresa
      const allParas = Array.from(document.querySelectorAll('p'));
      const companyIdx = allParas.findIndex(p => p.innerText.trim() === company);
      if (companyIdx !== -1 && allParas[companyIdx + 1]) {
        position = allParas[companyIdx + 1].innerText.trim();
        if (position) positionSource = 'selectores DOM';
      }
    }

    // Fallbacks usando el título de la pestaña, que es muy estable:
    // formato típico "Empresa hiring Cargo in Ciudad | LinkedIn"
    if (!company || !position) {
      const cleanTitle = document.title.replace(/^\(\d+\)\s*/, '');
      if (!company) {
        const m = cleanTitle.match(/^(.+?)\s+hiring\s+/i);
        if (m) { company = m[1].trim(); companySource = 'título de pestaña'; }
      }
      if (!position) {
        const m = cleanTitle.match(/\shiring\s+(.+?)(?:\s+in\s+|\s+\|\s+|$)/i);
        if (m) { position = m[1].trim(); positionSource = 'título de pestaña'; }
      }
    }

    if (!description) {
      // 1) Contenedor semántico estable por aria-label (localizado), no depende de nombres
      //    de clase hasheados que LinkedIn regenera en cada build.
      let descEl = document.querySelector(
        'section[aria-label="Contenido principal"], section[aria-label="Main content"]'
      );

      // 2) Si no aparece (p.ej. panel dividido de resultados de búsqueda, con otra estructura),
      //    toma el <section> con más texto entre los que superan 2000 caracteres.
      if (!descEl) {
        const bigSections = Array.from(document.querySelectorAll('section'))
          .map(s => ({ el: s, len: s.innerText.trim().length }))
          .filter(s => s.len > 2000);
        if (bigSections.length) {
          descEl = bigSections.reduce((a, b) => (b.len > a.len ? b : a)).el;
        }
      }

      // 3) Selectores viejos al final, por si vuelven a aparecer en otro tipo de página.
      descEl = descEl ||
               document.querySelector('#job-details') ||
               document.querySelector('.jobs-description__content') ||
               document.querySelector('.jobs-box__html-content') ||
               document.querySelector('[class*="jobs-description"]') ||
               document.querySelector('article');

      description = descEl ? descEl.innerText.trim() : '';
      descriptionSource = 'selectores DOM';
    }
  }

  // ── EL EMPLEO ─────────────────────────────────────────────
  else if (host.includes('elempleo.com')) {
    if (!position) {
      position = document.querySelector('h1')?.innerText.trim() || '';
      if (position) positionSource = 'selectores DOM';
    }

    if (!company) {
      const companyEl = document.querySelector('a[href*="/empleos-empresas/"]') ||
                        document.querySelector('.company-name') ||
                        document.querySelector('h2');
      company = companyEl ? companyEl.innerText.trim() : '';
      if (company) companySource = 'selectores DOM';
    }

    if (!description) {
      const descEl = document.querySelector('div.description-block') ||
                     document.querySelector('.offer-description') ||
                     document.querySelector('.job-description') ||
                     document.querySelector('section.description') ||
                     document.querySelector('main');
      description = descEl ? descEl.innerText.trim().substring(0, 5000) : '';
      descriptionSource = 'selectores DOM';
    }
  }

  // ── HIMALAYAS ─────────────────────────────────────────────
  else if (host.includes('himalayas.app')) {
    if (!position) {
      position = document.querySelector('h1')?.innerText.trim() || '';
      if (position) positionSource = 'selectores DOM';
    }

    if (!company) {
      const companyEl = document.querySelector('a[href*="/companies/"]');
      company = companyEl ? companyEl.innerText.trim() : '';
      if (company) companySource = 'selectores DOM';
    }

    if (!description) {
      // Descripción: todo el contenido del artículo principal
      const descEl = document.querySelector('article') ||
                     document.querySelector('main') ||
                     document.querySelector('.job-description');
      description = descEl ? descEl.innerText.trim().substring(0, 5000) : '';
      descriptionSource = 'selectores DOM';
    }
  }

  // ── MAGNETO ───────────────────────────────────────────────
  else if (host.includes('magneto365.com')) {
    if (!position) {
      // Cargo: busca el <p> dentro del header que contiene el título
      const posEl = document.querySelector('[class*="header_title"]') ||
                    document.querySelector('[class*="header-title"]') ||
                    document.querySelector('p[class*="magneto-ui-typography"]');
      // Toma solo el texto directo del párrafo, sin los hijos (span, a)
      if (posEl) {
        position = Array.from(posEl.childNodes)
          .filter(n => n.nodeType === Node.TEXT_NODE)
          .map(n => n.textContent.trim())
          .join(' ').trim() || posEl.innerText.trim();
        if (position) positionSource = 'selectores DOM';
      }
    }

    if (!company) {
      // Empresa: toma el primer link a /empresas/ que tenga texto visible
      const companyLinks = Array.from(document.querySelectorAll('a[href*="/empresas/"]'));
      const companyEl = companyLinks.find(a => a.innerText.trim().length > 0 && !a.innerText.includes('Ver empresa'));
      company = companyEl ? companyEl.innerText.trim() : '';
      if (company) companySource = 'selectores DOM';
    }

    if (!description) {
      // Descripción: el nombre de clase real tiene un sufijo hasheado
      // (p.ej. "JobOfferDetailContent_content__ab12x"), de ahí el wildcard.
      const descEl = document.querySelector('div[class*="JobOfferDetailContent_content"]') ||
                     document.querySelector('[class*="job-description"]') ||
                     document.querySelector('[class*="description"]') ||
                     document.querySelector('main');
      description = descEl ? descEl.innerText.trim().substring(0, 5000) : '';
      descriptionSource = 'selectores DOM';
    }
  }

  // ── COMPUTRABAJO ──────────────────────────────────────────
  else if (host.includes('computrabajo.com')) {
    if (!position) {
      // Cargo: el <p> con data-offers-grid-detail-title
      const posEl = document.querySelector('p[data-offers-grid-detail-title]') ||
                    document.querySelector('p.title_offer');
      position = posEl ? posEl.innerText.trim() : '';
      if (position) positionSource = 'selectores DOM';
    }

    if (!company) {
      // Empresa: el link de empresa tiene patrón "/{slug}/empleos" (termina en /empleos).
      // Los links de categoría/sector son "/empleos-..." o "/trabajo-...", así que se descartan.
      const scope = document.querySelector('.header_detail') ||
                    document.querySelector('[class*="header_detail"]') ||
                    document;
      const links = Array.from(scope.querySelectorAll('a[href*="/empleos"]'));
      const companyLink = links.find(a => {
        const path = (a.getAttribute('href') || '').split('?')[0].split('#')[0];
        return /\/[^\/]+\/empleos\/?$/.test(path) && a.innerText.trim().length > 0;
      });
      company = companyLink ? companyLink.innerText.trim() : '';
      if (company) companySource = 'selectores DOM';
    }

    if (!description) {
      // Descripción: ancla en el encabezado "Descripción de la oferta" (funciona también
      // en el panel dividido de resultados, donde la vacante se renderiza en el panel derecho)
      // y toma su elemento padre, que envuelve el texto completo de la vacante.
      const headingEl = Array.from(document.querySelectorAll('*')).find(
        el => el.children.length === 0 && el.textContent.trim() === 'Descripción de la oferta'
      );
      const descEl = (headingEl && headingEl.parentElement) ||
                     document.querySelector('#job-detail-content') ||
                     document.querySelector('.job-description') ||
                     document.querySelector('article');
      description = descEl ? descEl.innerText.trim().substring(0, 5000) : '';
      descriptionSource = 'selectores DOM';
    }
  }

  // ── FALLBACK GENÉRICO ─────────────────────────────────────
  else {
    if (!position) {
      position = document.querySelector('h1')?.innerText.trim() || '';
      if (position) positionSource = 'selectores DOM';
    }
    if (!company) {
      company = document.querySelector('h2')?.innerText.trim() || '';
      if (company) companySource = 'selectores DOM';
    }
    if (!description) {
      const descEl = document.querySelector('article') || document.querySelector('main');
      description = descEl ? descEl.innerText.trim().substring(0, 5000) : '';
      descriptionSource = 'selectores DOM';
    }
  }

  console.log(
    '[Job Tracker] extracción —',
    'empresa:', companySource || '(ninguna)',
    '| cargo:', positionSource || '(ninguna)',
    '| descripción:', descriptionSource || '(ninguna)',
    '| host:', host,
    '| caracteres descripción:', description.length
  );

  if (description.length < 200) {
    console.warn('[Job Tracker] descripción extraída sospechosamente corta:', description.length, 'caracteres en', host);
  }

  return { company, position, description, url };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractJob') {
    sendResponse(extractJobData());
  }
});
