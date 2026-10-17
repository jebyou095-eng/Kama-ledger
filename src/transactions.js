export function parseTransactionLine(line) {
  const normalized = String(line || '').replace(/[\u00a0\u202f]/g, ' ').replace(/^\[\d{1,2}:\d{2}\]\s*/, '').trim();
  const time = String(line || '').match(/^\[(\d{1,2}:\d{2})\]/);
  if (!time) return null;
  const sale = normalized.match(/^Banque\s*:\s*\+\s*([\d\s,.]+)\s*Kamas\b(?:.*)?$/i);
  if (sale) {
    const item = normalized.match(/vente\s*:\s*(\d+)\s*x\s+\[([^\]]+)\]/i);
    return {
      type: 'sale',
      amount: Number(sale[1].replace(/\D/g, '')),
      item: item ? item[2].trim() : 'Vente (banque)',
      quantity: item ? Number(item[1]) : null,
      time: time ? time[1] : null,
      line: String(line || '').trim(),
    };
  }

  const purchase = normalized.match(/^(\d[\d ]*)\s*x\s+\[([^\]]+)\]\s*\(([\d\s,.]+)\s*kamas\)(?:\s.*)?$/i);
  if (purchase) {
    return {
      type: 'purchase',
      quantity: Number(purchase[1].replace(/\D/g, '')),
      item: purchase[2].trim(),
      amount: Number(purchase[3].replace(/\D/g, '')),
      time: time ? time[1] : null,
      line: String(line || '').trim(),
    };
  }

  return null;
}

export function classifyTransactionLine(line) {
  const transaction = parseTransactionLine(line);
  return transaction ? transaction.type : null;
}

export function normLine(raw) {
  let normalized = String(raw || '').replace(/[\u00a0\u202f]/g, ' ').replace(/×/g, 'x').trim();
  if (!normalized) return '';
  const time = normalized.match(/^(\[\d{1,2}:\d{2}\])\s*/);
  const prefix = time ? `${time[1]} ` : '';
  normalized = normalized.replace(/^\[\d{1,2}:\d{2}\]\s*/, '');
  if (/Banque/i.test(normalized)) {
    const bank = normalized.match(/\+\s*([\dOoIlIS .,]+?)\s*Kamas\b(.*)$/i);
    if (!bank) return normalized;
    const amount = bank[1].replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/S/g, '5').replace(/[^\d]/g, '');
    return `${prefix}Banque : + ${Number(amount).toLocaleString('fr-FR')} Kamas${bank[2]}`;
  }
  const purchase = normalized.match(/^(\d[\dOoIlIS ]*)\s*x\s+\[([^\]]+)\]\s*\(([\dOoIlISB .,]+)\s*kamas\)$/i);
  if (!purchase) return normalized;
  const quantity = purchase[1].replace(/\D/g, '');
  const amount = purchase[3].replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/[SB]/g, (digit) => digit === 'S' ? '5' : '8').replace(/\D/g, '');
  return `${prefix}${quantity} x [${purchase[2].trim()}] (${Number(amount).toLocaleString('fr-FR')} kamas)`;
}

export function transactionLines(lines) {
  return lines.reduce((matches, line) => {
    const transaction = parseTransactionLine(line);
    if (transaction) matches.push(transaction);
    return matches;
  }, []);
}

export function mergeLedgerHistory(existing, transactions, captureIds, recordedAt) {
  const history = Array.isArray(existing) ? existing.slice() : [];
  const sourceCaptureIds = Array.isArray(captureIds) ? captureIds : [];
  const sourceKey = sourceCaptureIds.join(',') || 'manual';
  const occurrenceBySignature = {};

  transactions.forEach((transaction) => {
    const signature = [transaction.type, transaction.time, transaction.item, transaction.amount, transaction.quantity || 0].join('|');
    const occurrence = occurrenceBySignature[signature] || 0;
    occurrenceBySignature[signature] = occurrence + 1;
    const key = `${sourceKey}|${signature}|${occurrence}`;
    if (history.some((entry) => entry.key === key)) return;
    history.push({
      key,
      type: transaction.type,
      item: transaction.item,
      amount: transaction.amount,
      quantity: transaction.quantity || null,
      time: transaction.time,
      recordedAt,
      sourceCaptureIds,
      line: transaction.line,
    });
  });

  return history;
}

