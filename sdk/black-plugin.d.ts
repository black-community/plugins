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
 *   uses the app's copy: import React from 'react'.
 * - In its own worker, if its manifest has "sandboxed": true. It can use
 *   everything here except what draws: views, inspector tabs, settings panels
 *   and editor extensions.
 *
 * Code that avoids those drawing features works in both places.
 *
 * Everything a plugin adds through these methods is removed when the plugin is
 * turned off or reloaded. A plugin reaches the book only through `this.app`. It
 * reaches the internet only through `this.app.net.fetch`, and only the hosts
 * that its manifest names and the writer allowed.
 */

import type { ReactNode, ComponentType } from 'react'
import type { AnyExtension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'

/** The open project's folder, as app.folder gives it. */
export interface ProjectFolder {
  key: string
  name: string
  /** Where the open book's files are in the project: `books/<id>`. */
  book: string
}

/** One version in a plugin's list, newest first. */
export interface VersionEntry {
  /** The plugin's own name for the version, which the app gives back to read it. */
  id: string
  label: string
  /** When it was saved, as an ISO date. */
  at: string
}

/** What the app says about a moment it waits for (Plugin.during). */
export interface WaitInfo {
  /** The project's total of words now. */
  words: number
  /** Whether anything in the project changed since the last time the app said so. */
  changed: boolean
  /** Whether the app is quitting or going to the background, so nothing can carry on afterwards. */
  quitting?: boolean
  /** Why a copy is due: the writing timer, or a new book. */
  reason?: 'timer' | 'new-book'
}

export interface Manifest {
  /** Lower-case letters, digits and dashes. It's also the name of the plugin's folder. */
  id: string
  name: string
  version: string
  description: string
  author: string
  /**
   * The API version the plugin needs. The default is 1. Use a higher one for these features:
   * - 2: the dashboard and the library
   * - 3: the microphone
   * - 4: app.speech
   * - 5: dictation drafts, pauses and microphone choice
   * - 6: actions on marks
   * - 7: book importers
   * - 8: `permissionReasons` and `category` in the manifest. A plugin that uses only these two doesn't need
   *   version 8, because older versions of the app ignore them.
   * - 9: quiet marks
   * - 10: app.folder and "project:folder", "network:ask", app.net.streamBytes, `during`, addVersionHistory,
   *   project.flush and project.getProjectData
   */
  apiVersion: number
  /** The plugin's script in its folder, normally main.js. */
  main: string
  /** Run the plugin in its own worker instead of the app's window. */
  sandboxed: boolean
  /** The name and description in other languages: { "sv": { "name": "…", "description": "…" } }. */
  locales?: Record<string, { name?: string; description?: string }>
  /**
   * Permissions the plugin may ask for later with app.permissions.request, when the writer chooses something
   * that needs them, such as a service to send text to. They're the same kinds as in `permissions`, but the
   * writer isn't asked when the plugin is turned on. API 5.
   *
   * "network:ask" lets the plugin ask for an address the writer entered, such as a repository's, which it can't
   * name in advance: request `address:https://host/path`. The writer is asked about that exact address, and only that
   * address and what's under it can then be reached. API 10.
   */
  optionalPermissions?: string[]
  /**
   * Why the plugin needs a permission from `permissions` or `optionalPermissions`. The writer sees this when
   * asked to allow it, under "it needs to:", above the app's own description of the permission. Say what is
   * sent where, and why. Write it so it completes "it needs to …". Give one text, or one for each language
   * code. Each can be up to 300 characters. API 8.
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
   * The group Manage Plugins lists the plugin under:
   * - "writing": works in the text as it's written
   * - "planning": the binder, cards and views
   * - "welcome": the welcome screen
   * - "import-export": getting books in and out
   * - "other": anything else
   *
   * Without a category, the plugin is grouped by what it adds while it's on, and under "other" while it's off. API 8.
   */
  category?: 'writing' | 'planning' | 'welcome' | 'import-export' | 'other'
  /**
   * What the plugin needs beyond reading the book. The writer is asked to allow each one:
   * - "project:write": change the book.
   * - "library:read": see the writer's recent books and their series (app.library), for the dashboard.
   * - "project:folder": read and change every file in the open project's folder, including hidden ones such as a
   *   version history (app.folder). It reaches nothing outside that folder. API 10.
   * - "microphone": record audio with navigator.mediaDevices.getUserMedia, in the window. API 3.
   * - "network:<host>": talk to that host. Use "network:*.<host>" to include its subdomains, or "network:*" for any host.
   * - "files:read", "files:write": read or change files and folders the writer chooses for the plugin.
   * - "exec:<program>": run that program, found by name on the PATH, without a shell.
   */
  permissions: string[]
}

export type NodeType = 'text' | 'folder' | 'character' | 'place' | 'note' | 'research' | 'file'

export interface NodeInfo {
  id: string
  title: string
  type: NodeType
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
  /** The series the book is in: its name and folder, the book's position (from 0), and the number of books. */
  series: { name: string; path: string; index: number; books: number } | null
  /** The number of words and scenes in the manuscript. */
  words: number
  scenes: number
  /** The word goal (0 for none) and the due date (YYYY-MM-DD, or '' for none). */
  target: number
  deadline: string
  /** The daily writing goal (0 for none). */
  sessionTarget: number
  /** Words added on each day (YYYY-MM-DD, in the writer's time zone). Empty for a book that isn't counted. */
  history: Record<string, number>
  /**
   * Whether the book counts in the writer's statistics. It's false for a sample, or for a book or series
   * the writer left out, so leave those out of totals and goals. Older versions of the app don't set it, so
   * treat a missing value as true.
   */
  counted?: boolean
  /** The number of scenes with each status, in the book's order of statuses. */
  statuses: { name: string; count: number }[]
  /** The last scene written in, with its current ending (plain text, a few hundred characters). */
  last: { id: string; title: string; modified: string; excerpt: string } | null
}

/** Recent events in the writer's books. */
export interface LibraryActivity {
  /** The latest saved versions (git commits), newest first. */
  versions: { book: string; title: string; message: string; date: string }[]
  /** The latest zip backups, newest first. */
  backups: { file: string; date: string; size: number }[]
  /** Each book's last push of its history, newest first. */
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
    create(type: 'text' | 'folder' | 'character' | 'place' | 'note' | 'research', title: string, parentId?: string): Promise<string>
    meta(id: string): Promise<MetaInfo | null>
    setMeta(id: string, patch: Partial<Pick<MetaInfo, 'synopsis' | 'notes' | 'keywords' | 'fields' | 'when'>>): Promise<void>
    /** Moves an item to the trash, where the writer can restore it. */
    trash(id: string): Promise<void>
    rename(id: string, title: string): Promise<void>
    /** Moves an item into a folder, at `index` among its children, or at the end if there's no index. */
    move(id: string, parentId: string, index?: number): Promise<void>
    labels(): Promise<Label[]>
    statuses(): Promise<Status[]>
    /** Sets a label by its id. Use '' for none. setStatus works the same way. */
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
    /** The series the book is in, and its books in order. */
    series(): Promise<{ name: string; books: { id: string; title: string; current: boolean }[] } | null>
    /** This plugin's data for this book, saved with the book. */
    /** Waits until everything written so far is on disk, so the project's files are all saved. API 10: check that it exists. */
    flush?(): Promise<void>
    /** This plugin's data in the project (kept in project.json, on this device), or undefined. API 10: check that it exists. */
    getProjectData?(): Promise<unknown>
    setProjectData?(value: unknown): Promise<void>
    /** Opens a project whose folder this plugin was given by folder.create. API 10: check that it exists. */
    open?(key: string): Promise<boolean>
    getData(): Promise<unknown>
    setData(value: unknown): Promise<void>
  }

  editor: {
    /** The TipTap editor the writer is using. Window only: it's null in a sandboxed plugin. */
    active(): Editor | null
    selection(): Promise<{ text: string; from: number; to: number } | null>
    /** Types text at the caret, replacing any selection. Needs "project:write". */
    insertText(text: string): Promise<boolean>
    /** Adds a margin comment on the selection. Needs "project:write". */
    comment(text: string): Promise<boolean>
    /**
     * A position to keep writing at while text arrives, as dictation does. It's the writer's cursor, or where
     * the cursor was before they clicked a button. If there's no cursor, it's the end of the open document.
     * Returns null if no document is open. Needs "project:write". Window only. API 4.
     */
    anchor(): Promise<EditorAnchor | null>
  }

  ui: {
    notify(message: string, action?: { label: string; run: () => void }): void
    /** Asks a yes-or-no question in the app's own dialog. Returns true for yes. */
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
      /** Called when the dialog goes away: closed by the writer (Escape, ✕) or `close`, or replaced by another dialog. */
      onClose?: (how: 'closed' | 'replaced') => void
    }): () => void
    /** Asks for a line of text. Returns null if the writer cancels. */
    prompt(opts: { title: string; label?: string; value?: string; placeholder?: string }): Promise<string | null>
    /** Asks the writer to choose one option. Returns null if they cancel. */
    choose(opts: { title: string; options: { value: string; label: string; detail?: string }[] }): Promise<string | null>
    /** Starts a timed writing sprint in the open book, like the one in the status bar (1 to 600 minutes). API 2. */
    startSprint(minutes: number): void
    /**
     * Lists the marks from one of this plugin's highlighters in the current document, each with the words
     * around it. The app goes to the mark the writer chooses, and selects it. Returns false if there were no
     * marks, or none was chosen. API 6: check that it exists before calling it.
     */
    listMarks?(opts: {
      highlighter: string
      title: string
      /** The heading above quiet marks (HighlightRange.quiet), which come last, each with its actions. API 9. */
      quietTitle?: string
    }): Promise<boolean>
  }

  /**
   * The open project's folder, which holds its books. Needs "project:folder". API 10: check that it exists before using it.
   *
   * A path is relative to the project, with "/" between its parts. A path that's absolute, holds "..", leads through a
   * link, or names `.sync` or a `.git` further down is refused. Every call takes the project's key, from current(), so
   * work begun on one project can't land in the next one opened. A key stops working a short while after its project closes.
   */
  folder?: {
    /** The open project: its key, its name, and where the open book's files are in it (`books/<id>`). Returns null if none is open. */
    current(): Promise<ProjectFolder | null>
    /** Asks where a new project goes and makes its folder, to fill with a project from elsewhere. Returns null if the writer cancels. */
    create(title: string, name: string): Promise<ProjectFolder | null>
    /** Removes a folder from create() that was never finished. */
    discard(key: string): Promise<void>
    /** The file's bytes, or null if there's no such file. Reading through a link is refused. */
    read(key: string, path: string): Promise<Uint8Array | null>
    /** Writes the whole file, making the folders above it. */
    write(key: string, path: string, data: string | Uint8Array): Promise<void>
    /** Removes a file. Returns whether there was one. */
    remove(key: string, path: string): Promise<boolean>
    /** What's in a folder ('' is the project's), or null if there's no such folder. */
    list(key: string, path: string): Promise<{ name: string; folder: boolean; link: boolean }[] | null>
    /** Describes a file or folder without following a link. Returns null if there's nothing there. */
    stat(key: string, path: string): Promise<{ folder: boolean; link: boolean; size: number; mode: number; mtimeMs: number; ctimeMs: number; ino: number; uid: number; gid: number; dev: number } | null>
    mkdir(key: string, path: string): Promise<void>
    /** Removes an empty folder. Returns false if it holds anything, or isn't there. */
    rmdir(key: string, path: string): Promise<boolean>
    /** Says that these files came from elsewhere: they're marked as downloaded, and the open book reads them again. */
    arrived(key: string, paths: string[]): Promise<void>
    /** Tells the app about a new version or a push, which the dashboard lists for every project. */
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
    /** Fetches over https, from hosts in the manifest that the writer allowed. */
    fetch(
      url: string,
      init?: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array },
    ): Promise<FetchResult>
    /**
     * Fetches a response as it arrives, passing each piece to onChunk as text. It's useful for an AI's reply, for
     * example, and can run for up to ten minutes. Chromium reads the first 512 bytes of a plain-text response to
     * guess its type, so those may arrive together unless it has "X-Content-Type-Options: nosniff". Event streams
     * and JSON aren't affected.
     */
    stream(
      url: string,
      init: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array } | undefined,
      onChunk: (text: string) => void,
    ): Promise<{ ok: boolean; status: number; statusText: string; headers: Record<string, string> }>
    /** Like stream, but each piece stays as bytes, for what isn't text. Up to 200 MB and ten minutes. API 10: check that it exists. */
    streamBytes?(
      url: string,
      init: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array } | undefined,
      onChunk: (chunk: Uint8Array) => void,
    ): Promise<{ ok: boolean; status: number; statusText: string; headers: Record<string, string> }>
  }

  /**
   * Files on the computer. The plugin can reach only what the writer chose for it (with pickFolder and pickFile),
   * and its own temporary folder. Needs "files:read" or "files:write". All paths are full paths.
   */
  files: {
    /** Asks for a folder. The plugin can then read what's in it, or change it if `write` is set. */
    pickFolder(opts?: { write?: boolean; title?: string }): Promise<string | null>
    /** Asks for a file to open, or where to save one if `save` is set. */
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

  /** Runs programs on the computer that the manifest names as "exec:<program>". They run by name, without a shell. */
  exec: {
    run(
      program: string,
      args?: string[],
      opts?: { input?: string | Uint8Array; cwd?: string; timeout?: number },
    ): Promise<ExecOutput>
  }

  /** The plugin's optional permissions (see the manifest's optionalPermissions). API 5: check that this exists before using it. */
  permissions?: {
    /** Asks the writer, in the app's own window. Returns true if the permission is allowed, now or earlier. */
    request(permission: string | string[]): Promise<boolean>
    /** Whether the plugin has the permission now. In a sandboxed plugin, the answer comes as a promise. */
    has(permission: string): boolean | Promise<boolean>
  }

  /**
   * Speech recognition on the device. Nothing is sent anywhere. A computer uses Whisper, with its model downloaded
   * once the writer agrees. A phone or tablet uses the system's recogniser. Needs "microphone", and a plugin in the
   * window. API 4.
   *
   * `language` is a code like "sv" or "en". Use '' to let a computer detect the language from the speech.
   *
   * `model` chooses the model on a computer, and each is downloaded once:
   * - For every language: "tiny", "base", "small" (the default), "medium", "large-v3-turbo" or "large-v3".
   * - For English only: "tiny.en" to "medium.en".
   * - For Swedish only: "kb-tiny" to "kb-large" (KB-Whisper), or "pianissimo" (Klang's Pianissimo, API 5).
   *
   * Each comes with Silero's voice detection, which finds where a phrase ends. A phone has its own recogniser too.
   */
  speech: {
    /** Whether it's ready to listen. If not, says what's needed: a download (`size` bytes, if known), or that it can't work here. */
    status(language: string, opts?: SpeechChoice): Promise<SpeechStatus>
    /**
     * Loads the model ahead of time, such as when a book opens, so the first dictation is as fast as the rest.
     * It only loads a model already on the device, and never downloads one. The model is unloaded after ten
     * minutes without use. Returns true if it's ready. API 5: check that it exists before calling it.
     */
    preload?(language: string, opts?: SpeechChoice): Promise<boolean>
    /** Downloads what's needed, after asking the writer. Returns false if they decline. */
    prepare(language: string, opts?: SpeechChoice & { onProgress?: (fraction: number) => void }): Promise<boolean>
    /** Starts listening until stopped, then returns what was said. A phone passes words to onPartial as it hears them. */
    listen(opts: SpeechChoice & {
      /** Use '' to detect the language among `languages`, the app's language, the system's language and English. */
      language: string
      languages?: string[]
      /** The current phrase, as recognised so far. */
      onPartial?: (text: string) => void
      /** Each finished phrase, when the writer pauses. stop() then returns only what's left. */
      onSegment?: (text: string) => void
      /** Called when something goes wrong. No more text will arrive. */
      onError?: (message: string) => void
      /** The volume from 0 to 1, several times a second, to show that it's hearing. Older versions of the app don't call this. */
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

/** How speech is recognised. Use the same choice for status, prepare and listen. */
export interface SpeechChoice {
  /** The Whisper model (see app.speech). */
  model?: string
  /** Runs Whisper on the processor, even if a graphics card could do it. */
  processor?: boolean
  /** On a phone: the system's recogniser, Whisper, or (auto) the system's where it supports the language. */
  engine?: 'auto' | 'system' | 'whisper'
}

/** A position in the text to keep writing at. See app.editor.anchor. */
export interface EditorAnchor {
  docId: string
  /** The character just before the position, to decide whether new text needs a space first. */
  before(): string
  /** The character just after the position, to decide whether new text needs a space after it. API 5: check that it exists. */
  after?(): string
  /** Shows greyed-out words at the position, as dictation does. They aren't part of the text. Use '' to clear them. API 5: check that it exists. */
  draft?(text: string): void
  /** Inserts plain text after what was written earlier. Returns false if the document is no longer on screen. */
  insert(text: string): boolean
  /** Call this when you're finished with the anchor. */
  release(): void
}

export interface SpeechStatus {
  ready: boolean
  /** The bytes still to download, if known. */
  size: number
  /**
   * On a computer, what those bytes are: the model itself (`model: true`) and its voice detection.
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
  /** Pauses until resume, and releases the microphone. What was said so far is kept. Older versions of the app lack this, so check that it exists. */
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
  /** Shown when the pointer rests on the mark, and in its right-click menu. */
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

/** The mark an action was chosen on. API 6. */
export interface MarkInfo {
  /** The marked text. */
  text: string
  /** The paragraph it's in, and its position there, matching what `find` received. */
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

export type PluginEvent = 'project-open' | 'project-close' | 'selection-change' | 'doc-change' | 'nodes-change'

/** A suggestion offered as the writer types after a trigger. */
export interface Suggestion {
  label: string
  /** The text that replaces the trigger and what followed it. Defaults to the label. */
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
   * The item's type. Without one, an item with children is a folder. Any other item takes the type of the binder
   * section it's in: a scene in the manuscript, a sheet in characters, a note in Notes, a document in Research.
   */
  type?: NodeType
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
  /** Fields for a sheet ("Age", "Born"…), added to the book's own. */
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
 * The book a book importer makes from another app's file. It can become a new book or join the open one.
 *
 * As a new book, its labels and statuses, if any, replace the writer's defaults.
 *
 * Added to the open book:
 * - The manuscript and research each go in a new folder.
 * - Characters and places join the existing sheets. A sheet with the same name counts as the same one.
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
  /** Beats (cards on the plot grid), by the storyline's id, and the scene's id if a beat is in a scene. */
  beats?: { storyline: string; scene?: string; title: string; description?: string }[]
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
   * Every add… method returns a function that removes what it added, which is useful when a setting changes what
   * a plugin offers. Anything still there is removed when the plugin is turned off.
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
    when?: (nodeId: string, node: { type: NodeType; title: string }) => boolean
    render: (nodeId: string) => ReactNode
  }): () => void
  /** Adds a status bar item. In the window, it draws itself. In a sandboxed plugin, it's text that you change with setText. */
  addStatusBarItem(item: { id: string; render: () => ReactNode }): () => void
  addStatusBarItem(item: { id: string; text: string; title?: string; onClick?: () => unknown }): {
    setText(text: string, title?: string): void
  }
  /** Adds an item to the editor's right-click menu. In a sandboxed plugin, the label must be a string and `when` isn't available, so use `show`. */
  addEditorMenuItem(item: {
    id: string
    label: string | ((ctx: EditorContext) => string)
    show?: 'selection' | 'no-selection' | 'always'
    when?: (ctx: EditorContext) => boolean
    run: (ctx: EditorContext) => void | Promise<void>
  }): () => void
  /** Adds an item to the binder's right-click menu. */
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
  /** Shows suggestions under the caret as the writer types after `trigger` ("@", "#"…) at the start of a word. */
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
   * Adds a card to the welcome screen's dashboard, shown while no book is open. `size` is half or full width, and
   * `order` sets the position (lower comes first, and the default is 100). The writer can move it and change its
   * width later. Window only. API 2.
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
   * Runs something at a moment the app waits for: 'session-end' (a pause ended a writing session), 'copy-due' (the writing
   * timer, or a new book) or 'project-closing' (a book is closing, or the app is quitting). The handler may return a
   * promise, and the app waits for it, up to a limit of 30 seconds (10 for 'session-end'). After that it carries on. API 10.
   */
  during(event: 'session-end' | 'copy-due' | 'project-closing', handler: (info: WaitInfo) => unknown): () => void
  /**
   * Offers a list of versions of the project, which the app draws in the book's history. It works in a sandboxed plugin, because
   * the app does the drawing. The plugin only answers: `list` the versions, newest first, or only those that changed a file;
   * `read` a file's text in a version; `save` a version with the writer's message (false if nothing changed); and `status`,
   * anything the writer should know. Restoring is the app's work, and it always takes a snapshot of the document first. API 10.
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
