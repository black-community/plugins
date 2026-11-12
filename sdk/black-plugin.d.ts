/**
 * @black/plugin: the API that Bläck Studio plugins are written against.
 *
 *   import { Plugin } from '@black/plugin'
 *
 *   export default class WordOfTheDay extends Plugin {
 *     onload() {
 *       this.addCommand({ id: 'hello', name: 'Say hello', run: () => this.app.ui.notify('Hello') })
 *     }
 *   }
 *
 * A plugin runs in one of two places:
 * - In the app's window, where it can draw its own interface with React. It
 *   shares the app's copy of React: import React from 'react'.
 * - In a separate worker, if its manifest has "sandboxed": true. It can use
 *   everything here except what draws its own interface (views, inspector
 *   tabs, sidebar panels, dashboard cards, settings panels, its own dialogs and
 *   editor extensions), editor.active, editor.anchor and app.speech.
 *
 * Code that avoids those features works in both places.
 *
 * Everything a plugin adds through these methods is removed when the plugin is
 * turned off or reloaded. A plugin can access the book only through `this.app`,
 * and the internet only through `this.app.net`, limited to the hosts its
 * manifest names (or addresses the writer entered) and the writer allowed.
 */

import type { ReactNode, ComponentType } from 'react'
import type { AnyExtension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'

/** A project folder, as returned by app.folder. */
export interface ProjectFolder {
  key: string
  name: string
  /** The open book's folder, relative to the project: `books/<id>`. Empty for a folder from folder.create. */
  book: string
}

/** One version in a plugin's version history (see addVersionHistory). */
export interface VersionEntry {
  /** The plugin's identifier for the version. The app passes it back to `read`. */
  id: string
  label: string
  /** When it was saved, as an ISO date. */
  at: string
}

/** What a `during` handler is told about the moment the app is waiting at. */
export interface WaitInfo {
  /** The number of words in the whole project. */
  words: number
  /** Whether the project has changed since plugins were last told of a 'copy-due' or 'project-closing'. Always true for a new book. */
  changed: boolean
  /**
   * Only for 'project-closing': true when the window is closing, or the app is going to the background on a phone or
   * tablet. Finish all work in the handler; don't leave anything for later.
   */
  quitting?: boolean
  /** Only for 'copy-due': 'timer' when the writing timer runs out and something has changed, 'new-book' when a book was just made. */
  reason?: 'timer' | 'new-book'
}

export interface Manifest {
  /** 2 to 64 lower-case letters, digits and dashes, starting with a letter or digit. It's also the name of the plugin's folder. */
  id: string
  name: string
  version: string
  description: string
  author: string
  /**
   * The plugin API version the plugin needs. Defaults to 1.
   */
  apiVersion: number
  /** The plugin's script, relative to its folder. Defaults to main.js. */
  main: string
  /** Runs the plugin in a separate worker instead of the app's window. */
  sandboxed: boolean
  /** The plugin's name and description in other languages, keyed by language code: { "sv": { "name": "…", "description": "…" } }. */
  locales?: Record<string, { name?: string; description?: string }>
  /**
   * Permissions the plugin can request later with app.permissions.request, when the writer uses a feature that
   * needs them (such as sending text to a service). They take the same values as `permissions`, but the writer
   * isn't asked for them when the plugin is turned on. API 5.
   *
   * "network:ask" lets the plugin request access to an address the writer entered (such as a repository URL), which
   * it can't list in advance. Request `address:https://host/path`: the writer is asked to allow that exact address,
   * and the plugin can then reach that address and the paths under it. API 10.
   */
  optionalPermissions?: string[]
  /**
   * Why the plugin needs each permission in `permissions` or `optionalPermissions`, keyed by permission. The
   * writer sees the reason when asked to allow the permission, under "it needs to:" and above the app's own
   * description. Write it to complete the sentence "it needs to …", and say what is sent where, and why. Give
   * one string, or one per language code, each up to 300 characters. API 8.
   *
   *   "permissionReasons": {
   *     "network:api.example.com": {
   *       "en": "fetch today's word from Example (api.example.com)",
   *       "sv": "hämta dagens ord från Example (api.example.com)"
   *     }
   *   }
   */
  permissionReasons?: Record<string, string | Record<string, string>>
  /**
   * The group the plugin is listed under in Manage Plugins:
   * - "writing": tools for the text while writing
   * - "planning": the navigator, cards and views
   * - "welcome": the welcome screen
   * - "import-export": importing and exporting books
   * - "other": anything else
   *
   * Without a category, the plugin is grouped by what it adds while it's turned on, and under "other" while it's off. API 8.
   */
  category?: 'writing' | 'planning' | 'welcome' | 'import-export' | 'other'
  /**
   * What the plugin needs beyond reading the book. The writer is asked to allow each one:
   * - "project:write": change the book.
   * - "library:read": see the writer's recent books and their series (app.library), for the dashboard.
   * - "project:folder": read and change every file in the open project's folder, including hidden ones such as a
   *   version history (app.folder). Nothing outside that folder is accessible. API 10.
   * - "microphone": record audio with navigator.mediaDevices.getUserMedia, in the window. API 3.
   * - "network:<host>": connect to that host. Use "network:*.<host>" to include its subdomains, or "network:*" for any
   *   public host. "network:*" never covers this computer or the local network: name those hosts explicitly.
   * - "files:read", "files:write": read or change files and folders the writer chooses for the plugin.
   * - "exec:<program>": run that program, found by name on the PATH, without a shell.
   */
  permissions: string[]
}

/** `entry` is a sheet of a kind a plugin defines (defineKind, API 12). */
export type NodeType = 'text' | 'folder' | 'character' | 'place' | 'note' | 'research' | 'file' | 'entry'

/** The icons a kind of entry may use, from the app's own. API 12. */
export type KindIcon =
  | 'banner' | 'crown' | 'shield' | 'swords' | 'castle' | 'landmark' | 'church' | 'scroll' | 'book' | 'gem' | 'key' | 'wand' | 'flame' | 'leaf'
  | 'mountain' | 'globe' | 'map' | 'compass' | 'paw' | 'bird' | 'fish' | 'bug' | 'users' | 'languages' | 'feather' | 'hourglass' | 'star' | 'sparkles'

/** A kind of entry, as a plugin defines it (defineKind, API 12). */
export interface KindDefinition {
  /** Lower-case letters, digits and -: "faction". Stored as "<plugin id>:faction". */
  id: string
  /** "Faction", in the writer's language. */
  name: string
  /** "Factions". */
  plural: string
  icon: KindIcon
  /** The sheet's fields: "Leader", "Seat", "Goals". At most 40. */
  fields?: string[]
  /** The plugin's section in the navigator, which holds its entries: { id: "world", name: "World" }. */
  section: { id: string; name: string }
}

export interface NodeInfo {
  id: string
  title: string
  type: NodeType
  /** An entry's kind, "<plugin id>:<kind id>". API 12. */
  kind?: string
  parentId: string | null
  children: string[]
  inTrash: boolean
}

export interface MetaInfo {
  synopsis: string
  notes: string
  keywords: string[]
  /** The fields on a character's or place's sheet: "Age", "Born"… */
  fields: Record<string, string>
  /** When the scene happens, as written on its card: "Day 3", "1888-05-01"… */
  when: string
  words: number
}

export interface Label {
  id: string
  name: string
  color: string
}

export interface Status {
  id: string
  name: string
  /** The colour on the corkboard (#rrggbb) when cards are coloured by status. */
  color?: string
}

export interface FileEntry {
  name: string
  path: string
  folder: boolean
  size: number
  modified: string
}

export interface ExecOutput {
  /** The exit code, or null if the program was stopped. */
  code: number | null
  stdout: Uint8Array
  stderr: string
  timedOut: boolean
  /** stdout as text. */
  text(): string
}

export interface FetchResult {
  ok: boolean
  status: number
  statusText: string
  headers: Record<string, string>
  text(): string
  json(): unknown
  bytes(): Uint8Array
}

/** A summary of one of the writer's books, read from its files, for the welcome screen's dashboard. */
export interface LibraryBook {
  /** The book's folder. Pass this to app.library.open. */
  path: string
  title: string
  author: string
  /** When it was last opened in the app (ISO), or '' for a book in a series that's never been opened. */
  opened: string
  /** When anything in the book last changed (ISO). */
  modified: string
  /** The book's series: its name and folder, the book's zero-based position in it, and the number of books. Null if it isn't in one. */
  series: { name: string; path: string; index: number; books: number } | null
  /** The number of words and scenes in the manuscript. */
  words: number
  scenes: number
  /** The word target (0 for none) and the deadline (YYYY-MM-DD, or '' for none). */
  target: number
  deadline: string
  /** The daily writing goal (0 for none). */
  sessionTarget: number
  /** Words written per day, keyed by date (YYYY-MM-DD, in the writer's time zone). Empty for a book that isn't counted. */
  history: Record<string, number>
  /**
   * Whether the book counts in the writer's statistics. It's false for a sample, or for a book or series
   * the writer left out, so leave those out of totals and goals. Older versions of the app don't set it, so
   * treat a missing value as true.
   */
  counted?: boolean
  /** The number of scenes with each status, in the order the book lists its statuses. */
  statuses: { name: string; count: number }[]
  /** The scene most recently written in, with the last few hundred characters of its text (as plain text). */
  last: { id: string; title: string; modified: string; excerpt: string } | null
}

/** Recent activity across the writer's books. */
export interface LibraryActivity {
  /** The latest saved versions (git commits), newest first. */
  versions: { book: string; title: string; message: string; date: string }[]
  /** The latest zip backups, newest first. */
  backups: { file: string; date: string; size: number }[]
  /** The most recent push of each book's version history, newest first. */
  pushes: { book: string; title: string; ok: boolean; at: string; message: string }[]
}

export interface App {
  readonly apiVersion: number
  /** The language of the app's interface: 'en', 'sv'… */
  readonly language: string

  /**
   * The open book. Changing it needs "project:write". Every change can be undone, and the app takes a snapshot
   * of a document before a plugin first rewrites it.
   */
  project: {
    isOpen(): Promise<boolean>
    info(): Promise<{ title: string; author: string; language: string; series: string | null } | null>
    nodes(): Promise<NodeInfo[]>
    node(id: string): Promise<NodeInfo | null>
    /** The manuscript's documents, in reading order. */
    manuscript(): Promise<string[]>
    selected(): Promise<string | null>
    select(id: string): Promise<void>
    /** A document's text as HTML. */
    read(id: string): Promise<string>
    /** A document's text as plain text. */
    readText(id: string): Promise<string>
    write(id: string, html: string): Promise<void>
    create(type: 'text' | 'folder' | 'character' | 'place' | 'note' | 'research' | { kind: string }, title: string, parentId?: string): Promise<string>
    meta(id: string): Promise<MetaInfo | null>
    setMeta(id: string, patch: Partial<Pick<MetaInfo, 'synopsis' | 'notes' | 'keywords' | 'fields' | 'when'>>): Promise<void>
    /** Moves an item to the trash, where the writer can restore it. */
    trash(id: string): Promise<void>
    rename(id: string, title: string): Promise<void>
    /** Moves an item into a folder, at `index` among its children, or at the end if there's no index. */
    move(id: string, parentId: string, index?: number): Promise<void>
    labels(): Promise<Label[]>
    statuses(): Promise<Status[]>
    /** Sets an item's label by the label's id, or '' to clear it. setStatus works the same way. */
    setLabel(id: string, labelId: string): Promise<void>
    setStatus(id: string, statusId: string): Promise<void>
    comments(id: string): Promise<{ id: string; text: string; created: string; resolved: boolean }[]>
    resolveComment(id: string, commentId: string, resolved?: boolean): Promise<void>
    snapshots(id: string): Promise<{ label: string; taken: string; html: string }[]>
    /** Saves a snapshot of a document as it is now. This needs no permission. */
    snapshot(id: string, label: string): Promise<void>
    /** Searches the book, like Find in Project. */
    search(
      query: string,
      opts?: { wholeWord?: boolean; caseSensitive?: boolean; regex?: boolean },
    ): Promise<{ id: string; title: string; line: number; excerpt: string }[]>
    /** The book's series and its books in order, or null if the book isn't in a series. */
    series(): Promise<{ name: string; books: { id: string; title: string; current: boolean }[] } | null>
    /** Resolves once every pending change is saved to disk. API 10: check that it exists. */
    flush?(): Promise<void>
    /**
     * This plugin's data for the whole project, or undefined. It's stored in the project's project.json on this device,
     * and isn't shared on Bläck Sync. If the project.json can't be read, getProjectData returns undefined and
     * setProjectData throws. API 10: check that it exists.
     */
    getProjectData?(): Promise<unknown>
    setProjectData?(value: unknown): Promise<void>
    /** Opens a project that this plugin created with folder.create, by its key. Returns false if it couldn't be opened. API 10: check that it exists. */
    open?(key: string): Promise<boolean>
    /**
     * This plugin's data for this book, saved in the book and shared on Bläck Sync. The value must be plain JSON
     * (objects, lists, strings, finite numbers, booleans and null), at most 1 MB, or setData throws. When the book can't
     * be changed on this device (a reader or commenter of a shared book, or after the trial), setData throws an error
     * named "ReadOnly". The same JSON rules and size apply to setProjectData.
     */
    getData(): Promise<unknown>
    setData(value: unknown): Promise<void>
    /**
     * Adds words to the book's spelling dictionary, so they aren't marked as misspelt: single words, without spaces.
     * Words already there are left. Returns how many were new. Needs "project:write". API 12.
     */
    addToDictionary?(words: string[]): Promise<number>
    /** This plugin's data for one item, or undefined. API 11: check that it exists. */
    getItemData?(id: string): Promise<unknown>
    /**
     * Keeps this plugin's data with one item. It moves with the item, goes to the Trash with it, is copied when the
     * item is duplicated, and is deleted with it, and it's shared on Bläck Sync. Plain JSON, at most 64 KB per item;
     * undefined removes it. Needs "project:write"; throws "ReadOnly" when the book can't be changed. Listen for
     * `item-data-change` to follow changes made elsewhere. API 11: check that it exists.
     */
    setItemData?(id: string, value: unknown): Promise<void>
    /** Every item that has this plugin's data, with that data, by item id. API 11: check that it exists. */
    itemsWithData?(): Promise<Record<string, unknown>>
    /** This plugin's data shared by the whole project (every book of a series), or undefined. API 11: check that it exists. */
    getSharedData?(): Promise<unknown>
    /**
     * Keeps this plugin's data for the whole project, in its project.json, shared on Bläck Sync with every book of the
     * series. Plain JSON, at most 1 MB; undefined removes it. Needs "project:write"; throws "ReadOnly" when the series
     * can't be changed on this device. Listen for `shared-data-change` to follow changes made elsewhere. API 11: check
     * that it exists.
     */
    setSharedData?(value: unknown): Promise<void>
    /**
     * Says which paths in this plugin's data are text people write in: 'description', or 'chapters/<star>/summary',
     * where <star> is a * that matches any key or list item. Keys are letters, digits, - and _, separated by /. On
     * Bläck Sync these are merged letter by letter, so two people writing in the same one at once both keep what they
     * wrote; other values are replaced whole. The paths apply to the book's, each item's and the shared data, and are
     * kept in the book and the series, so every device merges them the same way. Call it when a book opens. Needs
     * "project:write". API 11: check that it exists.
     */
    textFields?(paths: string[]): Promise<void>
    /**
     * Defines a kind of entry, such as a faction, kept in the book, so its entries show with their name, icon and
     * fields without the plugin too. Its entries live in the plugin's own section of the navigator, made the first
     * time, which can't be moved or put in the Trash. Call it when a book opens; defining it again with changes updates
     * the book, and a field a new version drops stays on the entries that have it. Create entries with
     * create({ kind: 'faction' }, title). Returns "<plugin id>:<kind id>". Needs "project:write". API 12: check that
     * it exists.
     */
    defineKind?(kind: KindDefinition): Promise<string>
  }

  editor: {
    /** The TipTap editor the writer is using. Window only: it's null in a sandboxed plugin. */
    active(): Editor | null
    selection(): Promise<{ text: string; from: number; to: number } | null>
    /** Types text at the caret, replacing any selection. Returns false if no editor is active. Needs "project:write". */
    insertText(text: string): Promise<boolean>
    /** Adds a margin comment on the selection. Returns false if nothing is selected. Needs "project:write". */
    comment(text: string): Promise<boolean>
    /**
     * Returns a position for inserting text as it arrives, as dictation does: the writer's cursor, or where it was
     * before they clicked a button, or else the end of the open document. The position moves with edits around it.
     * Returns null if no document is open. Needs "project:write". Window only. API 4.
     */
    anchor(): Promise<EditorAnchor | null>
  }

  ui: {
    /** Shows a notice, with a button if you pass an action. A sandboxed plugin's notice has no button. */
    notify(message: string, action?: { label: string; run: () => void }): void
    /** Asks a yes-or-no question in an app dialog. `confirmLabel` defaults to "OK". Resolves to true if the writer confirms. */
    confirm(title: string, detail?: string, confirmLabel?: string): Promise<boolean>
    /** Shows one of this plugin's views. Window only. */
    openView(viewId: string): void
    /** Shows this plugin's settings. */
    openSettings(): void
    /** Opens a dialog that the plugin draws itself. Returns a function that closes it. Window only. */
    openModal(modal: {
      title: string
      render: (close: () => void) => ReactNode
      wide?: boolean
      /** Called when the dialog closes: 'closed' if the writer closed it (Escape, ✕) or `close` was called, 'replaced' if another dialog took its place. */
      onClose?: (how: 'closed' | 'replaced') => void
    }): () => void
    /** Asks for a line of text. Returns null if the writer cancels. */
    prompt(opts: { title: string; label?: string; value?: string; placeholder?: string }): Promise<string | null>
    /** Asks the writer to choose one option. Returns null if they cancel. */
    choose(opts: { title: string; options: { value: string; label: string; detail?: string }[] }): Promise<string | null>
    /** Starts a writing sprint of 1 to 600 minutes in the open book, like the status bar's sprint. Throws if no book is open. API 2. */
    startSprint(minutes: number): void
    /**
     * Shows a list of the marks from one of this plugin's highlighters in the current document, each with its
     * surrounding text. The app selects the mark the writer picks. Resolves to false if there are no marks or
     * the writer picks none. API 6: check that it exists before calling it.
     */
    listMarks?(opts: {
      highlighter: string
      title: string
      /** The heading for quiet marks (HighlightRange.quiet), which are listed last, each with its actions. API 9. */
      quietTitle?: string
    }): Promise<boolean>
  }

  /**
   * The open project's folder, which holds its books. Needs "project:folder". API 10: check that it exists before using it.
   *
   * Paths are relative to the project's folder and use "/" as the separator. A path is refused if it's absolute, contains
   * "..", goes through a symbolic link, has a name that isn't valid on every system, or names `.sync` (at any level) or
   * `.git` (below the top level). Every call takes the project's key from current() instead of a path, so work started on one project can't
   * end up in the next one opened. A key stops working two minutes after its project closes.
   */
  folder?: {
    /** Returns the open project's key, name and book folder (`books/<id>`), or null if no project is open. */
    current(): Promise<ProjectFolder | null>
    /**
     * Asks the writer where to create a new project and creates its folder, for a plugin that brings in a project from
     * elsewhere. `title` is the dialog's title and `name` the suggested folder name. Returns null if the writer cancels.
     */
    create(title: string, name: string): Promise<ProjectFolder | null>
    /** Deletes a folder made by create() that the plugin couldn't finish. This works only before the project is opened. */
    discard(key: string): Promise<void>
    /** Returns the file's bytes, or null if it doesn't exist. */
    read(key: string, path: string): Promise<Uint8Array | null>
    /** Writes the whole file, creating any missing parent folders. */
    write(key: string, path: string, data: string | Uint8Array): Promise<void>
    /** Deletes a file permanently (it doesn't go to the trash). Returns false if there was no such file. */
    remove(key: string, path: string): Promise<boolean>
    /** Lists a folder's contents ('' for the project's folder itself), or returns null if the folder doesn't exist. */
    list(key: string, path: string): Promise<{ name: string; folder: boolean; link: boolean }[] | null>
    /** Returns information about a file or folder, without following symbolic links, or null if nothing is there. */
    stat(key: string, path: string): Promise<{ folder: boolean; link: boolean; size: number; mode: number; mtimeMs: number; ctimeMs: number; ino: number; uid: number; gid: number; dev: number } | null>
    mkdir(key: string, path: string): Promise<void>
    /** Deletes an empty folder. Returns false if the folder isn't empty or doesn't exist. */
    rmdir(key: string, path: string): Promise<boolean>
    /** Tells the app that these files were changed from outside the app: they're marked as downloaded, and the open book reloads them. */
    arrived(key: string, paths: string[]): Promise<void>
    /** Reports a new version or the result of a push, so the dashboard can list it for the project. */
    note(key: string, note: { version?: { message: string; date: string }; push?: { ok: boolean; message: string } }): Promise<void>
  }

  /**
   * The writer's books: those on the recent list, and every book in their series. Needs "library:read". API 2.
   */
  library: {
    books(): Promise<LibraryBook[]>
    activity(): Promise<LibraryActivity>
    /** Opens a book, closing the current one, optionally at a given document. Returns false if that fails. */
    open(path: string, opts?: { select?: string }): Promise<boolean>
  }

  net: {
    /**
     * Makes an https request to a host the plugin may reach, and returns the whole response (on a computer, up to
     * 20 MB within 30 seconds). Plain http works only for localhost and 127.0.0.1. Redirects aren't followed.
     */
    fetch(
      url: string,
      init?: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array },
    ): Promise<FetchResult>
    /**
     * Like fetch, but passes the response body to onChunk as text while it arrives, for example an AI model's reply.
     * Resolves with the status and headers once the response is complete. Up to 200 MB and ten minutes. On a phone,
     * the whole body arrives as one chunk. Chromium buffers the first 512 bytes of a text/plain response to detect
     * its type, so they may arrive together unless the response has "X-Content-Type-Options: nosniff". Event
     * streams and JSON aren't affected.
     */
    stream(
      url: string,
      init: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array } | undefined,
      onChunk: (text: string) => void,
    ): Promise<{ ok: boolean; status: number; statusText: string; headers: Record<string, string> }>
    /** Like stream, but passes each chunk as raw bytes, for binary data. Up to 200 MB and ten minutes. API 10: check that it exists. */
    streamBytes?(
      url: string,
      init: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array } | undefined,
      onChunk: (chunk: Uint8Array) => void,
    ): Promise<{ ok: boolean; status: number; statusText: string; headers: Record<string, string> }>
  }

  /**
   * Files on the computer. The plugin can access only what the writer chose for it (with pickFolder and pickFile),
   * and its own temporary folder. Needs "files:read" or "files:write". All paths are absolute.
   */
  files: {
    /**
     * Asks the writer to choose a folder, and returns its path or null. The plugin can then read what's in it, and
     * change it if `write` is set and the plugin has "files:write".
     */
    pickFolder(opts?: { write?: boolean; title?: string }): Promise<string | null>
    /** Asks the writer to choose a file to open, or where to save one if `save` is set. Returns the path, or null if they cancel. */
    pickFile(opts?: { save?: boolean; name?: string; extensions?: string[]; title?: string }): Promise<string | null>
    granted(): Promise<{ path: string; write: boolean; file?: boolean }[]>
    /** The plugin's temporary folder, for passing files to programs. */
    temp(): Promise<string>
    read(path: string): Promise<Uint8Array>
    readText(path: string): Promise<string>
    write(path: string, data: string | Uint8Array): Promise<void>
    list(path: string): Promise<FileEntry[]>
    stat(path: string): Promise<{ folder: boolean; size: number; modified: string } | null>
    mkdir(path: string): Promise<void>
    /** Moves a file to the system's trash. */
    trash(path: string): Promise<void>
  }

  /**
   * Runs programs that the manifest lists as "exec:<program>". Each is found by name on the PATH and runs without a
   * shell. `timeout` is in milliseconds: one minute by default, ten minutes at most.
   */
  exec: {
    run(
      program: string,
      args?: string[],
      opts?: { input?: string | Uint8Array; cwd?: string; timeout?: number },
    ): Promise<ExecOutput>
  }

  /** The plugin's optional permissions (see the manifest's optionalPermissions). API 5: check that this exists before using it. */
  permissions?: {
    /** Asks the writer to allow the permission, in the app's own window. Resolves to true if it's allowed, whether now or earlier. */
    request(permission: string | string[]): Promise<boolean>
    /** Whether the plugin has the permission now. In a sandboxed plugin, the answer comes as a promise. */
    has(permission: string): boolean | Promise<boolean>
  }

  /**
   * Speech recognition on the device: nothing is sent anywhere. On a computer it uses Whisper, whose model is
   * downloaded once the writer agrees. On a phone or tablet it uses the system's recogniser. Needs "microphone",
   * and isn't available to sandboxed plugins. API 4.
   *
   * `language` is a code like "sv" or "en". Use '' to let a computer detect the language from the speech.
   *
   * `model` selects the Whisper model on a computer. Each model is downloaded once:
   * - For every language: "tiny", "base", "small" (the default), "medium", "large-v3-turbo" or "large-v3".
   * - For English only: "tiny.en" to "medium.en".
   * - For Swedish only: "kb-tiny" to "kb-large" (KB-Whisper), or "pianissimo" (Klang's Pianissimo, API 5).
   *
   * Each model is used with Silero voice activity detection, which detects where a phrase ends. A phone uses these
   * models only when it uses Whisper instead of the system's recogniser (see SpeechChoice.engine).
   */
  speech: {
    /** Reports whether recognition is ready. If not, says what's missing: a download (`size` bytes, if known), or that it's unavailable here. */
    status(language: string, opts?: SpeechChoice): Promise<SpeechStatus>
    /**
     * Loads the model ahead of time, such as when a book opens, so the first dictation is as fast as the rest.
     * It only loads a model already on the device, and never downloads one. The model is unloaded after ten
     * minutes without use. Returns true if it's ready. API 5: check that it exists before calling it.
     */
    preload?(language: string, opts?: SpeechChoice): Promise<boolean>
    /** Downloads what's needed, after asking the writer. Returns false if they decline. */
    prepare(language: string, opts?: SpeechChoice & { onProgress?: (fraction: number) => void }): Promise<boolean>
    /** Starts listening and resolves with a session. The session's stop() returns the recognised text. On a phone, onPartial receives words as they're heard. */
    listen(opts: SpeechChoice & {
      /** Use '' to detect the language among `languages`, the app's language, the system's language and English. */
      language: string
      languages?: string[]
      /** The current phrase, as recognised so far. */
      onPartial?: (text: string) => void
      /** Receives each finished phrase when the writer pauses. With onSegment, stop() returns only the text not yet passed to it. */
      onSegment?: (text: string) => void
      /** Called when something goes wrong. No more text will arrive. */
      onError?: (message: string) => void
      /** Receives the input level (0 to 1) several times a second, for showing that the microphone hears something. Older versions of the app don't call this. */
      onLevel?: (level: number) => void
      /** How long a pause ends a phrase: 'quick', 'balanced' (the default), 'patient', or a number of seconds. API 5. */
      pause?: 'quick' | 'balanced' | 'patient' | number
      /** The microphone to use, by its id from microphones(). Without one, the system's default is used. API 5. */
      microphone?: string
    }): Promise<SpeechSession>
    /** The available microphones. Their names appear once the writer has allowed the app to use one. API 5. */
    microphones?(): Promise<{ id: string; name: string }[]>
  }
}

