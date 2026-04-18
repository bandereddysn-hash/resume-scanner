/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Optional absolute origin for Netlify functions during local dev, e.g. http://127.0.0.1:8888
   * when Vite runs on another port. Leave unset on Netlify (same-origin).
   */
  readonly VITE_FUNCTIONS_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
