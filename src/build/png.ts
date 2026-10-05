/**
 * Rasterise a self-contained SVG element (inline attributes only, like the drawing sheets) to a PNG.
 * `width` is the output width in pixels; height follows the viewBox aspect.
 */
export async function svgToPng(svg: SVGSVGElement, width = 3300): Promise<Blob> {
  const vb = svg.viewBox.baseVal;
  const aspect = vb && vb.width > 0 ? vb.height / vb.width : 0.65;
  const height = Math.round(width * aspect);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  const xml = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not render the drawing'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the PNG'))), 'image/png'),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
