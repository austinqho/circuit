# 2. Identifiers attach; timestamps only order

Date: 2026-07 (NAP era), restated 2026-09. Status: accepted.

Joining two events because they happened close together produces confident wrong answers: background polling hits the same URL, one click sends several requests, a timer fires during another action.

Decision: evidence joins only through an identifier carried from one side to the other (build stamps, action context across async work, W3C `traceparent`, recorded entity IDs). Time is used to order evidence, never to join it. When no identifier links two things, the result says so (a frontier or an unlinked row) instead of guessing.