/** Options for how speech is recognised. Pass the same options to status, prepare and listen. */
export interface SpeechChoice {
  /** The Whisper model (see app.speech). */
  model?: string
  /** Runs Whisper on the CPU, even if a GPU is available. */
  processor?: boolean
  /** On a phone: 'system' uses the system's recogniser, 'whisper' uses Whisper, and 'auto' uses the system's where it supports the language. */
  engine?: 'auto' | 'system' | 'whisper'
}

/** A position in the text for inserting text over time. See app.editor.anchor. */
export interface EditorAnchor {
  docId: string
  /** The character just before the position, to decide whether new text needs a space first. */
  before(): string
  /** The character just after the position, to decide whether new text needs a space after it. API 5: check that it exists. */
  after?(): string
  /** Shows greyed-out words at the position, as dictation does. They aren't part of the text. Use '' to clear them. API 5: check that it exists. */
  draft?(text: string): void
  /** Inserts plain text at the position, after anything inserted earlier. Returns false if the document is no longer open in an editor. */
  insert(text: string): boolean
  /** Call this when you're finished with the anchor. It also clears any draft. */
  release(): void
}

export interface SpeechStatus {
  ready: boolean
  /** The number of bytes still to download, if known. */
  size: number
  /**
   * On a computer, the parts of that download: the model itself (`model: true`) and the voice detection model.
   * API 7: check that it exists.
   */
  parts?: { title: string; size: number; model: boolean }[]
  /** Why it can't work on this device: there's no recogniser, or it doesn't support this language. */
  unavailable?: 'device' | 'language'
}

