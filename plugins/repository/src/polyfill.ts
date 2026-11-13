// Provides the Node global that isomorphic-git expects (Buffer) before anything uses it. A sandboxed plugin's worker doesn't have it.
import { Buffer } from "buffer";

const g = globalThis as { Buffer?: typeof Buffer };
g.Buffer ??= Buffer;
