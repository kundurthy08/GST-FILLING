// Browser File System Access API helper (Chrome/Edge) for connecting one local folder
// where input files are picked and generated outputs are written to an output_files/ subfolder.

let connectedDirHandle: any = null;

export function isFolderPickerSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return typeof (window as any).showDirectoryPicker === 'function' && window.self === window.top;
}

export function getConnectedFolderName(): string | null {
  return connectedDirHandle ? connectedDirHandle.name : null;
}

export function disconnectWorkspaceFolder(): void {
  connectedDirHandle = null;
}

export async function connectWorkspaceFolder(): Promise<{ name: string }> {
  if (typeof (window as any).showDirectoryPicker !== 'function') {
    throw new Error('Your browser does not support direct local folder access. Use Chrome or Edge in a standalone tab, or use standard file upload/download.');
  }
  const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
  connectedDirHandle = handle;
  return { name: handle.name };
}

export interface LocalFolderFile {
  name: string;
  subpath: string;
  file: File;
}

const ALLOWED_EXT = /\.(xlsx|xls|csv|json)$/i;

export async function listConnectedInputFiles(): Promise<LocalFolderFile[]> {
  if (!connectedDirHandle) return [];
  const files: LocalFolderFile[] = [];

  for await (const [name, handle] of connectedDirHandle.entries()) {
    if (handle.kind === 'file' && ALLOWED_EXT.test(name)) {
      const f = await handle.getFile();
      files.push({ name, subpath: name, file: f });
    } else if (handle.kind === 'directory' && name.toLowerCase() === 'input_files') {
      for await (const [subName, subHandle] of handle.entries()) {
        if (subHandle.kind === 'file' && ALLOWED_EXT.test(subName)) {
          const f = await subHandle.getFile();
          files.push({ name: subName, subpath: `input_files/${subName}`, file: f });
        }
      }
    }
  }
  return files.sort((a, b) => a.subpath.localeCompare(b.subpath));
}

export async function saveOutputToConnectedFolder(filename: string, blob: Blob): Promise<string | null> {
  if (!connectedDirHandle) return null;
  const outputSubdir = await connectedDirHandle.getDirectoryHandle('output_files', { create: true });
  const fileHandle = await outputSubdir.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
  return `${connectedDirHandle.name}/output_files/${filename}`;
}
