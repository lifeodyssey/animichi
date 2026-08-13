/// <reference types="vite/client" />

// Projects define no custom VITE_* variables (#1013 AC1): environment-varying
// PUBLIC config lives in the versioned runtime-config module
// (src/lib/runtime-config) that the ONE built artifact loads at runtime. Only
// Vite's own build-invariant flags (PROD/DEV, supplied by vite/client) remain.
