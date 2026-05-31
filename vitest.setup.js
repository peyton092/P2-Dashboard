// Vitest setup — runs before any test file. Sets React 19's act flag so
// component tests using createRoot + act don't print the "not configured
// to support act(...)" warning and so updates flush synchronously inside
// act blocks.

globalThis.IS_REACT_ACT_ENVIRONMENT = true
