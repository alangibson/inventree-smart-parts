/* editor_helpers.js – Pure utility functions, no DOM side-effects on load */

function getCookie(name) {
  // Prefer Django-injected token (reliable in panel/iframe contexts)
  const el = document.getElementById('sp-csrf');
  if (el && el.value) return el.value;
  // Fallback: cookie
  const v = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
  return v ? v.pop() : '';
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ── Field row builder ─────────────────────────────────────────── */
function buildField(id, label, apiVal, dbVal, type) {
  const av = String(apiVal ?? '');
  const dv = String(dbVal ?? '');
  // Don't flag image URLs as "changed" when the DB value is a local InvenTree
  // media path – the image was already downloaded and stored by InvenTree.
  const isLocalImage = dv.startsWith('/media/') && (id === 'edit-img' || label.toLowerCase().includes('image'));
  const changed = dv !== '' && av.trim() !== dv.trim() && !isLocalImage;
  const cls   = changed ? 'sp-input sp-input-changed' : 'sp-input';
  const note  = changed
    ? `<span class="sp-ref-note">Current: "${escHtml(dv.substring(0,80))}"</span>`
    : '';
  const ctrl  = (type === 'textarea')
    ? `<textarea id="${id}" class="${cls}" rows="2" style="resize:vertical" data-original="${escHtml(av)}" oninput="trackEdit(this)">${escHtml(av)}</textarea>`
    : `<input type="text" id="${id}" class="${cls}" value="${escHtml(av)}" data-original="${escHtml(av)}" oninput="trackEdit(this)">`;
  return `
    <div class="sp-field">
      <label for="${id}">${escHtml(label)}</label>
      <div class="sp-input-wrap">${ctrl}${note}</div>
    </div>`;
}

/* ── Parameter helpers ─────────────────────────────────────────── */
function mergeParams(apiParams, dbParams) {
  const dbMap = {};
  (dbParams || []).forEach(p => { dbMap[p.name.toLowerCase()] = p; });
  const rows = [];
  const seen = new Set();

  (apiParams || []).forEach(p => {
    const key = p.name.toLowerCase();
    seen.add(key);
    const db = dbMap[key];
    let status = 'existing', dbVal = null;
    if (!db) { status = 'new'; }
    else if (String(p.value).trim() !== String(db.value).trim()) {
      status = 'changed'; dbVal = db.value;
    }
    rows.push({ name: p.name, value: p.value, unit: p.unit || '', status, dbVal, manual: false });
  });

  (dbParams || []).forEach(p => {
    if (!seen.has(p.name.toLowerCase()))
      rows.push({ name: p.name, value: p.value, unit: p.unit || '', status: 'db_only', dbVal: null, manual: false });
  });
  return rows;
}

// Use the original source properties so merged/filtered data cannot hide choices.
function buildParameterValueOptions(searchData) {
  const options = [];
  const seen = new Set();
  const sources = Object.entries(searchData?.sources || {})
    .filter(([, source]) => source && !source.error);
  if (!sources.length) {
    sources.push(['', { parameters: searchData?.merged?.all_parameters || searchData?.merged?.parameters || [] }]);
  }
  sources.forEach(([sourceName, source]) => {
    (source.parameters || []).forEach(p => {
      if (p.value == null) return;
      const value = String(p.value);
      const property = [p.name, p.unit].filter(Boolean).join(' · ');
      const label = [source.supplier_name || sourceName, property].filter(Boolean).join(' / ');
      const key = JSON.stringify([value, label]);
      if (seen.has(key)) return;
      seen.add(key);
      options.push(`<option value="${escHtml(value)}" label="${escHtml(label)}" data-source-name="${escHtml(p.name)}" data-source="${escHtml(sourceName)}"></option>`);
    });
  });
  return options.join('');
}

let categoryParameterRequest = 0;
let categoryParameterTemplates = [];

// Native datalists filter against the inferred value, hiding unrelated properties.
// Keep the option stores, but show every option in an explicit editable dropdown.
function buildParameterDropdown(value, choices, label, cls = 'sp-param-input') {
  return `<div class="sp-param-dropdown">
    <input type="text" class="${cls}" value="${escHtml(value)}" aria-label="${label}"
           placeholder="${label}" autocomplete="off" onfocus="openParameterDropdown(this)" onclick="openParameterDropdown(this)" onkeydown="parameterDropdownKey(event)">
    <button type="button" class="sp-param-toggle" data-choices="${choices}"
            aria-label="Show all ${label.toLowerCase()} choices" aria-expanded="false"
            onclick="toggleParameterDropdown(this)">▾</button>
    <div class="sp-param-options" hidden onkeydown="parameterDropdownKey(event)"></div>
  </div>`;
}

function closeParameterDropdowns() {
  document.querySelectorAll('.sp-param-options').forEach(menu => { menu.hidden = true; });
  document.querySelectorAll('.sp-param-toggle').forEach(button => button.setAttribute('aria-expanded', 'false'));
}

function openParameterDropdown(input) {
  const wrapper = input.closest('.sp-param-dropdown');
  if (wrapper.querySelector('.sp-param-options').hidden) {
    toggleParameterDropdown(wrapper.querySelector('.sp-param-toggle'));
  }
}

function toggleParameterDropdown(button) {
  const wrapper = button.closest('.sp-param-dropdown');
  const menu = wrapper.querySelector('.sp-param-options');
  const wasOpen = !menu.hidden;
  closeParameterDropdowns();
  if (wasOpen) return;
  menu.replaceChildren();
  // Name choices come directly from the category response's templates, never
  // from accepted_parameters, dropped_parameters, or supplier properties.
  const options = button.dataset.choices === 'sp-param-names'
    ? categoryParameterTemplates.map(template => ({value: template.name, label: template.units || ''}))
    : document.getElementById(button.dataset.choices)?.querySelectorAll('option') || [];
  options.forEach(option => {
    const choice = document.createElement('button');
    choice.type = 'button';
    choice.className = 'sp-param-choice';
    choice.textContent = button.dataset.choices === 'sp-param-names'
      ? option.value
      : [option.label, option.value].filter(Boolean).join(' / ');
    choice.onclick = () => {
      const input = wrapper.querySelector('input');
      input.value = option.value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      if (button.dataset.choices === 'sp-param-values') {
        const row = wrapper.closest('tr');
        row.dataset.sourceName = option.dataset.sourceName || '';
        row.dataset.source = option.dataset.source || '';
        row.dataset.manual = 'true';
      }
      input.focus();
      closeParameterDropdowns();
    };
    menu.appendChild(choice);
  });
  if (!options.length) {
    const empty = document.createElement('span');
    empty.textContent = 'No choices available. Enter a value directly.';
    menu.appendChild(empty);
  }
  menu.hidden = false;
  button.setAttribute('aria-expanded', 'true');
}

function parameterDropdownKey(event) {
  const wrapper = event.target.closest('.sp-param-dropdown');
  const toggle = wrapper.querySelector('.sp-param-toggle');
  const menu = wrapper.querySelector('.sp-param-options');
  if (event.key === 'Escape') {
    wrapper.querySelector('input').focus();
    closeParameterDropdowns();
    event.preventDefault();
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (menu.hidden) toggleParameterDropdown(toggle);
    const choices = Array.from(menu.querySelectorAll('button'));
    const index = choices.indexOf(document.activeElement);
    const next = index < 0 ? (event.key === 'ArrowDown' ? 0 : choices.length - 1)
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
    choices[next]?.focus();
  }
}

document.addEventListener('click', event => {
  if (!event.target.closest('.sp-param-dropdown')) closeParameterDropdowns();
});
document.addEventListener('focusin', event => {
  if (!event.target.closest('.sp-param-dropdown')) closeParameterDropdowns();
});
document.addEventListener('input', event => {
  const wrapper = event.target.closest('.sp-param-dropdown');
  if (wrapper?.querySelector('[data-choices="sp-param-values"]')) {
    // A typed value no longer identifies a selected supplier property.
    delete wrapper.closest('tr').dataset.sourceName;
    delete wrapper.closest('tr').dataset.source;
  }
});

function buildParamRow(p) {
  const isManual = Boolean(p.manual);
  let rowCls = 'sp-param-row', badge = '', note = '';
  if (isManual) {
    rowCls += ' sp-param-new sp-param-manual';
    badge = '<span class="sp-badge sp-badge-new">MANUAL</span>';
  } else if (p.status === 'new') {
    rowCls += ' sp-param-new';
    badge = '<span class="sp-badge sp-badge-new">⚡ NEW</span>';
  } else if (p.status === 'changed') {
    rowCls += ' sp-param-changed';
    badge = '<span class="sp-badge sp-badge-warn">⚠ changed</span>';
    note  = `<br><small class="sp-ref-note">Previous: "${escHtml(String(p.dbVal||'').substring(0,50))}"</small>`;
  } else if (p.status === 'db_only') {
    badge = '<span class="sp-badge sp-badge-db">DB</span>';
  }
  const valCls = p.status === 'changed' ? 'sp-param-input changed' : 'sp-param-input';
  return `<tr class="${rowCls}" data-manual="${isManual ? 'true' : 'false'}" data-status="${escHtml(p.status || '')}" data-source-name="${escHtml(p.source_name || '')}" data-source="${escHtml(p.source || '')}">
    <td><button type="button" class="sp-del-btn" onclick="delParamRow(this)" title="Delete">×</button></td>
    <td>${buildParameterDropdown(p.name, 'sp-param-names', 'Parameter name')}</td>
    <td>${buildParameterDropdown(p.value, 'sp-param-values', 'Parameter value', valCls)}${note}</td>
    <td><input type="text" class="sp-param-input" value="${escHtml(p.unit)}" placeholder="—" style="width:70px"></td>
    <td>${badge}</td>
  </tr>`;
}

function buildParamsTable(rows, dropped = []) {
  categoryParameterTemplates = [];
  const body = rows.map(buildParamRow).join('');
  let dropHtml = '';
  if (dropped && dropped.length > 0) {
    const names = dropped.map(d => escHtml(d.supplier_key || d.name || '')).join(', ');
    dropHtml = `
      <p id="sp-dropped-badge" style="font-size:.8rem;color:var(--sp-text-muted,#888);margin:.4rem 0">
        <i class="fas fa-filter"></i> ${dropped.length} parameter(s) excluded by category filter: ${names}
      </p>`;
  }
  return `
    <div style="display:flex;justify-content:flex-end;align-items:center;margin-bottom:.5rem">
      <button type="button" class="sp-btn sp-btn-outline sp-btn-sm" onclick="addParamRow()">
        <i class="fas fa-plus"></i> Add Parameter
      </button>
    </div>
    <datalist id="sp-param-values">${buildParameterValueOptions(window._searchData)}</datalist>
    <table class="sp-param-table">
      <thead><tr>
        <th style="width:32px"></th><th>Name</th><th>Value</th>
        <th style="width:80px">Unit</th><th style="width:110px"></th>
      </tr></thead>
      <tbody id="paramTbody">${body}</tbody>
    </table>
    ${dropHtml}`;
}

/* ── Supplier helpers ──────────────────────────────────────────── */
function buildInitialSuppliers(searchData, existingData) {
  const list = [];
  const seen = new Set();

  // Normalise a company name for dedup: lowercase, strip common suffixes so
  // "Mouser" and "Mouser Electronics" don't produce duplicate entries.
  function normName(n) {
    return String(n || '').toLowerCase()
      .replace(/\s+(electronics|components|semiconductor|inc\.?|ltd\.?|gmbh|co\.?)$/i, '')
      .trim();
  }
  function dedupeKey(name, sku) {
    return `${normName(name)}:${String(sku||'').trim().toLowerCase()}`;
  }

  ['mouser','digikey','lcsc','element14','tme'].forEach(src => {
    const s = searchData.sources[src];
    if (!s || s.error) return;
    // Fallback: if API confirmed a match but SKU is empty, use MPN
    const sku = s.supplier_sku || s.mpn || searchData.merged?.mpn || '';
    if (!sku) return;  // truly nothing to work with
    const skuMissing = !s.supplier_sku;
    const key = dedupeKey(s.supplier_name || src, sku);
    if (seen.has(key)) return;
    seen.add(key);
    list.push({
      supplier_name: s.supplier_name || src,
      supplier_sku:  sku,
      supplier_url:  s.supplier_url  || '',
      price_breaks:  s.price_breaks  || [],
      _skuMissing:   skuMissing,
    });
  });

  // Merged primary (fallback)
  const m = searchData.merged;
  if (m.supplier_sku) {
    const key = dedupeKey(m.supplier_name, m.supplier_sku);
    if (!seen.has(key)) {
      seen.add(key);
      list.push({ supplier_name: m.supplier_name, supplier_sku: m.supplier_sku,
                  supplier_url: m.supplier_url, price_breaks: m.price_breaks || [] });
    }
  }

  // Existing DB suppliers not already in the list
  (existingData?.supplier_parts || []).forEach(sp => {
    const key = dedupeKey(sp.supplier_name, sp.supplier_sku);
    if (!seen.has(key)) {
      seen.add(key);
      list.push({ ...sp, _dbOnly: true });
    }
  });
  return list;
}

function buildPriceRow(pb) {
  return `<tr>
    <td><input type="number" class="sp-price-input" value="${escHtml(pb.quantity)}" min="1" style="width:60px"></td>
    <td><input type="number" class="sp-price-input" value="${escHtml(pb.price)}" step="0.0001" style="width:80px"></td>
    <td><input type="text" class="sp-price-input" value="${escHtml(pb.currency||'EUR')}" style="width:50px"></td>
    <td><button type="button" class="sp-del-btn" onclick="delPbRow(this)">×</button></td>
  </tr>`;
}

function buildSupplierCard(s, idx) {
  const pbRows = (s.price_breaks || []).map(buildPriceRow).join('');
  return `
    <div class="sp-supplier-card" data-idx="${idx}">
      <div class="sp-supplier-header">
        <span class="sp-supplier-name">
          <i class="fas fa-store" style="color:var(--sp-primary)"></i>
          <input type="text" class="sp-input" value="${escHtml(s.supplier_name)}"
                 placeholder="Supplier Name" style="font-weight:700;max-width:220px"
                 data-original="${escHtml(s.supplier_name)}" oninput="trackEdit(this)">
          ${s._dbOnly ? '<span class="sp-badge sp-badge-db">DB</span>' : ''}
          ${s._skuMissing ? '<span class="sp-badge sp-badge-warn" title="Original SKU was empty — using MPN as fallback">⚠ SKU Fallback</span>' : ''}
        </span>
        <button type="button" class="sp-btn sp-btn-danger sp-btn-sm" onclick="delSupplier(this)">
          <i class="fas fa-trash"></i> Remove
        </button>
      </div>
      <div class="sp-field">
        <label>SKU</label>
        <div class="sp-input-wrap">
          <input type="text" class="sp-input" value="${escHtml(s.supplier_sku)}" placeholder="Supplier SKU"
                 data-original="${escHtml(s.supplier_sku)}" oninput="trackEdit(this)">
        </div>
      </div>
      <div class="sp-field">
        <label>URL</label>
        <div class="sp-input-wrap">
          <input type="text" class="sp-input" value="${escHtml(s.supplier_url)}" placeholder="Product Link"
                 data-original="${escHtml(s.supplier_url)}" oninput="trackEdit(this)">
        </div>
      </div>
      <div style="margin-top:.5rem">
        <strong style="font-size:.8rem">Price Breaks</strong>
        <table class="sp-price-table" style="margin-top:.25rem">
          <thead><tr><th>Quantity</th><th>Price</th><th>Currency</th><th></th></tr></thead>
          <tbody>${pbRows}</tbody>
        </table>
        <button type="button" class="sp-btn sp-btn-outline sp-btn-sm" style="margin-top:.4rem"
                onclick="addPbRow(this)"><i class="fas fa-plus"></i> Add Price</button>
      </div>
    </div>`;
}

/* ── Category select ───────────────────────────────────────────── */
function buildCategorySelect(categories, selectedId) {
  let opts = '<option value="">-- Select Category --</option>';
  (categories || []).forEach(c => {
    const sel = (c.id === selectedId) ? 'selected' : '';
    if (c.structural) {
      // Structural categories cannot hold parts; render as a disabled group header.
      opts += `<option value="${c.id}" disabled
                       style="color:var(--sp-text-muted,#888);font-style:italic;padding-left:.5rem"
                       title="Structural category – cannot hold parts">
               🔒 ${escHtml(c.name)}</option>`;
    } else {
      opts += `<option value="${c.id}" ${sel}>${escHtml(c.name)}</option>`;
    }
  });
  return `<select id="categorySelect" class="sp-input"
                  onchange="onCategoryChange(this)">${opts}</select>`;
}

/* ── Category change handler: gate parameters on category selection ── */
function onCategoryChange(sel) {
  const catId = parseInt(sel.value) || null;
  loadCategoryParameters(catId);
}

/**
 * Fetch allowed parameters for catId from the backend and update the
 * parameter section.  When catId is null/empty: hide the param table
 * and show a notice. When catId resolves: re-render only allowed params.
 */
function loadCategoryParameters(catId) {
  const paramSection = document.querySelector('.sp-editor-section #paramTbody')?.closest('.sp-editor-section');
  if (!paramSection) return;
  const requestId = ++categoryParameterRequest;
  categoryParameterTemplates = [];
  closeParameterDropdowns();

  if (!catId) {
    if (!window._limitParamsToCategory) return;
    // No valid category – hide table, show prompt
    const existing = paramSection.querySelector('#paramTbody');
    if (existing) existing.closest('table')?.parentElement && (existing.closest('table').style.display = 'none');
    let notice = paramSection.querySelector('#sp-cat-param-notice');
    if (!notice) {
      notice = document.createElement('p');
      notice.id = 'sp-cat-param-notice';
      notice.style.cssText = 'color:var(--sp-warning,#f59e0b);font-size:.85rem;margin:.5rem 0';
      paramSection.appendChild(notice);
    }
    notice.textContent = 'Select a valid category to display applicable parameters.';
    const dropBadge = paramSection.querySelector('#sp-dropped-badge');
    if (dropBadge) dropBadge.remove();
    return;
  }

  // Remove notice if present
  const notice = paramSection.querySelector('#sp-cat-param-notice');
  if (notice) notice.remove();

  // 1. Collect ONLY user-added manual rows (data-manual="true") and pre-existing DB rows
  const manualRows = [];
  const dbRows = [];
  const currentValues = {};

  document.querySelectorAll('#paramTbody tr').forEach(tr => {
    const inputs = tr.querySelectorAll('input');
    const name  = inputs[0]?.value.trim();
    const value = inputs[1]?.value.trim();
    const unit  = inputs[2]?.value.trim() || '';
    const isManual = tr.getAttribute('data-manual') === 'true';
    const status = tr.getAttribute('data-status');

    if (isManual && name) {
      manualRows.push({
        name,
        value,
        unit,
        status: 'new',
        dbVal: null,
        manual: true,
        source_name: tr.dataset.sourceName || '',
        source: tr.dataset.source || '',
      });
    } else if (status === 'db_only' && name) {
      dbRows.push({
        name,
        value,
        unit,
        status: 'db_only',
        dbVal: null,
        manual: false,
      });
    } else if (name) {
      currentValues[name.toLowerCase()] = { value, unit };
    }
  });

  // 2. Prepare attributes to filter from full distributor data
  const distributorAttrs = (window._searchData?.merged?.all_parameters || window._searchData?.merged?.parameters || []);
  const attrsToSend = distributorAttrs.length > 0
    ? distributorAttrs.map(attr => {
        const edited = currentValues[attr.name.toLowerCase()];
        return {
          name: attr.name,
          value: edited ? edited.value : attr.value,
          unit: edited ? edited.unit : (attr.unit || ''),
        };
      })
    : Object.keys(currentValues).map(k => ({
        name: k,
        value: currentValues[k].value,
        unit: currentValues[k].unit,
      }));

  return fetch('api/category/parameters/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
    body: JSON.stringify({ category_id: catId, attributes: window._limitParamsToCategory ? attrsToSend : [] }),
  })
  .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
  .then(data => {
    // Ignore responses for an older category or an editor that has been replaced.
    if (requestId !== categoryParameterRequest || !paramSection.isConnected) return;
    categoryParameterTemplates = data.templates || [];
    // A user may have opened a Name dropdown while the request was pending.
    paramSection.querySelectorAll('[data-choices="sp-param-names"][aria-expanded="true"]').forEach(button => {
      button.setAttribute('aria-expanded', 'false');
      button.nextElementSibling.hidden = true;
      toggleParameterDropdown(button);
    });
    if (!window._limitParamsToCategory) return;
    if (data.structural) {
      // Structural category slipped through – show warning, do not update
      let notice2 = paramSection.querySelector('#sp-cat-param-notice');
      if (!notice2) {
        notice2 = document.createElement('p');
        notice2.id = 'sp-cat-param-notice';
        notice2.style.cssText = 'color:var(--sp-danger,#ef4444);font-size:.85rem;margin:.5rem 0';
        paramSection.appendChild(notice2);
      }
      notice2.textContent = '⚠️ This is a structural (group) category and cannot hold parts. Please select a sub-category.';
      return;
    }

    // Category templates define the editable rows even when no supplier property
    // was inferred. Otherwise an empty accepted list removes every name control.
    const accepted = data.accepted_parameters || [];
    const dropped  = data.dropped_parameters  || [];

    const tbody = document.getElementById('paramTbody');
    if (!tbody) return;

    // Accepted rows from the category filter (distributor parameters)
    const acceptedRows = accepted.map(p => ({
      name: p.name,
      value: p.value,
      unit: p.unit || '',
      status: 'new',
      dbVal: null,
      manual: false,
    }));

    // Merge: accepted API rows + existing DB rows + user manual rows
    const mergedRows = [
      ...acceptedRows,
      ...dbRows,
      ...manualRows,
    ];
    const rowNames = new Set(mergedRows.map(p => p.name.toLowerCase()));
    (data.templates || []).forEach(template => {
      if (rowNames.has(template.name.toLowerCase())) return;
      const edited = currentValues[template.name.toLowerCase()];
      mergedRows.push({
        name: template.name,
        value: edited?.value || '',
        unit: edited?.unit || template.units || '',
        status: 'new',
        manual: false,
      });
      rowNames.add(template.name.toLowerCase());
    });

    tbody.innerHTML = mergedRows.map(buildParamRow).join('');

    // Show the table in case it was hidden
    const tbl = tbody.closest('table');
    if (tbl) tbl.style.display = '';

    // Dropped summary badge
    let dropBadge = paramSection.querySelector('#sp-dropped-badge');
    if (dropped.length > 0) {
      if (!dropBadge) {
        dropBadge = document.createElement('p');
        dropBadge.id = 'sp-dropped-badge';
        dropBadge.style.cssText = 'font-size:.8rem;color:var(--sp-text-muted,#888);margin:.4rem 0';
        paramSection.querySelector('.sp-param-table')?.insertAdjacentElement('afterend', dropBadge);
      }
      const names = dropped.map(d => escHtml(d.supplier_key || d.name || '')).join(', ');
      dropBadge.innerHTML = `<i class="fas fa-filter"></i> ${dropped.length} parameter(s) excluded by category filter: ${names}`;
    } else if (dropBadge) {
      dropBadge.remove();
    }
  })
  .catch(err => console.warn('SmartParts: loadCategoryParameters failed:', err));
}

