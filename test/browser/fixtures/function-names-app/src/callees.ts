// Callees whose name has more than one binding in this file (an import, a
// destructured variable, a destructured parameter) next to an unrelated
// same-named function: no callback may take that function's parameter name.
import { withRetry } from './helpers';

const api = { schedule: (task: () => number) => task() };

function useStoreLike() {
  return { update: (patch: () => number) => patch() };
}

export function importedCallee(): number {
  return withRetry(() => 11);
}

function unrelatedRetry() {
  function withRetry(misnamed: () => number) { return misnamed(); }
  return withRetry;
}

const { schedule } = api;
export function destructuredCallee(): number {
  return schedule(() => 12);
}

function unrelatedSchedule() {
  function schedule(wrongParam: () => number) { return wrongParam(); }
  return schedule;
}

export function Editor(): number {
  const { update } = useStoreLike();
  return update(() => 13);
}

export function Preview(): number {
  const update = (other: () => number) => other();
  return update(() => 14) + unrelatedRetry()(() => 0) + unrelatedSchedule()(() => 0);
}

export function List({ setItems }: { setItems: (next: (prev: number) => number) => number }): number {
  return setItems((prev) => prev + 1);
}

export function setItems(nextList: (prev: number) => number): number {
  return nextList(0);
}
