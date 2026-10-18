import { expect, test } from '@playwright/test';

/** Original fixture from public SVG syntax; no proprietary application data. */
const referenceSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
<defs>
  <linearGradient id="g"><stop offset="0" stop-color="#e12d78"/><stop offset="1" stop-color="#238aca"/></linearGradient>
  <radialGradient id="r"><stop offset="0" stop-color="white"/><stop offset="1" stop-color="#175e37"/></radialGradient>
  <clipPath id="c" transform="translate(4 2)"><path clip-rule="evenodd" d="M0 0H90V90H0Z M25 25H65V65H25Z"/></clipPath>
</defs>
<g transform="translate(25 20) rotate(10 50 50)">
  <rect width="110" height="110" rx="12" fill="url(#g)" clip-path="url(#c)"/>
  <ellipse cx="140" cy="55" rx="25" ry="40" fill="url(#r)" stroke="#333333" stroke-width="4"/>
</g>
<path d="M20 190 Q60 120 100 190 T180 190 A25 18 20 0 1 230 200" fill="none" stroke="#e89012" stroke-width="5"/>
</svg>`;

test('SVG editable round-trip visually preserves native gradients, transformed compound clipping and curve geometry', async ({ page }, info) => {
  await page.goto('/');
  const result = await page.evaluate(async source => {
    const modulePath = '/src/core/vector/svg.ts';
    const { importSVG, exportSVG } = await import(modulePath) as typeof import('../../src/core/vector/svg');
    const imported = importSVG(source), exported = exportSVG(imported.document);
    const reopened = importSVG(exported), exportedAgain = exportSVG(reopened.document);
    async function render(svg: string) {
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      try {
        const image = new Image(); image.src = url; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
        const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
        return { pixels: context.getImageData(0, 0, 256, 256).data, png: canvas.toDataURL('image/png').split(',')[1] };
      } finally { URL.revokeObjectURL(url); }
    }
    const reference = await render(source), roundTrip = await render(exported), secondRoundTrip = await render(exportedAgain);
    function difference(expected: Uint8ClampedArray, actual: Uint8ClampedArray) {
      let changedChannels = 0, totalError = 0, maximumChannelError = 0;
      for (let index = 0; index < actual.length; index++) { const error = Math.abs(expected[index] - actual[index]); if (error) changedChannels++; totalError += error; maximumChannelError = Math.max(maximumChannelError, error); }
      return { channelCount: actual.length, changedChannels, meanAbsoluteChannelError: totalError / actual.length, maximumChannelError };
    }
    let paintedPixels = 0; for (let index = 3; index < reference.pixels.length; index += 4) if (reference.pixels[index] > 0) paintedPixels++;
    return {
      warnings: [...imported.warnings, ...reopened.warnings], paintedPixels,
      originalVsEditable: difference(reference.pixels, roundTrip.pixels), reopenedVsEditable: difference(roundTrip.pixels, secondRoundTrip.pixels),
      objectTypes: imported.document.objects.map(object => object.type),
      compoundContours: imported.document.objects.filter(object => object.geometry?.fillRule === 'evenodd').map(object => object.geometry!.contours.length),
      png: { reference: reference.png, roundTrip: roundTrip.png },
    };
  }, referenceSVG);
  await info.attach('native-svg.png', { body: Buffer.from(result.png.reference, 'base64'), contentType: 'image/png' });
  await info.attach('editable-round-trip.png', { body: Buffer.from(result.png.roundTrip, 'base64'), contentType: 'image/png' });
  const { png: _png, ...metrics } = result;
  await info.attach('svg-visual-comparison.json', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' });
  expect(result.warnings).toEqual([]);
  expect(result.paintedPixels).toBeGreaterThan(5000);
  expect(result.objectTypes.filter(type => type === 'path').length).toBeGreaterThanOrEqual(4);
  expect(result.compoundContours).toContain(2);
  // Arc conversion uses bounded cubic approximation. Antialiased edge samples
  // may change; overall channel error must remain below 0.15 on the 0..255 scale.
  expect(result.originalVsEditable.meanAbsoluteChannelError).toBeLessThan(.15);
  expect(result.originalVsEditable.changedChannels / result.originalVsEditable.channelCount).toBeLessThan(.01);
  expect(result.reopenedVsEditable.meanAbsoluteChannelError).toBeLessThan(.01);
});
