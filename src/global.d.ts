// Copyright 2026 adezdev. Apache-2.0 License. See LICENSE.

// Bun has a built-in text loader (same as its stock *.txt declaration in
// bun-types), but doesn't predeclare it for *.md. Used by tools/docs.ts to
// embed mini's own documentation into the binary at build time, so `docs`
// lookups work the same from source, `bun link`, or the compiled dist/mini
// binary — no filesystem read relative to an install path required.
declare module "*.md" {
  var text: string;
  export = text;
}
