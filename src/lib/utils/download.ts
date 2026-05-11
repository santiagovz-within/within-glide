export async function downloadFromUrl(url: string, filename?: string): Promise<void> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const ext = blob.type.split('/')[1]?.split('+')[0] ?? 'jpg';
    const name = filename ?? `download-${Date.now()}.${ext}`;
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
