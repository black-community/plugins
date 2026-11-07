/*
 * The file system isomorphic-git reads and writes. Every path it uses starts at DIR, which stands for the project's folder.
 * Each call goes to the app (app.folder), which checks the path. The app says "not there" with null, and this turns
 * that into Node's error codes, which is how isomorphic-git tells "not there" from a failure.
 */

/** Where isomorphic-git thinks the project is. It isn't a real place. */
export const DIR = "/project";

/** What the plugin needs from a project's folder: app.folder, with the project's key filled in. */
export interface FolderAccess {
  read(rel: string): Promise<Uint8Array | null>;
  write(rel: string, data: string | Uint8Array): Promise<void>;
  remove(rel: string): Promise<boolean>;
  list(rel: string): Promise<{ name: string; folder: boolean; link: boolean }[] | null>;
  stat(rel: string): Promise<FolderStatLike | null>;
  mkdir(rel: string): Promise<void>;
  rmdir(rel: string): Promise<boolean>;
}

export interface FolderStatLike {
  folder: boolean;
  link: boolean;
  size: number;
  mode: number;
  mtimeMs: number;
  ctimeMs: number;
  ino: number;
  uid: number;
  gid: number;
  dev: number;
}

function fail(code: string, path: string): never {
  throw Object.assign(new Error(`${code}: ${path}`), { code });
}

/** Turns one of isomorphic-git's paths into a path in the project. Anything that isn't in it is a path to nowhere. */
function inProject(path: string) {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  if (parts[0] !== DIR.slice(1)) fail("ENOENT", path);
  return parts.slice(1).join("/");
}

const statResult = (st: FolderStatLike) => ({
  isFile: () => !st.folder && !st.link,
  isDirectory: () => st.folder,
  isSymbolicLink: () => st.link,
  size: st.size,
  mode: st.mode,
  mtimeMs: st.mtimeMs,
  ctimeMs: st.ctimeMs,
  ino: st.ino,
  uid: st.uid,
  gid: st.gid,
  dev: st.dev,
});

/** Builds the file system for one project's folder. */
export function folderFs(folder: FolderAccess) {
  const decoder = new TextDecoder();
  const stat = async (path: string) => {
    const st = await folder.stat(inProject(path));
    if (!st) fail("ENOENT", path);
    return statResult(st);
  };
  return {
    promises: {
      async readFile(path: string, options?: string | { encoding?: string }) {
        const encoding = typeof options === "string" ? options : options?.encoding;
        const bytes = await folder.read(inProject(path));
        if (!bytes) fail("ENOENT", path);
        return encoding === "utf8" || encoding === "utf-8" ? decoder.decode(bytes) : bytes;
      },
      async writeFile(path: string, data: string | Uint8Array) {
        await folder.write(inProject(path), data);
      },
      async unlink(path: string) {
        if (!(await folder.remove(inProject(path)))) fail("ENOENT", path);
      },
      async readdir(path: string) {
        const entries = await folder.list(inProject(path));
        if (!entries) fail("ENOENT", path);
        // A link is never followed or kept in a version, so as far as git goes it isn't there. Nor is a temporary file: the
        // app writes one beside a file for a moment, and it may be gone by the time git looks at it.
        return entries.filter((e) => !e.link && !e.name.endsWith(".tmp")).map((e) => e.name);
      },
      async mkdir(path: string) {
        await folder.mkdir(inProject(path));
      },
      async rmdir(path: string) {
        if (!(await folder.rmdir(inProject(path)))) fail("ENOTEMPTY", path);
      },
      stat,
      lstat: stat,
      async readlink(path: string): Promise<string> {
        return fail("ENOENT", path);
      },
      async symlink(_target: string, path: string) {
        fail("ENOTSUP", path);
      },
      async chmod() {},
    },
  };
}

/** A file system in memory, for looking at what a repository's branches hold without keeping anything. */
export function memoryFs() {
  const files = new Map<string, Uint8Array>();
  const folders = new Set<string>(["/"]);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const clean = (p: string) => "/" + p.split("/").filter((x) => x && x !== ".").join("/");
  const stat = async (given: string) => {
    const p = clean(given);
    const file = files.get(p);
    if (!file && !folders.has(p)) fail("ENOENT", p);
    return statResult({ folder: !file, link: false, size: file?.length ?? 0, mode: file ? 0o100644 : 0o40755, mtimeMs: 0, ctimeMs: 0, ino: 0, uid: 0, gid: 0, dev: 0 });
  };
  const makeFolders = (p: string) => {
    let at = "";
    for (const part of p.split("/").filter(Boolean)) {
      at += `/${part}`;
      folders.add(at);
    }
  };
  return {
    promises: {
      async readFile(given: string, options?: string | { encoding?: string }) {
        const bytes = files.get(clean(given));
        if (!bytes) fail("ENOENT", given);
        const encoding = typeof options === "string" ? options : options?.encoding;
        return encoding === "utf8" || encoding === "utf-8" ? decoder.decode(bytes) : bytes;
      },
      async writeFile(given: string, data: string | Uint8Array) {
        const p = clean(given);
        makeFolders(p.slice(0, p.lastIndexOf("/")));
        files.set(p, typeof data === "string" ? encoder.encode(data) : data);
      },
      async unlink(given: string) {
        if (!files.delete(clean(given))) fail("ENOENT", given);
      },
      async readdir(given: string) {
        const p = clean(given);
        if (!folders.has(p)) fail("ENOENT", given);
        const prefix = p === "/" ? "/" : `${p}/`;
        const names = new Set<string>();
        for (const name of [...files.keys(), ...folders]) if (name !== p && name.startsWith(prefix)) names.add(name.slice(prefix.length).split("/")[0]);
        return [...names];
      },
      async mkdir(given: string) {
        makeFolders(clean(given));
      },
      async rmdir(given: string) {
        folders.delete(clean(given));
      },
      stat,
      lstat: stat,
      async readlink(given: string): Promise<string> {
        return fail("ENOENT", given);
      },
      async symlink(_target: string, given: string) {
        fail("ENOTSUP", given);
      },
      async chmod() {},
    },
  };
}
