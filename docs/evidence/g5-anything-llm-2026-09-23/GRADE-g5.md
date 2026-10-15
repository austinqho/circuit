# G5 grade (recomputed from the raw store)

Evidence: `docs/evidence/g5-anything-llm-2026-09-23`; store: `docs/evidence/g5-anything-llm-2026-09-23/store`; source root: `/Users/austinho/dev/fixtures/anything-llm`.
Rows: 3262 records, 465 spans, 1 manifest(s). Element key: `p_f067e70e6029:117-485#n1`.

| check | result | detail |
|---|---|---|
| 1 key: DOM stamp of the annotated element = the key sent to the MCP = the key it answered | PASS | {"dom":"p_f067e70e6029:117-485#n1","sent":"p_f067e70e6029:117-485#n1","answered":"p_f067e70e6029:117-485#n1"} |
| 1 key: stamped for exactly one placement in the store | PASS | {"stamp_rows":1,"placements":["placement:f067e70e602936c4f8e9c326a164ca171480ddde3f990590f3c0db1b03c5e60b:117:485"]} |
| 2 source: fixture file hash equals the placement id hash | PASS | {"file":"frontend/src/components/lib/CTAButton/index.jsx"} |
| 2 source: text at the stamp start is <tag and its line is the stamp line | PASS | {"file":"frontend/src/components/lib/CTAButton/index.jsx","start":117,"tag":"button","line_recomputed":8,"line_recorded":8,"text":"<button\n      disabled={"} |
| 2 resolve_element: exact, component and file:line equal the recomputed ones | PASS | {"mcp":{"component":"CTAButton","source":{"file":"frontend/src/components/lib/CTAButton/index.jsx","start":117,"end":485,"line":8,"line_status":"ok"},"confidence":"exact"},"grader":{"component":"CTAButton","file":"frontend/src/components/lib/CTAButton/index.jsx","line":8}} |
| 3 actions: element_history lists the element's dom.action rows (target.element_key equality), newest first | PASS | {"grader":9,"mcp":9} |
| 4 attempts: grouped as the grader groups them (each submit closes one), newest first | PASS | {"grader":[["action:muebdejl:146",["focusin","click","submit"]],["action:muebdcw1:108",["focusin","click","submit"]],["action:muebdb7w:68",["focusin","click","submit"]]],"mcp":[["action:muebdejl:146",["submit","click","focusin"]],["action:muebdcw1:108",["submit","click","focusin"]],["action:muebdb7w:68",["submit","click","focusin"]]]} |
| 5 attempt 1 (action:muebdejl:146): request | PASS | {"mcp":"POST /api/workspace/tracer-g5/update","grader":"POST /api/workspace/tracer-g5/update"} |
| 6 attempt 1: route and status from the exact server span; handler spans; no DB span | PASS | {"mcp":["/api/workspace/:slug/update",200],"grader":["/api/workspace/:slug/update",200,["validatedRequest","<anonymous>","<anonymous>"],"db=0"]} |
| 7 attempt 1: entry handler = first depth-zero function of the submit; developer-named onSubmit handler | PASS | {"mcp":{"file":"frontend/src/pages/WorkspaceSettings/GeneralAppearance/index.jsx","start":931,"end":1488,"line":26,"line_status":"ok"},"grader":{"file":"frontend/src/pages/WorkspaceSettings/GeneralAppearance/index.jsx","line":26,"name":"handleUpdate","bound_on_submit":true}} |
| 8 attempt 1: frontier | PASS | {"mcp":["handler","handler","no database span descends from the admitted handler span"],"grader":["handler",200]} |
| 5 attempt 2 (action:muebdcw1:108): request | PASS | {"mcp":"POST /api/workspace/tracer-g5/update","grader":"POST /api/workspace/tracer-g5/update"} |
| 6 attempt 2: route and status from the exact server span; handler spans; no DB span | PASS | {"mcp":["/api/workspace/:slug/update",422],"grader":["/api/workspace/:slug/update",422,["validatedRequest","<anonymous>","<anonymous>"],"db=0"]} |
| 7 attempt 2: entry handler = first depth-zero function of the submit; developer-named onSubmit handler | PASS | {"mcp":{"file":"frontend/src/pages/WorkspaceSettings/GeneralAppearance/index.jsx","start":931,"end":1488,"line":26,"line_status":"ok"},"grader":{"file":"frontend/src/pages/WorkspaceSettings/GeneralAppearance/index.jsx","line":26,"name":"handleUpdate","bound_on_submit":true}} |
| 8 attempt 2: frontier | PASS | {"mcp":["handler","handler","server responded 422; no database span descends from the admitted handler span"],"grader":["handler",422]} |
| 5 attempt 3 (action:muebdb7w:68): request | PASS | {"mcp":"POST /api/workspace/tracer-g5/update","grader":"POST /api/workspace/tracer-g5/update"} |
| 6 attempt 3: route and status from the exact server span; handler spans; no DB span | PASS | {"mcp":["/api/workspace/:slug/update",200],"grader":["/api/workspace/:slug/update",200,["validatedRequest","<anonymous>","<anonymous>"],"db=0"]} |
| 7 attempt 3: entry handler = first depth-zero function of the submit; developer-named onSubmit handler | PASS | {"mcp":{"file":"frontend/src/pages/WorkspaceSettings/GeneralAppearance/index.jsx","start":931,"end":1488,"line":26,"line_status":"ok"},"grader":{"file":"frontend/src/pages/WorkspaceSettings/GeneralAppearance/index.jsx","line":26,"name":"handleUpdate","bound_on_submit":true}} |
| 8 attempt 3: frontier | PASS | {"mcp":["handler","handler","no database span descends from the admitted handler span"],"grader":["handler",200]} |
| 4 attempts: statuses newest first are 200, 422, 200 | PASS | [200,422,200] |
| 9 action_chain: asked for the grader's failing submit; route status and because name it | PASS | {"asked":"action:muebdcw1:108","grader":"action:muebdcw1:108","route":422,"because":"server responded 422; no database span descends from the admitted handler span"} |
| 10 fallback without a key: ambiguous, candidates include the key | PASS | {"status":"ambiguous","candidates":3,"includes":true} |

Overall: PASS (22/22).

Independence caveat: written by the implementing agent; shares no code with analysis/, collector/ or mcp/. A separate agent should rerun it.
