/** Keep the editable project title; normalize only the proposed portable file name. */
export function portableFilename(name: string): string {
  const cleaned = name.normalize('NFC').replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').replace(/[. ]+(?=\.[^.]+$)/g, '').slice(0, 170);
  return /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(cleaned) ? `STULOOMA-${cleaned}` : cleaned;
}
