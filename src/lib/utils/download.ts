export async function downloadFromUrl(url: string, filename?: string): Promise<void> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed with status ${res.status}`);
    const blob = await res.blob();
    const ext = blob.type.split('/')[1]?.split('+')[0] ?? 'jpg';
    const name = filename
      ? /\.[a-z0-9]+$/i.test(filename) ? filename : `${filename}.${ext}`
      : `download-${Date.now()}.${ext}`;
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch {
    window.open(url, '_blank');
  }
}

export async function downloadAllFromUrls(urls: string[], filenamePrefix: string): Promise<void> {
  for (const [index, url] of urls.entries()) {
    await downloadFromUrl(url, `${filenamePrefix}-${index + 1}`);

    // Give the browser time to register each file as a distinct download.
    if (index < urls.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }
}