export interface SpeechSession {
  /** Stops listening and returns what was said. */
  stop(): Promise<string>
  /** Stops listening and discards what was heard. */
  cancel(): void
  /** Pauses listening and releases the microphone until resume() is called. Text recognised so far is kept. Older versions of the app don't have this, so check that it exists. */
  pause?(): void
  resume?(): void
}

/** What the writer right-clicked on in the text. */
export interface EditorContext {
  docId: string
  /** The selected text, or '' if there's none. */
  selection: string
  /** The word at the caret, when nothing is selected. */
  word: string
}

/** A part of a paragraph to mark, given as character offsets in its text. */
export interface HighlightRange {
  from: number
  to: number
  /** Shown as a tooltip when the pointer hovers over the mark, and in its right-click menu. */
  message?: string
  /** Actions for the mark's right-click menu, such as "Ignore". The highlighter's onAction gets the chosen one. API 6. */
  actions?: { id: string; label: string }[]
  /**
   * Hides the mark from the text and the right-click menu. ui.listMarks still lists it separately, with its
   * actions. Use this for something the writer ignored, with an action to show it again. API 9: older versions
   * of the app draw it like any other mark, so only use this when app.apiVersion is 9 or higher.
   */
  quiet?: boolean
}

/** The mark that an action was chosen for. API 6. */
export interface MarkInfo {
  /** The marked text. */
  text: string
  /** The text of the paragraph it's in, as passed to `find`, and the mark's offsets in it. */
  paragraph: string
  from: number
  to: number
  /** The document it's in. */
  docId: string
}

