/** Vite `?raw` imports (recorded SSE fixtures). The worker tsconfig doesn't load `vite/client`. */
declare module "*?raw" {
  const text: string;
  export default text;
}
