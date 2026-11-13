/** The messages from each file in the plugin's locales/ folder, by language code. The build creates this (scripts/lib.mjs). */
declare module "black:locales" {
  const locales: Record<string, Record<string, string>>;
  export default locales;
}
