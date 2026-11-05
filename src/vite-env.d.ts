/// <reference types="vite/client" />

declare module "virtual:xdesign-script-worker" { const source: string; export default source; }
declare module "virtual:xdesign-native-react-worker" { const bundle: { source: string; notices: { name: string; source: string }[] }; export default bundle; }

interface ImportMetaEnv {
  /** "archives" in the standalone Archives 47 build; unset in Orion Terminal. */
  readonly VITE_APP_TARGET?: string;
}
