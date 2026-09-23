// "server-only" guards the Next bundle. The static export substitutes a
// browser transport for every module that needed the server, so the marker
// has nothing to guard here.
export {};
