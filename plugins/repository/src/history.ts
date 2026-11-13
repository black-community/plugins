import git, { type HttpClient } from "isomorphic-git";
import { DIR, folderFs, memoryFs, type FolderAccess } from "./fs";
import { safeTreePath } from "./address";
import { mergeFiles, sameBytes, type Files } from "./merge";

/*
 * The version history itself: isomorphic-git over the project's folder, the same on a computer and on a phone. There's one
 * repository at the top of a project, for one book or several.
 *
 * Nothing here runs a program, and isomorphic-git has no code that could: it doesn't know about hooks, drivers, filters or
 * SSH. What a repository's .git/config says matters in only a few places, and those are set explicitly below: the
 * address is always given (never a remote from the config), so is the author, and `corsProxy` is always
 * set, because otherwise isomorphic-git takes it from the config and would send the token there.
 */

const GITIGNORE = "*.tmp\n.DS_Store\n";
/** The name of the remote that isomorphic-git fetches from. It's set to the repository's address each time. */
const REMOTE = "repository";
/** Never a proxy, whatever .git/config says. */
const NO_PROXY = "";

export interface Entry {
  hash: string;
  date: string;
  message: string;
}

export interface SyncResult {
  ok: boolean;
  /** Why it failed, if it failed. */
  message: string;
  /** Files the sync changed on this device, so the open book can reload them. */
  changed: string[];
  /** Documents changed on both sides. The local version stays as it was, and the other version is saved as a snapshot. */
  conflicts: string[];
}

export interface RemoteBook {
  branch: string;
  kind: "book" | "series";
  title: string;
}

export interface Login {
  user: string;
  token: string;
}

export interface Texts {
  beforeSync: string;
  merged: string;
  nothingToPush: string;
  /** Turns a failed request's error into a message for the writer. */
  describe: (err: unknown) => string;
}

/** Everything needed to work on one project's history. Each project gets its own, because isomorphic-git caches by path. */
export interface Repo {
  folder: FolderAccess;
  fs: ReturnType<typeof folderFs>;
  http: HttpClient;
  cache: object;
  login: () => Login;
  /** The trees read so far, by id, for finding a file in many commits quickly. */
  trees: Map<string, { path: string; oid: string; type: string }[]>;
  /** A commit's file, by "commit:file", once found. */
  blobs: Map<string, string>;
}

export const makeRepo = (folder: FolderAccess, http: HttpClient, login: () => Login): Repo => ({
  folder,
  fs: folderFs(folder),
  http,
  cache: {},
  login,
  trees: new Map(),
  blobs: new Map(),
});

const base = (r: Repo) => ({ fs: r.fs, dir: DIR, cache: r.cache });
const onAuth = (r: Repo) => () => {
  const { user, token } = r.login();
  return token ? { username: user || "git", password: token } : { cancel: true };
};
const author = (r: Repo) => {
  const user = r.login().user;
  return { name: user || "Bläck Studio", email: `${user || "black"}@localhost` };
};

/** Makes the project a repository if it isn't one. A .git that's a file could point anywhere, so it isn't used. */
export async function initRepo(r: Repo) {
  const st = await r.folder.stat(".git");
  if (st && !st.folder) throw new Error("not-a-folder");
  if (st && (await r.folder.stat(".git/HEAD"))) return;
  await git.init({ fs: r.fs, dir: DIR, defaultBranch: "main" });
  const lines = new TextDecoder()
    .decode((await r.folder.read(".gitignore")) ?? new Uint8Array())
    .split("\n")
    .filter(Boolean);
  for (const line of GITIGNORE.split("\n").filter(Boolean)) if (!lines.includes(line)) lines.push(line);
  await r.folder.write(".gitignore", lines.join("\n") + "\n");
}

const headOf = (r: Repo) => git.resolveRef({ ...base(r), ref: "HEAD" }).catch(() => "");

/** Stages the folder's current files for the next commit, leaving out .git. Returns how many changed. */
export async function stageAll(r: Repo) {
  const matrix = await git.statusMatrix(base(r));
  const add: string[] = [];
  const remove: string[] = [];
  for (const [file, head, work, stage] of matrix) {
    if (head === work && work === stage) continue;
    (work === 0 ? remove : add).push(file);
  }
  if (add.length) await git.add({ ...base(r), filepath: add, parallel: true });
  for (const file of remove) await git.remove({ ...base(r), filepath: file });
  return add.length + remove.length;
}

