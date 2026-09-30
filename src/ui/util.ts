export function download(data: Uint8Array | string, filename: string, mime: string): void {
  const blob = new Blob([typeof data === "string" ? data : (data as BlobPart)], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((res) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = accept;
    inp.onchange = () => res(inp.files?.[0] ?? null);
    inp.click();
  });
}

export const clamp = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x);

export function cx(...a: (string | false | null | undefined)[]): string {
  return a.filter(Boolean).join(" ");
}