/* ── Receive Stock section ─────────────────────────────────────── */
function buildReceiveStockSection(defaultQty) {
  return `
    <div class="sp-editor-section" id="receiveStockSection">
      <p class="sp-section-title" style="display:flex;align-items:center;gap:.6rem">
        <span>Receive Stock</span>
        <label style="font-size:.8rem;font-weight:400;display:flex;align-items:center;gap:.3rem;cursor:pointer">
          <input type="checkbox" id="enableReceive" onchange="toggleReceiveStock(this)"
                 ${defaultQty > 0 ? 'checked' : ''} style="width:14px;height:14px">
          Enable
        </label>
      </p>
      <div id="receiveStockFields" style="${defaultQty > 0 ? '' : 'display:none'}">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 1.5rem">
          <div class="sp-field">
            <label for="stockQty">Quantity</label>
            <div class="sp-input-wrap">
              <input type="number" id="stockQty" class="sp-input" value="${Math.max(1, Math.round(defaultQty || 1))}"
                     min="1" step="1" placeholder="1"
                     style="-moz-appearance:textfield">
            </div>
          </div>
          <div class="sp-field">
            <label for="stockBatch">Batch / Serial</label>
            <div class="sp-input-wrap">
              <input type="text" id="stockBatch" class="sp-input" placeholder="Optional batch code">
            </div>
          </div>
        </div>
        <div class="sp-field" style="margin-top:.5rem">
          <label for="stockLocation">Location</label>
          <div class="sp-input-wrap">
            <select id="stockLocation" class="sp-input">
              <option value="">⏳ Loading locations…</option>
            </select>
          </div>
        </div>
        <div style="margin-top:.5rem">
          <label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;font-size:.85rem">
            <input type="checkbox" id="stockDeleteOnDeplete" checked style="width:14px;height:14px">
            Delete stock item when quantity reaches zero
          </label>
        </div>
      </div>
    </div>`;
}

