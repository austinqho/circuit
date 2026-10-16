# 4. Read-only install

Status: accepted.

Decision: installing producttrace changes at most one or two lines in one config file (the Vite plugin, a `node --import` flag). It never edits the app's source. Build gates refuse to serve if the instrumented build behaves differently from the plain one.

Why: the promise is "install into any open-source React app". Anything that needs per-app edits breaks that promise.