/** The compiled book, passed to an export format. */
export interface ExportInput {
  title: string
  author: string
  language: string
  /** The whole manuscript as one HTML document, the same as the app's own HTML export. */
  html: string
  /** Each part in reading order: a folder's title, or a scene's title and text as HTML. */
  items: { id: string; title: string; depth: number; isFolder: boolean; section: 'front' | 'body' | 'back'; html: string }[]
}

export interface SettingField {
  key: string
  label: string
  /** 'secret' is text shown as dots, for an API key or password (API 3). */
  type: 'text' | 'secret' | 'textarea' | 'number' | 'toggle' | 'select'
  description?: string
  default?: unknown
  options?: { value: string; label: string }[]
  /** Shows the field only while other settings have one of these values: { source: ['web', 'feed'] }. API 5. */
  showWhen?: Record<string, string[]>
  /** Puts the field in a collapsed section with this heading, with any other fields that use the same heading. API 5. */
  folded?: string
}

/**
 * `item-data-change` (API 11): this plugin's data for an item changed, here or on another device or by a co-author.
 * The argument is the item's id. `shared-data-change` (API 11): this plugin's shared data changed, the same way; its
 * argument is null. Only the plugin whose data it is hears either.
 */
export type PluginEvent = 'project-open' | 'project-close' | 'selection-change' | 'doc-change' | 'nodes-change' | 'item-data-change' | 'shared-data-change'

