import { mkdir, readFile, rename, rm, writeFile } from "fs/promises";
import path from "path";
import { del, get, put } from "@vercel/blob";

/**
 * JSON documents in the private Vercel Blob store. For local development without a Blob token, set
 * LOCAL_BLOB_DIR to a folder and the same paths are read from / written to disk instead.
 */
const localDir = process.env.LOCAL_BLOB_DIR?.trim();

function localPath(pathname: string): string {
  return path.join(localDir as string, pathname);
}

export async function readJson<T>(pathname: string): Promise<T | null> {
  if (localDir) {
    try {
      return JSON.parse(await readFile(localPath(pathname), "utf8")) as T;
    } catch {
      return null;
    }
  }
  try {
    const result = await get(pathname, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200) return null;
    return (await new Response(result.stream).json()) as T;
  } catch {
    // Blob store unreachable (e.g. no BLOB_READ_WRITE_TOKEN in this environment) - treat as not-yet-created.
    return null;
  }
}

export async function writeJson(pathname: string, data: unknown): Promise<void> {
  if (localDir) {
    // Write-then-rename so a concurrent read never sees a half-written file.
    const target = localPath(pathname);
    await mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, JSON.stringify(data));
    await rename(temp, target);
    return;
  }
  await put(pathname, JSON.stringify(data), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

export async function deleteJson(pathnames: string[]): Promise<void> {
  if (localDir) {
    await Promise.all(pathnames.map((p) => rm(localPath(p), { force: true })));
    return;
  }
  await del(pathnames);
}

/** Binary files (images) in the same private store; LOCAL_BLOB_DIR applies here too. */
export async function writeBinary(pathname: string, data: Uint8Array, contentType: string): Promise<void> {
  if (localDir) {
    const target = localPath(pathname);
    await mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, data);
    await rename(temp, target);
    return;
  }
  await put(pathname, Buffer.from(data), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType,
  });
}

export async function readBinary(pathname: string): Promise<Uint8Array | null> {
  if (localDir) {
    try {
      return new Uint8Array(await readFile(localPath(pathname)));
    } catch {
      return null;
    }
  }
  try {
    const result = await get(pathname, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200) return null;
    return new Uint8Array(await new Response(result.stream).arrayBuffer());
  } catch {
    return null;
  }
}
