/**
 * The sink a download writes into. Chromium's File System Access API is the
 * only web API that streams a chosen file straight to disk; browsers without
 * it use the service-worker download pump instead.
 */
export type DownloadSink = {
  write(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
};

type WritableLike = {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
};

type FileHandleLike = { createWritable(): Promise<WritableLike> };

export type SaveFilePicker = (options?: { suggestedName?: string }) => Promise<FileHandleLike>;

export function fileSystemAccessAvailable(): boolean {
  return typeof window !== "undefined"
    && typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === "function";
}

/**
 * Open the browser's save picker and return a streaming sink. Call this
 * synchronously from a click handler: the picker needs transient activation,
 * and an await before it would lose the gesture on Chromium.
 */
export async function pickFileSink(name: string, picker?: SaveFilePicker): Promise<DownloadSink> {
  const choose = picker ?? (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (!choose) throw new Error("showSaveFilePicker is unavailable");
  const handle = await choose({ suggestedName: name });
  const writable = await handle.createWritable();
  return {
    write: (bytes) => writable.write(bytes),
    close: () => writable.close(),
    abort: () => writable.abort(),
  };
}

/** The picker's own cancel is a normal answer, not a download failure. */
export function isPickerCancel(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : Boolean(error && typeof error === "object" && (error as { name?: unknown }).name === "AbortError");
}
