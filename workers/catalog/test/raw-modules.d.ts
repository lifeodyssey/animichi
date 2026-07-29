// Vite's `?raw` import suffix inlines a file's contents as a string at
// transform time. `vite/client` declares this, but adding it to tsconfig's
// `types` pulls in the whole DOM-flavoured client surface alongside
// `@cloudflare/workers-types`, which is the wrong ambient environment for a
// Worker package. Declaring just the one form keeps the type surface honest.
declare module "*?raw" {
  const content: string;
  export default content;
}
