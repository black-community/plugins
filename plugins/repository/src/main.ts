import "./polyfill";
import { Plugin } from "@black/plugin";
import locales from "black:locales";
import { translator, type Translate } from "../../../shared/i18n";
import type en from "../locales/en.json";
import { addressPermission, addressProblem, branchFor, OWN_BRANCH, validBranch } from "./address";
import type { FolderAccess } from "./fs";
import { commit, fileAt, hasCommits, clone, initRepo, log, makeRepo, remoteBooks, sync, type Repo, type RemoteBook, type Texts } from "./history";
import { netClient, type NetAccess } from "./http";

/**
 * Keeps a version history of the writer's projects while it's on, backs it up to their own git repository, and opens projects
 * on other devices. Every project has its own branch in a shared repository, or a repository of its own. All of this
 * happens in this plugin, in its worker, with isomorphic-git, so writing never waits for it and no git program is needed. The app
 * gives it the project's folder (app.folder), and draws the list of versions it offers (addVersionHistory).
 */

type Key = keyof typeof en.messages;

/** What's kept with the project, in its project.json, on this device. */
interface ProjectSettings {
  /** This project's repository: missing for the shared one, '' for none, or an address. */
  remote?: string | null;
  /** The project's branch in the shared repository, chosen at its first push. */
  branch?: string;
}

interface Status {
  ok: boolean;
  message: string;
  at: string;
}

export default class Repository extends Plugin {
  private t!: Translate<Key>;
  private status!: { setText(text: string, title?: string): void };
  private here: { key: string; repo: Repo } | null = null;
  /** Changes to the history run one at a time. */
  private work: Promise<unknown> = Promise.resolve();
  /** Syncs run one at a time, apart from commits, so a slow network doesn't hold up saving a version. */
  private syncing: Promise<unknown> = Promise.resolve();
  /** Working out where a sync goes, one at a time, so the first push chooses only one branch. */
  private preparing: Promise<unknown> = Promise.resolve();
  private last: Status | null = null;
  /** Addresses the writer refused this session. They aren't asked about again until the writer changes the setting. */
  private refused = new Set<string>();
  /** Whether the writer already heard that backing up fails, so they're told once and not every ten minutes. */
  private failing = false;

  async onload() {
    const t = (this.t = translator(locales, this.app.language));
    const signingIn = t("settings.signingIn");
    this.addSettings([
      {
        key: "shared",
        label: t("settings.shared.label"),
        description: t("settings.shared.description"),
        type: "text",
        default: "",
      },
      {
        key: "user",
        label: t("settings.user.label"),
        description: t("settings.user.description"),
        type: "text",
        default: "",
        folded: signingIn,
      },
      {
        key: "token",
        label: t("settings.token.label"),
        description: t("settings.token.description"),
        type: "secret",
        default: "",
        folded: signingIn,
      },
    ]);
    let shared = String(this.settings.shared ?? "").trim();
    let login = `${this.settings.user ?? ""}\n${this.settings.token ?? ""}`;
    this.onSettingsChange(() => {
      const nowShared = String(this.settings.shared ?? "").trim();
      const nowLogin = `${this.settings.user ?? ""}\n${this.settings.token ?? ""}`;
      if (nowShared === shared && nowLogin === login) return;
      // A new address or sign-in is the writer's own action, so an address refused earlier is asked about again.
      if (nowShared !== shared) this.refused.delete(nowShared);
      shared = nowShared;
      login = nowLogin;
      void this.backUp({ loud: true });
    });

    this.addVersionHistory({
      id: "versions",
      list: async (file?: string) => {
        const open = await this.open();
        return open ? (await log(open.repo, file)).map((c) => ({ id: c.hash, label: c.message, at: c.date })) : [];
      },
      read: async (version: string, file: string) => {
        const open = await this.open();
        const bytes = open ? await fileAt(open.repo, version, file) : null;
        return bytes ? new TextDecoder().decode(bytes) : "";
      },
      save: async (message: string) => (await this.saveVersion(message, true)) !== null,
      status: async () => (this.last && !this.last.ok ? { text: t("status.failedBecause", { message: firstLine(this.last.message) }), problem: true } : null),
    });

    // The status bar shows how the last backup went. Clicking it backs up now.
    this.status = this.addStatusBarItem({
      id: "state",
      text: "",
      onClick: () => void this.now(),
    });

    this.on("project-open", () => void this.begin());
    this.on("project-close", () => {
      this.here = null;
    });
    // The app waits for these, up to a limit, so a version under way is finished before a book closes or the app quits.
    this.during("copy-due", async (info: { words: number; changed: boolean; reason?: string }) => {
      if (!info.changed) return;
      await this.saveVersion(info.reason === "new-book" ? t("commits.start") : t("commits.writingSession", { words: String(info.words) }));
    });
    this.during("project-closing", async (info: { words: number; changed: boolean; quitting?: boolean }) => {
      // Nothing new means nothing to push, so closing doesn't touch the network. A push already under way still counts.
      let oid: string | null = null;
      if (info.changed) oid = await this.saveVersion(t("commits.sessionEnd", { words: String(info.words) }), false);
      else await this.work;
      const pushed = oid ? this.backUp() : this.syncing;
      // The worker stops with the window, so a push under way has to finish first. Otherwise a slow network mustn't hold up closing a book.
      if (info.quitting) await pushed;
    });

    this.addCommand({ id: "now", name: t("command.now"), run: () => this.now() });
    this.addCommand({
      id: "book",
      name: t("command.book"),
      run: async () => {
        const now = await this.projectSettings();
        const value = await this.app.ui.prompt({
          title: t("book.title"),
          label: t("book.label"),
          value: now.remote ?? "",
          placeholder: this.sharedAddress() || "https://…",
        });
        if (value === null) return;
        const address = value.trim();
        const problem = address ? this.addressMessage(address) : null;
        if (problem) return this.app.ui.notify(problem);
        this.refused.delete(address);
        await this.saveProjectSettings({ remote: address || null });
        await this.backUp({ loud: true });
        this.show();
      },
    });
    this.addCommand({
      id: "none",
      name: t("command.none"),
      run: async () => {
        await this.saveProjectSettings({ remote: "" });
        this.app.ui.notify(t("none.done"));
        this.show();
      },
    });
    this.addCommand({ id: "open", name: t("command.open"), run: () => this.openFromRepository() });

    this.show();
    if (await this.app.project.isOpen()) void this.begin();
  }