/** Commits everything that changed. Returns the new commit, or null if nothing changed. */
export async function commit(r: Repo, message: string, parent?: string[]) {
  await initRepo(r);
  const changed = await stageAll(r);
  if (!changed && !parent && (await headOf(r))) return null;
  return git.commit({ ...base(r), message, author: author(r), ...(parent ? { parent } : {}) });
}

/** Returns whether the history has any versions yet. */
export const hasCommits = async (r: Repo) => !!(await headOf(r));

/** Returns the id of a file's contents in a commit, or '' if the commit doesn't have it. Trees are shared between commits, so most are read only once. */
async function blobIn(r: Repo, commitOid: string, tree: string, file: string) {
  const key = `${commitOid}:${file}`;
  const known = r.blobs.get(key);
  if (known !== undefined) return known;
  let at = tree;
  let oid = "";
  const parts = file.split("/");
  for (let i = 0; i < parts.length; i++) {
    let entries = r.trees.get(at);
    if (!entries) {
      const read = await git.readTree({ ...base(r), oid: at });
      entries = read.tree.map((e) => ({ path: e.path, oid: e.oid, type: e.type }));
      r.trees.set(at, entries);
    }
    const found = entries.find((e) => e.path === parts[i]);
    if (!found) break;
    if (i === parts.length - 1) oid = found.type === "blob" ? found.oid : "";
    else at = found.oid;
  }
  r.blobs.set(key, oid);
  return oid;
}

/** Returns recent commits, newest first, optionally only those that changed one file. */
export async function log(r: Repo, file?: string): Promise<Entry[]> {
  if (!(await headOf(r))) return [];
  const commits = await git.log({ ...base(r), depth: 300 }).catch(() => []);
  const entry = (c: (typeof commits)[number]) => ({
    hash: c.oid,
    date: new Date(c.commit.committer.timestamp * 1000).toISOString(),
    message: c.commit.message.trim(),
  });
  if (!file) return commits.map(entry);
  const out: Entry[] = [];
  for (const c of commits) {
    const mine = await blobIn(r, c.oid, c.commit.tree, file);
    const parent = c.commit.parent[0];
    let before = "";
    if (parent) {
      const up = commits.find((x) => x.oid === parent) ?? (await git.readCommit({ ...base(r), oid: parent }).catch(() => null));
      if (up) before = await blobIn(r, up.oid, up.commit.tree, file);
    }
    if (mine && mine !== before) out.push(entry(c));
  }
  return out;
}

/** Returns a file's bytes as it was at a commit, or null if it wasn't there. */
export async function fileAt(r: Repo, oid: string, file: string) {
  if (!/^[0-9a-f]{7,64}$/.test(oid) || !safeTreePath(file)) return null;
  const read = await git.readBlob({ ...base(r), oid, filepath: file }).catch(() => null);
  return read?.blob ?? null;
}

/** Fetches `branch` from the repository. Returns its commit, or '' if there's no branch by that name. */
async function fetchBranch(fs: unknown, where: { dir?: string; gitdir?: string; cache?: object }, http: HttpClient, auth: () => unknown, url: string, branch: string, depth?: number) {
  await git.addRemote({ fs: fs as never, ...where, remote: REMOTE, url: url.trim(), force: true });
  try {
    const fetched = await git.fetch({
      fs: fs as never,
      http,
      onAuth: auth as never,
      ...where,
      url: url.trim(),
      remote: REMOTE,
      ref: branch,
      remoteRef: branch,
      singleBranch: true,
      tags: false,
      corsProxy: NO_PROXY,
      ...(depth ? { depth } : {}),
    });
    return fetched.fetchHead ?? "";
  } catch (err) {
    // The repository has no such branch yet.
    if ((err as { code?: string }).code === "NotFoundError") return "";
    throw err;
  }
}

/** Returns the files that differ between two commits, without reading any tree the two share. */
async function differ(r: Repo, a: string, b: string) {
  const out: string[] = [];
  await git.walk({
    ...base(r),
    trees: [git.TREE({ ref: a }), git.TREE({ ref: b })],
    map: async (path, [one, two]) => {
      if (path === ".") return true;
      if ((await one?.oid()) === (await two?.oid())) return null;
      const types = await Promise.all([one?.type(), two?.type()]);
      if (types.includes("blob")) out.push(path);
      return true;
    },
  });
  return out;
}