/** A suggestion offered as the writer types after a trigger. */
export interface Suggestion {
  label: string
  /** The text that replaces the trigger and everything typed after it. Defaults to `label`. */
  insert?: string
  detail?: string
}

/** A file the writer picked to import. */
export interface ImportFile {
  name: string
  /** The extension in lower case, without the dot. */
  ext: string
  data: Uint8Array
  /** The contents as text (UTF-8). */
  text: string
}

/** The file or folder the writer picked for a book importer. API 7. */
export interface ImportSource {
  /** Its name: "Sample.scriv", "outline.pltr". */
  name: string
  /** The extension in lower case, without the dot. */
  ext: string
  /** True for a folder. On a phone, this is the folder inside the zip the writer chose. */
  folder: boolean
  /** A file's contents as bytes and as text (UTF-8). Not set for a folder. */
  data?: Uint8Array
  text?: string
  /** Every file in a folder, at any depth, with paths using "/". Empty for a single file. */
  files: { path: string; size: number }[]
  /** Reads a file in the folder, by its path in `files`. */
  read(path: string): Promise<Uint8Array>
  readText(path: string): Promise<string>
}

/**
 * An item in an imported book's binder. `id` is only for other items in the import to refer to it, such as a
 * scene's cast or a beat's scene. The app assigns its own id. API 7.
 */
