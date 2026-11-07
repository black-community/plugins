// Provides what isomorphic-git expects from Node (Buffer), before anything uses it. A sandboxed plugin's worker has none.
import { Buffer } from "buffer";

const g = globalThis as { Buffer?: typeof Buffer };
g.Buffer ??= Buffer;