  /* ---- the project ---- */

  private sharedAddress = () => String(this.settings.shared ?? "").trim();
  private login = () => ({ user: String(this.settings.user ?? "").trim(), token: String(this.settings.token ?? "").trim() });

  private repoFor(key: string) {
    const folders = this.app.folder!;
    const folder: FolderAccess = {
      read: (rel) => folders.read(key, rel),
      write: (rel, data) => folders.write(key, rel, data),
      remove: (rel) => folders.remove(key, rel),
      list: (rel) => folders.list(key, rel),
      stat: (rel) => folders.stat(key, rel),
      mkdir: (rel) => folders.mkdir(key, rel),
      rmdir: (rel) => folders.rmdir(key, rel),
    };
    return makeRepo(folder, netClient(this.app.net as unknown as NetAccess), this.login);
  }

  /** Returns the open project's history, set up for this project's folder. */
  private async open() {
    const current = await this.app.folder!.current();
    if (!current) return null;
    if (this.here?.key !== current.key) this.here = { key: current.key, repo: this.repoFor(current.key) };
    return this.here;
  }

  private projectSettings = async () => ((await this.app.project.getProjectData!()) ?? {}) as ProjectSettings;
  private async saveProjectSettings(patch: ProjectSettings) {
    await this.app.project.setProjectData!({ ...(await this.projectSettings()), ...patch });
  }

  private inTurn = <T>(work: () => Promise<T>): Promise<T> => {
    const mine = this.work.catch(() => undefined).then(work);
    this.work = mine.catch(() => undefined);
    return mine;
  };

  /** Creates the open project's history if it has none, with its first version, and syncs. */
  private begin() {
    this.last = null;
    this.failing = false;
    this.show();
    const started = this.inTurn(async () => {
      const open = await this.open();
      if (!open) return;
      await this.app.project.flush!();
      // A history that already has versions carries on, with whatever has changed in its next one.
      if (!(await hasCommits(open.repo))) await this.commitNow(open, this.t("commits.start"));
      else await initRepo(open.repo);
      this.versionsChanged();
    });
    return started.then(
      () => this.backUp(),
      (err) => this.report(err),
    );
  }

  /** Commits what's changed in the project. Returns the new version, or null if nothing changed. */
  private async commitNow(open: { key: string; repo: Repo }, message: string) {
    const oid = await commit(open.repo, message);
    if (oid) {
      this.versionsChanged();
      void this.app.folder!.note(open.key, { version: { message, date: new Date().toISOString() } }).catch(() => undefined);
    }
    return oid;
  }

  /** Saves a version: waits until the project's files are saved, commits, and then backs up in the background unless told not to. */
  private saveVersion(message: string, thenBackUp = true) {
    const saved = this.inTurn(async () => {
      const open = await this.open();
      if (!open) return null;
      await this.app.project.flush!();
      return this.commitNow(open, message);
    });
    return saved.then(
      (oid) => {
        if (oid && thenBackUp) void this.backUp();
        return oid;
      },
      (err) => {
        this.report(err);
        return null;
      },
    );
  }

