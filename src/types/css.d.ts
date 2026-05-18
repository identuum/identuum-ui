// CSS files imported as side effects (e.g. globals.css) need a wildcard
// declaration under TypeScript 6 (TS2882). Next.js handles the bundling;
// this file only satisfies the TypeScript module-resolution check.
declare module "*.css";
