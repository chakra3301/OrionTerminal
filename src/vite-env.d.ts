/// <reference types="vite/client" />

declare module "virtual:xdesign-script-worker" { const source: string; export default source; }
declare module "virtual:xdesign-native-react-worker" { const bundle: { source: string; notices: { name: string; source: string }[] }; export default bundle; }