  private report(err: unknown) {
    const message = this.describe(err);
    this.last = { ok: false, message, at: new Date().toISOString() };
    if (!this.failing) this.app.ui.notify(this.t("failed.save", { message: firstLine(message) }));
    this.failing = true;
    this.show();
  }

  /* ---- the repository ---- */

  /** Returns a message for an address the plugin can't use, or null. */
  private addressMessage(address: string) {
    const problem = addressProblem(address);
    if (problem === "ssh") return this.t("address.ssh");
    if (problem === "http") return this.t("address.http");
    if (problem === "login") return this.t("address.login");
    if (problem) return this.t("address.other", { url: address });
    return null;
  }

  /** Where the open project's history goes, or null if nowhere. The first time, this chooses its branch in the shared repository. */
  private async target(open: { key: string; repo: Repo }) {
    const settings = await this.projectSettings();
    if (typeof settings.remote === "string" && !settings.remote) return null;
    const own = settings.remote?.trim();
    const url = own || this.sharedAddress();
    if (!url) return null;
    if (own) return { url, branch: OWN_BRANCH };
    if (settings.branch && validBranch(settings.branch)) return { url, branch: settings.branch };
    // The first push to the shared repository gives the project a branch, named after it. It keeps that branch whatever
    // happens to it later: a second book, or a new name.
    const info = await this.app.project.info();
    const branch = branchFor(info?.series || info?.title || "");
    await this.saveProjectSettings({ branch });
    // Commit the branch name into the history with the book, so a copy fetched from the repository knows where to sync.
    await this.inTurn(() => this.commitNow(open, this.t("commits.branch", { branch })));
    return { url, branch };
  }

  /**
   * Asks the writer once for each address, in a window of the app's that no plugin can answer, because every version of the
   * text goes there, and a project from someone else could name any address. The app enforces the answer in app.net.
   */
  private async allowed(url: string, askAgain = false) {
    if (this.refused.has(url) && !askAgain) return false;
    const yes = await this.app.permissions!.request(addressPermission(url));
    if (yes) this.refused.delete(url);
    else this.refused.add(url);
    return yes;
  }

  private texts(): Texts {
    return {
      beforeSync: this.t("commits.beforeSync"),
      merged: this.t("commits.merged"),
      nothingToPush: this.t("failed.nothingToPush"),
      describe: (err) => this.describe(err),
    };
  }

  /** Puts what went wrong in the writer's words where there are some. Anything else is what the server or the system said. */
  private describe(err: unknown) {
    const e = err as { code?: string; message?: string; data?: { statusCode?: number } };
    if (e?.message === "not-a-folder") return this.t("failed.notAFolder");
    if (e?.message === "no-branch") return this.t("open.failed");
    const status = e?.data?.statusCode;
    if (e?.code === "UserCanceledError" || status === 401 || status === 403) return this.t("failed.signIn");
    if (status === 404) return this.t("failed.notFound");
    return e?.message ?? String(err);
  }

  /**
   * Syncs the open project with its repository, if it has one. Quiet unless `loud`. Syncs run one at a time, so a second one sees
   * what the first did. What to sync is settled here and now, because the project may have closed by the sync's turn.
   */
  private backUp(opts: { loud?: boolean; commit?: boolean } = {}) {
    const prepared = this.preparing.catch(() => undefined).then(async () => {
      const open = await this.open();
      return open ? { open, target: await this.target(open) } : null;
    });
    this.preparing = prepared;
    const run = this.syncing.catch(() => undefined).then(() => this.syncOnce(prepared, opts));
    this.syncing = run.catch(() => undefined);
    return run;
  }