export interface ImportedItem {
  id?: string
  /**
   * The item's type. Without one, an item with children is a folder. Any other item takes the type of the navigator
   * section it's in: a scene in the manuscript, a sheet in characters, a note in Notes, a document in Research.
   */
  type?: NodeType
  /** An entry's kind: the `id` of one of the book's `kinds` (API 12). */
  kind?: string
  title: string
  /** The text as HTML: paragraphs, headings, emphasis, lists, quotes, and <hr> for a scene break. */
  html?: string
  synopsis?: string
  notes?: string
  keywords?: string[]
  /** The label and status, by their ids in the book's `labels` and `statuses`. */
  label?: string
  status?: string
  /** Whether Compile includes the item. Defaults to true. */
  includeInCompile?: boolean
  /** Fields for a sheet ("Age", "Born"…), added to the fields the book already has. */
  fields?: Record<string, string>
  /** When the scene happens, as written on its card. */
  when?: string
  /** The characters in a scene, and where it's set, by their item ids. */
  cast?: string[]
  place?: string
  /** For a "file" item: its path in the picked folder, and the name to save it under. */
  file?: { path: string; name: string }
  children?: ImportedItem[]
}

/**
 * The book that a book importer returns. The writer can make it a new book or add it to the open one.
 *
 * As a new book, its labels and statuses, if any, replace the writer's defaults.
 *
 * When it's added to the open book:
 * - The manuscript and research each go in a new folder.
 * - Characters and places are merged with the existing sheets, matching sheets by name.
 * - Labels, statuses and storylines are matched by name.
 * - The trash is left out.
 *
 * API 7.
 */