/* ── Label Printing section ────────────────────────────────────── */
function buildLabelSection() {
  return `
    <div class="sp-editor-section" id="labelSection" style="display:none">
      <p class="sp-section-title" style="display:flex;align-items:center;gap:.6rem">
        <i class="fas fa-tag" style="color:var(--sp-primary)"></i>
        <span>Label Printing</span>
      </p>
      <div style="display:grid;grid-template-columns:1fr auto;gap:.75rem;align-items:flex-end">
        <div class="sp-field" style="margin:0">
          <label for="labelTemplate">Label Template</label>
          <div class="sp-input-wrap">
            <select id="labelTemplate" class="sp-input">
              <option value="">⏳ Loading templates…</option>
            </select>
          </div>
        </div>
        <label style="display:flex;align-items:center;gap:.4rem;font-size:.85rem;
                      padding-bottom:.3rem;cursor:pointer;white-space:nowrap">
          <input type="checkbox" id="printLabel" checked style="width:14px;height:14px">
          Print on receive
        </label>
      </div>
      <div id="labelStatus" style="margin-top:.4rem;font-size:.8rem;display:none"></div>
    </div>`;
}

function toggleReceiveStock(cb) {
  const fields = document.getElementById('receiveStockFields');
  const labelSection = document.getElementById('labelSection');
  if (cb.checked) {
    fields.style.display = '';
    if (labelSection) labelSection.style.display = '';
  } else {
    fields.style.display = 'none';
    if (labelSection) labelSection.style.display = 'none';
  }
}