  private async syncOnce(
    prepared: Promise<{ open: { key: string; repo: Repo }; target: { url: string; branch: string } | null } | null>,
    opts: { loud?: boolean; commit?: boolean },
  ): Promise<Status | null> {
    const t = this.t;
    let result: { ok: boolean; message: string; changed: string[]; conflicts: string[] };
    let found;
    try {
      found = await prepared;
    } catch (err) {
      this.report(err);
      return null;
    }
    if (!found) return null;
    const { open, target } = found;
    if (!target) return null;
    try {
      // A manual backup also saves what's been written since the last version, including recent typing.
      if (opts.commit) await this.saveVersion(t("commits.writingSession", { words: String(await this.totalWords()) }), false);
      const problem = this.addressMessage(target.url);
      if (problem) result = { ok: false, message: problem, changed: [], conflicts: [] };
      else if (!(await this.allowed(target.url))) result = { ok: false, message: t("failed.refused", { url: target.url }), changed: [], conflicts: [] };
      else {
        const label = t("fromRepository", { date: new Date().toLocaleString(this.app.language, { dateStyle: "medium", timeStyle: "short" }) });
        result = await sync(open.repo, target.url, target.branch, label, this.texts(), this.inTurn);
      }
    } catch (err) {
      result = { ok: false, message: this.describe(err), changed: [], conflicts: [] };
    }
    if (result.changed.length) await this.app.folder!.arrived(open.key, result.changed).catch(() => undefined);
    if (result.conflicts.length) this.app.ui.notify(result.conflicts.length === 1 ? t("conflicts.one") : t("conflicts.other", { count: String(result.conflicts.length) }));
    const status: Status = { ok: result.ok, message: result.message, at: new Date().toISOString() };
    // Only the project still open shows it, but every project's last result is kept for the dashboard.
    void this.app.folder!.note(open.key, { push: { ok: result.ok, message: result.message } }).catch(() => undefined);
    if (this.here?.key === open.key) this.last = status;
    // Tell the writer once when pushing starts failing, not every ten minutes.
    if (!result.ok && (opts.loud || !this.failing)) this.app.ui.notify(t("failed.push", { message: firstLine(result.message) }));
    this.failing = !result.ok;
    if (result.ok && opts.loud && !result.conflicts.length) this.app.ui.notify(t("pushed", { branch: target.branch }));
    this.versionsChanged();
    this.show();
    return status;
  }

  private async totalWords() {
    let sum = 0;
    for (const id of await this.app.project.manuscript()) sum += (await this.app.project.meta(id))?.words ?? 0;
    return sum;
  }

  /** Backs up now, and shows the result. */
  private async now() {
    const status = await this.backUp({ loud: true, commit: true });
    if (!status) this.app.ui.notify(this.t("now.noRepository"));
  }

  /** Shows the last backup's time in the status bar, or that it failed. Hovering shows the reason. */
  private show() {
    void this.showNow().catch(() => undefined);
  }

  private async showNow() {
    if (!(await this.app.project.isOpen())) return this.status.setText("");
    const settings = await this.projectSettings();
    const on = typeof settings.remote === "string" ? !!settings.remote : !!this.sharedAddress();
    if (!on) return this.status.setText("");
    const last = this.last;
    if (!last) return this.status.setText(this.t("status.notYet"), this.t("status.clickToBackUp"));
    const time = new Date(last.at).toLocaleTimeString(this.app.language, { hour: "2-digit", minute: "2-digit" });
    this.status.setText(last.ok ? this.t("status.backedUp", { time }) : this.t("status.failed"), `${last.at}${last.ok ? "" : ` · ${last.message}`}`);
  }

  /* ---- opening a project from a repository ---- */

  private async openFromRepository() {
    const t = this.t;
    const entered = await this.app.ui.prompt({ title: t("open.title"), label: t("open.label"), value: this.sharedAddress() });
    const url = entered?.trim();
    if (!url) return;
    const problem = this.addressMessage(url);
    if (problem) return this.app.ui.notify(problem);
    if (!(await this.allowed(url, true))) return this.app.ui.notify(t("failed.refused", { url }));
    const http = netClient(this.app.net as unknown as NetAccess);
    let books: RemoteBook[];
    try {
      books = await remoteBooks(http, this.login, url);
    } catch (err) {
      return this.app.ui.notify(t("failed.push", { message: firstLine(this.describe(err)) }));
    }
    if (!books.length) return this.app.ui.notify(t("open.empty"));
    const chosen = await this.app.ui.choose({
      title: t("open.which"),
      options: books.map((b, i) => ({ value: String(i), label: b.title, detail: b.kind === "series" ? t("open.series") : undefined })),
    });
    if (chosen === null) return;
    const book = books[Number(chosen)];
    const made = await this.app.folder!.create(t(book.kind === "series" ? "open.whereSeries" : "open.whereBook"), book.title);
    if (!made) return;
    try {
      const repo = this.repoFor(made.key);
      const files = await clone(repo, url, book.branch);
      await this.app.folder!.arrived(made.key, files);
    } catch (err) {
      await this.app.folder!.discard(made.key).catch(() => undefined);
      return this.app.ui.notify(t("open.failedBecause", { message: firstLine(this.describe(err)) }));
    }
    if (!(await this.app.project.open!(made.key))) return this.app.ui.notify(t("open.failed"));
    // The branch is the project's, whatever the number of books.
    const settings = await this.projectSettings();
    if (settings.branch !== book.branch) await this.saveProjectSettings({ branch: book.branch });
  }
}

const firstLine = (text: string) => text.split("\n").find((l) => l.trim())?.trim() ?? text;