export interface ImportedBook {
  title: string
  author?: string
  /** A summary of what was imported, shown in the dialog before the writer chooses. */
  about?: string
  /** The name of the new folders when adding to the open book: "From Scrivener — Sample". */
  folder?: string
  labels?: { id: string; name: string; color?: string }[]
  statuses?: { id: string; name: string; color?: string }[]
  storylines?: { id: string; name: string; color?: string; description?: string }[]
  manuscript?: ImportedItem[]
  characters?: ImportedItem[]
  places?: ImportedItem[]
  notes?: ImportedItem[]
  research?: ImportedItem[]
  trash?: ImportedItem[]
  /** Beats (cards on the plot grid). Each names its storyline by id, and its scene by id if it belongs to one. */
  beats?: { storyline: string; scene?: string; title: string; description?: string }[]
  /** Kinds of entry, as you'd give them to defineKind (API 12). Items use them with `type: 'entry'` and `kind`. */
  kinds?: KindDefinition[]
}

export declare class Plugin {
  readonly app: App
  readonly manifest: Manifest
  /** The current values of the settings declared with `addSettings`. */
  settings: Record<string, unknown>

  /** Called when the plugin starts. Add commands, views and so on here. */
  onload(): void | Promise<void>
  /** Called when the plugin is turned off. Clean up anything the app doesn't remove itself. */
  onunload(): void
  /*
   * Every add… method returns a function that removes what it added (the text form of addStatusBarItem returns an
   * object instead), which is useful when a setting changes what a plugin offers. Anything still there is removed
   * when the plugin is turned off.
   */

  /** Registers something to clean up when the plugin is turned off, such as a timer or a listener. */
  register(dispose: () => void): void

