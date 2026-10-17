export function parseTransactionLine(line) {
  const normalized = String(line || '').replace(/[\u00a0\u202f]/g, ' ').replace(/^\[\d{1,2}:\d{2}\]\s*/, '').trim();
  const time = String(line || '').match(/^\[(\d{1,2}:\d{2})\]/);
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