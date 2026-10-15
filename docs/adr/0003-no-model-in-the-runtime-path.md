# 3. No model in the runtime path

Date: 2026-08. Status: accepted.

Decision: capture, joining and rendering of sentences are deterministic code. No LLM runs while recording or when building an action chain or session story, and the package contains no app-specific rules.

Why: results must be reproducible and gradable against raw rows, and the package must work unchanged on apps we have never seen. Models may read producttrace's output (agents over MCP), not produce it.