/** Returns the contents of files at a commit, keyed by path. */
async function filesAt(r: Repo, oid: string, paths: string[]) {
  const files: Files = new Map();
  await Promise.all(
    paths.map(async (path) => {
      const read = await git.readBlob({ ...base(r), oid, filepath: path }).catch(() => null);
      if (read) files.set(path, read.blob);
    }),
  );
  return files;
}

/** Writes merged files to the folder, or removes them. A path from a tree that can't be a file in the project is left out, and so is one the app refuses. */
async function putInFolder(r: Repo, files: Map<string, Uint8Array | undefined>) {
  const changed: string[] = [];
  for (const [path, bytes] of files) {
    if (!safeTreePath(path)) continue;
    try {
      if (bytes) await r.folder.write(path, bytes);
      else await r.folder.remove(path);
      changed.push(path);
    } catch (err) {
      console.warn(`Couldn’t bring ${path} in from the repository.`, err);
    }
  }
  return changed;
}

/** Steps of a sync that change the project, which run in turn with commits. */
export type InTurn = <T>(work: () => Promise<T>) => Promise<T>;

/**
 * Syncs the history with `branch` of the repository at `url`. Changes from other devices are merged in (see merge.ts), and local
 * commits are pushed. Only the merge is queued with commits, so a slow network never holds up saving a version.
 */
export async function sync(r: Repo, url: string, branch: string, label: string, texts: Texts, inTurn: InTurn): Promise<SyncResult> {
  // Another device may push between this one's fetch and push. If so, fetch and merge again.
  const changed = new Set<string>()
  const conflicts = new Set<string>()
  for (let tries = 3; ; tries--) {
    const { rejected, ...result } = await syncOnce(r, url, branch, label, texts, inTurn);
    result.changed.forEach((f) => changed.add(f))
    result.conflicts.forEach((f) => conflicts.add(f))
    if (!rejected || tries <= 1) return { ...result, changed: [...changed], conflicts: [...conflicts] }
  }
}

/** True if a push failed because the repository moved on since this device fetched. */
const wasRejected = (err: unknown) => {
  const code = (err as { code?: string }).code
  return code === "PushRejectedError" || code === "GitPushError"
}

async function syncOnce(r: Repo, url: string, branch: string, label: string, texts: Texts, inTurn: InTurn): Promise<SyncResult & { rejected?: boolean }> {
  const none = { changed: [] as string[], conflicts: [] as string[] };
  let remote = "";
  try {
    remote = await fetchBranch(r.fs, base(r), r.http, onAuth(r), url, branch);
  } catch (err) {
    return { ok: false, message: texts.describe(err), ...none };
  }
  const merged = await inTurn(async () => {
    try {
      let head = await headOf(r);
      if (!head && !remote) return { message: texts.nothingToPush, ...none };
      const isAncestor = (ancestor: string, oid: string) =>
        ancestor === oid ? Promise.resolve(true) : git.isDescendent({ ...base(r), oid, ancestor, depth: -1 }).catch(() => false);
      // The remote branch doesn't exist yet or has nothing new, so there's nothing to merge.
      if (!remote || (head && (await isAncestor(remote, head)))) return { message: "", ...none };
      // The remote has new commits. Commit any uncommitted local changes first, so they can't be overwritten.
      if (head && (await stageAll(r))) head = await git.commit({ ...base(r), message: texts.beforeSync, author: author(r) });
      const branchName = (await git.currentBranch(base(r))) || "main";
      // There are no local commits, or none the remote lacks, so fast-forward to the remote.
      if (!head || (await isAncestor(head, remote))) {
        const paths = head ? await differ(r, head, remote) : await allFiles(r, remote);
        const theirs = await filesAt(r, remote, paths);
        const changed = await putInFolder(r, new Map(paths.map((p) => [p, theirs.get(p)])));
        await git.writeRef({ ...base(r), ref: `refs/heads/${branchName}`, value: remote, force: true });
        await stageAll(r);
        return { message: "", changed, conflicts: [] as string[] };
      }
      // Both sides have changes. Merge file by file, and commit the merge with both histories as parents.
      const [ancestor] = await git.findMergeBase({ ...base(r), oids: [head, remote] });
      const paths = [...new Set([...(await differ(r, ancestor, head)), ...(await differ(r, ancestor, remote))])];
      const [b, o, th] = await Promise.all([filesAt(r, ancestor, paths), filesAt(r, head, paths), filesAt(r, remote, paths)]);
      const { files, conflicts } = mergeFiles(b, o, th, { label, now: new Date().toISOString() });
      const out = new Map<string, Uint8Array | undefined>();
      for (const file of new Set([...paths, ...files.keys()])) if (!sameBytes(files.get(file), o.get(file))) out.set(file, files.get(file));
      const changed = await putInFolder(r, out);
      await commit(r, texts.merged, [head, remote]);
      return { message: "", changed, conflicts };
    } catch (err) {
      return { message: texts.describe(err), ...none };
    }
  });
  if (merged.message) return { ok: false, ...merged };
  try {
    if (!(await headOf(r))) return { ok: false, message: texts.nothingToPush, ...none };
    await push(r, url, branch);
    return { ok: true, message: "", changed: merged.changed, conflicts: merged.conflicts };
  } catch (err) {
    return { ok: false, message: texts.describe(err), changed: merged.changed, conflicts: merged.conflicts, rejected: wasRejected(err) };
  }
}