  /** Adds a command to the command palette (Ctrl+K) and, unless `menu` is false, the Plugins menu. `hotkey` looks like "Mod+Shift+F", where Mod is Ctrl or ⌘. */
  addCommand(command: {
    id: string
    name: string
    hotkey?: string
    menu?: boolean
    when?: () => boolean
    run: () => void | Promise<void>
  }): () => void
  /** Adds a view beside the corkboard and outliner. Window only. */
  addView(view: { id: string; name: string; icon?: ComponentType<{ size?: number }>; render: () => ReactNode }): () => void
  /** Adds a tab to the inspector, for items where `when` returns true. Window only. */
  addInspectorTab(tab: {
    id: string
    name: string | ((nodeId: string) => string)
    /** Whether the tab is for this item. `kind` is an entry's kind, "<plugin id>:<kind id>" (API 12). */
    when?: (nodeId: string, node: { type: NodeType; title: string; kind?: string }) => boolean
    render: (nodeId: string) => ReactNode
  }): () => void
  /** Adds a status bar item. Either draw it with `render` (window only), or give it `text` and change that with setText, which also works in a sandboxed plugin. */
  addStatusBarItem(item: { id: string; render: () => ReactNode }): () => void
  addStatusBarItem(item: { id: string; text: string; title?: string; onClick?: () => unknown }): {
    setText(text: string, title?: string): void
  }
  /** Adds an item to the editor's right-click menu. `show` defaults to 'always'. In a sandboxed plugin, the label must be a string and `when` isn't available, so use `show`. */
  addEditorMenuItem(item: {
    id: string
    label: string | ((ctx: EditorContext) => string)
    show?: 'selection' | 'no-selection' | 'always'
    when?: (ctx: EditorContext) => boolean
    run: (ctx: EditorContext) => void | Promise<void>
  }): () => void
  /** Adds an item to the navigator's right-click menu. */
  addBinderMenuItem(item: {
    id: string
    label: string | ((nodeId: string) => string)
    when?: (nodeId: string) => boolean
    run: (nodeId: string) => void | Promise<void>
  }): () => void
  /** Adds a format to Compile. Return text, or bytes for a binary format. */
  addExporter(exporter: {
    id: string
    name: string
    description?: string
    extension: string
    export: (book: ExportInput) => string | Uint8Array | Promise<string | Uint8Array>
  }): () => void
  /** Adds marks to the text, found one paragraph at a time. The app draws them, and they're never saved. */
  addHighlighter(highlighter: {
    id: string
    color?: string
    find: (text: string) => HighlightRange[] | Promise<HighlightRange[]>
    /** Called when the writer chooses one of a mark's `actions` from its right-click menu. API 6. */
    onAction?: (action: string, mark: MarkInfo) => unknown
  }): () => void
  /** Runs every highlighter again, for example after a setting that affects them changes. */
  refreshHighlights(): void
  /** Adds TipTap extensions to every editor. Window only. */
  registerEditorExtension(extension: AnyExtension | AnyExtension[]): () => void
  /** Adds a panel to the sidebar, beside the binder. Window only. */
  addSidebarPanel(panel: { id: string; name: string; render: () => ReactNode }): () => void
  /** Adds a button to the editor's toolbar. In a sandboxed plugin, the icon is text, such as an emoji. */
  addToolbarButton(button: {
    id: string
    title: string
    icon?: ComponentType<{ size?: number }> | string
    active?: () => boolean
    run: () => void | Promise<void>
  }): () => void
  /** Shows suggestions under the caret as the writer types after `trigger` ("@", "#"…) at the start of a word. `trigger` must be a single character. */
  addSuggester(suggester: {
    id: string
    trigger: string
    find: (query: string, ctx: { docId: string }) => Suggestion[] | Promise<Suggestion[]>
  }): () => void
  /** Adds a file type the app can't read itself to File → Import Documents. Each file becomes one or more documents. */
  addImporter(importer: {
    id: string
    name: string
    extensions: string[]
    import: (file: ImportFile) => { title: string; html: string }[] | Promise<{ title: string; html: string }[]>
  }): () => void
  /**
   * Imports a whole book from another app's file or folder, such as a Scrivener project or a Plottr outline. It
   * appears in File → Import, and on the welcome screen while the plugin is on.
   *
   * The app asks for the file or folder, passes it to `import`, and shows the writer the result. The writer can
   * then make it a new book or add it to the open one. To explain why a file can't be read, throw an Error: the
   * writer sees its message. This needs no permission, because it reads only what the writer picked. API 7.
   */
  addBookImporter(importer: {
    id: string
    /** The name in File → Import: "Scrivener Project". */
    name: string
    /** The app name for "Import from …" on the welcome screen: "Scrivener". Defaults to `name`. */
    from?: string
    /** The file extensions without the dot: ["pltr"]. For a folder, use the folder's extension: ["scriv"]. */
    extensions: string[]
    /** True if it reads a folder (a .scriv), not a file. Phones can't choose folders, so the writer chooses a zip of it. */
    folder?: boolean
    import: (source: ImportSource) => ImportedBook | Promise<ImportedBook>
  }): () => void
  /**
   * Adds a card to the welcome screen's dashboard, shown while no book is open. `size` is 'half' (the default) or
   * 'full' width. Cards are sorted by `order`, lowest first (default 100). These only set where a card starts: the
   * writer can move it and change its width later. Window only. API 2.
   */
  addDashboardWidget(widget: {
    id: string
    name: string
    size?: 'half' | 'full'
    order?: number
    render: () => ReactNode
  }): () => void
  /** Adds settings that the app draws in Settings → Plugins. Read their values from `this.settings`. */
  addSettings(fields: SettingField[]): () => void
  /** Adds a settings panel that the plugin draws itself. Window only. */
  addSettingsPanel(render: () => ReactNode): () => void
  onSettingsChange(listener: (settings: Record<string, unknown>) => void): void
  updateSettings(patch: Record<string, unknown>): Promise<void>
  on(event: PluginEvent, handler: (arg: string | null) => void): void
  /**
   * Registers a handler for a moment when the app waits for plugins:
   * - 'session-end': a writing session ended, after 30 minutes without writing or because the book is closing.
   * - 'copy-due': the writing timer is due and something has changed, or a new book was created.
   * - 'project-closing': a book is closing, or the app is quitting.
   *
   * If the handler returns a promise, the app waits for it for up to 30 seconds (10 for 'session-end'), then carries
   * on. A plugin has one handler per event: calling `during` again for the same event replaces it. API 10.
   */
  during(event: 'session-end' | 'copy-due' | 'project-closing', handler: (info: WaitInfo) => unknown): () => void
  /**
   * Provides a version history of the project, which the app shows in Book → Versions & Backups and in a document's
   * history. The app does the drawing, so this works in a sandboxed plugin. The plugin implements:
   * - `list`: the versions, newest first. With `file` (a path in the project's folder), only those that changed it.
   * - `read`: a file's text in a version.
   * - `save`: saves a version with the writer's message. Returns false if nothing has changed since the last one.
   * - `status` (optional): a message for the writer, such as a failed backup, or null.
   *
   * The app handles restoring, and always takes a snapshot of the document first. If more than one plugin provides a
   * history, the app shows the first. API 10.
   */
  addVersionHistory(history: {
    id: string
    list(file?: string): Promise<VersionEntry[]>
    read(version: string, file: string): Promise<string>
    save(message: string): Promise<boolean>
    status?(): Promise<{ text: string; problem?: boolean } | null>
  }): () => void
  /** Tells the app that the list of versions changed, so it reloads what it shows. API 10. */
  versionsChanged(): void
  /** The plugin's own data on this computer. For data stored in the book, see app.project.getData. */
  loadData(): Promise<unknown>
  saveData(data: unknown): Promise<void>
}
