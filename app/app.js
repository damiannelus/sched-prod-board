import { fetchIncidents, ack } from './api.js';

const REFRESH_MS = 2000; // R4

const board = document.querySelector('[data-testid="board"]');
const list = board.querySelector('[data-testid="incident-list"]');
const loader = board.querySelector('[data-testid="loader"]');
const empty = board.querySelector('[data-testid="empty"]');
const error = board.querySelector('.error');

/** id -> the ack API's reply, for rows this viewer acked. */
const acked = new Map();
/** id -> its <li>, so a refresh moves rows instead of rebuilding them. */
const rows = new Map();

// R5: the viewer's own zone and their locale's own day/month order.
const when = new Intl.DateTimeFormat(undefined, {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function el(tag, props = {}, text = '') {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) node.setAttribute(k, v);
  node.textContent = text; // API text is never parsed as HTML
  return node;
}

function localTime(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : when.format(date);
}

function markAcked(row, reply) {
  row.querySelector('[data-testid="ack"]')?.remove();
  if (row.querySelector('[data-testid="acked"]')) return;
  const at = new Date(reply.ackedAt);
  const mark = el('span', { 'data-testid': 'acked', class: 'acked' }, `acked ${Number.isNaN(at.getTime()) ? '' : clock.format(at)}`.trim());
  row.classList.add('is-acked');
  row.append(mark);
}

async function onAck(id, row, button) {
  button.disabled = true;
  button.textContent = 'Acking…';
  row.querySelector('.ack-error')?.remove();
  try {
    const reply = await ack(id); // R2
    acked.set(id, reply);
    markAcked(row, reply);
  } catch (err) {
    button.disabled = false;
    button.textContent = 'Ack';
    row.append(el('span', { class: 'ack-error', role: 'alert' }, 'Ack failed. Try again.'));
    console.error(err);
  }
}

function buildRow(i) {
  const row = el('li', { 'data-testid': 'incident-row', 'data-id': i.id, class: `row ${/^sev\d$/.test(i.severity) ? i.severity : ''}` });
  const time = el('time', { datetime: i.openedAt, title: i.openedAt }, localTime(i.openedAt));
  const button = el('button', { 'data-testid': 'ack', type: 'button', 'aria-label': `Ack ${i.id}` }, 'Ack');
  button.addEventListener('click', () => onAck(i.id, row, button));
  row.append(
    el('span', { class: 'id' }, i.id),
    el('span', { class: 'sev' }, i.severity),
    el('span', { class: 'what' }, `${i.service} · ${i.region} · ${i.summary}`),
    time,
    button,
  );
  return row;
}

function render(incidents) {
  const seen = new Set();
  let before = list.firstElementChild;
  for (const i of incidents) {
    seen.add(i.id);
    let row = rows.get(i.id);
    if (!row) {
      row = buildRow(i);
      rows.set(i.id, row);
      if (acked.has(i.id)) markAcked(row, acked.get(i.id));
    }
    // Keep the API's order (newest first, R1); only touch the DOM when a row is out of place.
    if (row !== before) list.insertBefore(row, before);
    else before = before.nextElementSibling;
  }
  for (const [id, row] of rows) {
    if (!seen.has(id)) {
      row.remove();
      rows.delete(id);
    }
  }
  empty.hidden = incidents.length > 0;
}

let loaded = false;
async function refresh() {
  try {
    const page = await fetchIncidents();
    render(Array.isArray(page.incidents) ? page.incidents : []);
    if (!loaded) {
      loaded = true;
      loader.remove(); // R3: gone once incidents load
    }
    error.hidden = true;
  } catch (err) {
    error.textContent = loaded ? 'Board is not updating. Retrying…' : 'Could not load incidents. Retrying…';
    error.hidden = false;
    console.error(err);
  } finally {
    setTimeout(refresh, REFRESH_MS); // R4: next refresh 2 s after this one settles
  }
}

refresh();