/** Pushes the project's branch to `branch` on the repository. */
async function push(r: Repo, url: string, branch: string) {
  const ref = (await git.currentBranch(base(r))) || "HEAD";
  const result = await git.push({
    ...base(r),
    http: r.http,
    onAuth: onAuth(r) as never,
    url: url.trim(),
    remote: REMOTE,
    ref,
    remoteRef: `refs/heads/${branch}`,
    corsProxy: NO_PROXY,
  });
  if (result && !result.ok) throw new Error(result.error ?? "push");
}

/** Lists every file in a commit. */
async function allFiles(r: Repo, oid: string) {
  const out: string[] = [];
  await git.walk({
    ...base(r),
    trees: [git.TREE({ ref: oid })],
    map: async (path, [entry]) => {
      if (entry && path !== "." && (await entry.type()) === "blob") out.push(path);
      return true;
    },
  });
  return out;
}

/** Fills the folder from `branch` of the repository. Returns the files written. */
export async function clone(r: Repo, url: string, branch: string) {
  await git.init({ fs: r.fs, dir: DIR, defaultBranch: branch });
  const oid = await fetchBranch(r.fs, base(r), r.http, onAuth(r), url, branch);
  if (!oid) throw new Error("no-branch");
  await git.writeRef({ ...base(r), ref: `refs/heads/${branch}`, value: oid, force: true });
  // Written file by file and not with isomorphic-git's checkout, so each path passes the same checks as a merged file.
  const paths = await allFiles(r, oid);
  const theirs = await filesAt(r, oid, paths);
  const changed = await putInFolder(r, new Map(paths.map((p) => [p, theirs.get(p)])));
  await stageAll(r);
  return changed;
}

/**
 * Lists the projects in the repository at `url`. Each branch holds one, and its title is read from the branch's latest commit,
 * fetched into a temporary in-memory repository.
 */
export async function remoteBooks(http: HttpClient, login: () => Login, url: string): Promise<RemoteBook[]> {
  const auth = () => {
    const { user, token } = login();
    return token ? { username: user || "git", password: token } : { cancel: true };
  };
  const refs = await git.listServerRefs({ http, onAuth: auth as never, url: url.trim(), prefix: "refs/heads/", corsProxy: NO_PROXY });
  const out: RemoteBook[] = [];
  for (const { ref, oid } of refs) {
    const branch = ref.replace(/^refs\/heads\//, "");
    // Anyone who can push to the repository chooses its branch names, so accept only plain names.
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/.test(branch)) continue;
    const fs = memoryFs();
    const gitdir = "/cache";
    try {
      await git.init({ fs: fs as never, gitdir, bare: true });
      await fetchBranch(fs, { gitdir }, http, auth, url, branch, 1);
      const read = await git.readBlob({ fs: fs as never, gitdir, oid, filepath: "project.json" });
      const file = JSON.parse(new TextDecoder().decode(read.blob)) as { name?: string; books?: unknown };
      // A branch in an older format, or one the app didn't create, isn't listed.
      if (Array.isArray(file.books)) out.push({ branch, kind: file.books.length > 1 ? "series" : "book", title: file.name || branch });
    } catch (err) {
      console.warn(`Couldn’t read the book on branch ${branch}.`, err);
    }
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}