export const PANEL_TYPES = [
  { id: 'chat', label: 'Chat', aliases: ['chat'] },
  { id: 'recipes', label: 'Recettes', aliases: ['recettes', 'recipe', 'recipes'] },
  { id: 'market-chart', label: 'Cours du marché', aliases: ['cours du marche', 'cours du marché', 'market price', 'price history'] },
  { id: 'market-list', label: 'Hôtel de vente', aliases: ['hotel de vente', 'hôtel de vente', 'price estimations'] },
  { id: 'inventory', label: 'Inventaire', aliases: ['inventaire', 'inventory'] },
  { id: 'brisage', label: 'Brisage', aliases: ['brisage', 'concassed', 'concassé', 'concassee', 'concassée'] },
];

function normalizePanelText(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function classifyPanel(lines, regionLabel) {
  const label = normalizePanelText(regionLabel);
  if (label && label !== 'auto' && label !== 'automatic') {
    const byRegion = PANEL_TYPES.find((panel) => panel.id === label || normalizePanelText(panel.label) === label);
    if (byRegion) return { panel: byRegion.id, label: byRegion.label, source: 'region', confidence: 1 };
  }

  const text = normalizePanelText(Array.isArray(lines) ? lines.slice(0, 8).join(' ') : lines);
  const panel = PANEL_TYPES.find((candidate) => candidate.aliases.some((alias) => text.includes(normalizePanelText(alias))));
  return panel
    ? { panel: panel.id, label: panel.label, source: 'title', confidence: 1 }
    : { panel: 'unclassified', label: 'Unclassified', source: 'unclassified', confidence: 0 };
}

export function analyzePanel(lines, regionLabel) {
  const classification = classifyPanel(lines, regionLabel);
  if (classification.panel === 'chat') {
    return { ...classification, transactions: transactionLines(lines), ignoredLines: lines.filter((line) => !parseTransactionLine(line)) };
  }
  if (classification.panel === 'recipes') {
    const ingredients = lines.map((line) => {
      const match = String(line).match(/^\s*(\d+)\s*x\s+\[([^\]]+)\]/i);
      return match ? { quantity: Number(match[1]), item: match[2].trim(), line } : null;
    }).filter(Boolean);
    return { ...classification, ingredients };
  }
  return { ...classification, lines: lines.slice() };
}

export function transactionToLine(transaction) {
  const time = transaction.time ? `[${transaction.time}] ` : '';
  const quantity = Number(transaction.quantity) > 0 ? Number(transaction.quantity) : 1;
  const amount = (Number(transaction.amount) || 0).toLocaleString('fr-FR');
  const item = String(transaction.item || '').trim();
  if (transaction.type === 'sale') {
    const detail = item && item !== 'Vente (banque)' ? ` (vente : ${quantity} x [${item}])` : '';
    return `${time}Banque : + ${amount} Kamas${detail}`;
  }
  return `${time}${quantity} x [${item}] (${amount} kamas)`;
}

function cleanPatch(patch) {
  const clean = {};
  if (typeof patch.item === 'string' && patch.item.trim()) clean.item = patch.item.trim();
  if (patch.amount !== undefined && Number.isFinite(Number(patch.amount)) && Number(patch.amount) >= 0) clean.amount = Math.round(Number(patch.amount));
  if (patch.quantity === null || patch.quantity === '') clean.quantity = null;
  else if (patch.quantity !== undefined && Number.isFinite(Number(patch.quantity)) && Number(patch.quantity) >= 1) clean.quantity = Math.round(Number(patch.quantity));
  if (patch.type === 'sale' || patch.type === 'purchase') clean.type = patch.type;
  return clean;
}

export function cleanTransactionPatch(patch) {
  return cleanPatch(patch || {});
}

export function updateLedgerEntry(history, key, patch) {
  return history.map((entry) => {
    if (entry.key !== key) return entry;
    const merged = { ...entry, ...cleanPatch(patch || {}), edited: true };
    merged.line = transactionToLine(merged);
    return merged;
  });
}

export function removeLedgerEntry(history, key) {
  return history.filter((entry) => entry.key !== key);
}
