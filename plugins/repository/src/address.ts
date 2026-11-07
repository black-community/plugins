/*
 * Which repository addresses the plugin will use. Everything goes over https, with a user name and an access token. Plain http
 * is only for this computer, where nothing travels over a network, and the app's plugin rules allow only that too. There's no
 * SSH on any device, so an SSH address gets a plain message asking for the https one.
 */

export type AddressProblem = "ssh" | "http" | "login" | "other";

/** Returns whether git would reach this address over SSH: ssh://… or user@host:path. */
export const isSsh = (url: string) =>
  /^(ssh|git\+ssh):\/\//i.test(url.trim()) || /^[\w.-]+@[\w.-]+:(?!\/\/)/.test(url.trim());

/** Returns what's wrong with a repository's address, or null if the plugin can use it. */
export function addressProblem(url: string): AddressProblem | null {
  const text = url.trim();
  if (isSsh(text)) return "ssh";
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return "other";
  }
  if (u.username || u.password) return "login";
  if (u.search || u.hash) return "other";
  const local = u.hostname === "127.0.0.1" || u.hostname === "localhost";
  if (u.protocol === "http:") return local ? null : "http";
  if (u.protocol !== "https:") return "other";
  return null;
}

/** Returns the permission the app's window asks the writer about for this address. See the app's src/lib/pluginRules.ts. */
export const addressPermission = (url: string) => {
  const u = new URL(url.trim());
  return `address:${u.origin}${u.pathname.replace(/\/+$/, "")}`;
};

/** Returns whether `branch` is a plain branch name. Options, ranges and anything else git would read as more than a name are refused. */
export const validBranch = (branch: string) =>
  typeof branch === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/.test(branch) &&
  !branch.includes("..") &&
  !branch.includes("//") &&
  !/(^|\/)\.|\.lock(\/|$)|[/.]$/.test(branch);

/**
 * Returns a branch name for a project in the repository shared by all projects. It's the title made safe for git, plus a
 * short random tail so two books with the same title never share a branch. "Fyrvaktarens dotter" → fyrvaktarens-dotter-k3x9qa.
 */
export function branchFor(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  const tail = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
  return `${slug || "project"}-${tail}`;
}

/** The branch name used in a project's own repository. */
export const OWN_BRANCH = "main";

/**
 * Returns whether a path in a commit's tree may become a file in the project. The path comes from a repository anyone with
 * access to it could have written. It isn't allowed outside the folder, inside .git or .sync (however it's spelled
 * on Windows or macOS), or under a name only one system accepts. The app checks every path again when it's written.
 */
export function safeTreePath(file: unknown): file is string {
  if (typeof file !== "string" || !file || file.length > 4096) return false;
  for (const part of file.split("/")) {
    if (!part || part === "." || part === "..") return false;
    if (/[\\:\0-\x1f\x7f]/.test(part) || /[. ]$/.test(part)) return false;
    const plain = part.normalize("NFC").replace(/[​-‏‪-‮⁠-⁤﻿]/g, "");
    if (/^(\.git|git~\d+|\.sync)$/i.test(plain)) return false;
  }
  return true;
}
