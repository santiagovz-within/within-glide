const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

function extensionForBlob(blob: Blob): string {
  return MIME_EXTENSIONS[blob.type] ?? blob.type.split('/')[1]?.split('+')[0] ?? 'jpg';
}

function downloadBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export async function downloadFromUrl(url: string, filename?: string): Promise<void> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed with status ${res.status}`);
    const blob = await res.blob();
    const ext = extensionForBlob(blob);
    const name = filename
      ? /\.[a-z0-9]+$/i.test(filename) ? filename : `${filename}.${ext}`
      : `download-${Date.now()}.${ext}`;
    downloadBlob(blob, name);
  } catch {
    window.open(url, '_blank');
  }
}

export async function downloadAllFromUrls(urls: string[], filenamePrefix: string): Promise<void> {
  if (urls.length === 0) return;
  if (urls.length === 1) {
    await downloadFromUrl(urls[0], filenamePrefix);
    return;
  }

  const responses = await Promise.all(urls.map(async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed with status ${response.status}`);
    return response.blob();
  }));
  const files = responses.map((blob, index) => ({
    name: `${filenamePrefix}-${index + 1}.${extensionForBlob(blob)}`,
    input: blob,
  }));
  const { downloadZip } = await import('client-zip');
  const zipBlob = await downloadZip(files).blob();
  downloadBlob(zipBlob, `${filenamePrefix}.zip`);
}
