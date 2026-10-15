# Limits (g3-2026-09-23e)

- Headless Chromium only. There was no independent grader.
- The survey covers four surfaces. The Save & Submit button (`EditMessage.tsx`) is not on a surveyed surface. It is exercised in the G1 run, where its element key `p_289ebfafc16d:6176-6450#n1` appears on the edit-resubmit action.
- The `CellMeasurer` function child (`Conversations.tsx:59`) is still a first-party-JSX miss (12 observations). A function child of a library component is not placed.
- One `textarea` per surface is not rendered by React and is not stamped.
- The stamper is unchanged in this pass. D12 is rerun only because the attribution runtime changed.
