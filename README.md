# Plugins for Bläck Studio, from the community

[Bläck Studio](https://blackstudio.app) offers this list by default, under Settings → Plugins → Find plugins. It's
marked as not official: the people who make Bläck Studio haven't checked what's here.

```
plugins/<id>/manifest.json     everything about a plugin but its words
plugins/<id>/locales/<lang>.json   its words, one file for each language
plugins/<id>/src/              its source
shared/i18n.ts                 reads the locales
zips/<id>-<version>.zip        every released version
plugins.json                   the list the app reads
sdk/                           the types of the plugin API (from black-extras' packages/black-plugin)
tests/                         the plugins' tests. tests/perf.bench.ts measures the Git repository plugin (vitest.perf.config.mts)
```

## Adding or changing a plugin

```bash
npm install
# edit plugins/<id>/, and raise the version in its manifest.json
npm run release   # builds zips/ and writes plugins.json
npm run verify && npm run check
npm test          # the plugins' own tests, in tests/
```

A version never changes once it's listed: a changed plugin needs a new version. How to write one is in
[the plugin guide](https://git.thunraz.se/magnus/black-extras/src/branch/master/packages/black-plugin/README.md).

## Translating a plugin

Add `plugins/<id>/locales/<language code>.json`, as a copy of `en.json`, and translate the values. That's all: the
build finds it. The `manifest` part is what the plugin list and the permission dialog show, and `messages` is the
plugin's own interface.

- Leave out anything you haven't translated, and English shows instead.
- Keep `{placeholders}` as they are. `npm run release` stops if they don't match English.
- A translation is a change to the plugin, so raise its version too.

In the source, use the key:

```ts
import locales from "black:locales";
import { translator } from "../../../shared/i18n";
import type en from "../locales/en.json";

const t = translator<keyof typeof en.messages>(locales, this.app.language);
this.app.ui.notify(t("status.backedUp", { time }));
```
