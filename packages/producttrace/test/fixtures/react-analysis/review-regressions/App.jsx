import { outsideAction } from '../actions.js';

export function Guarded({ blocked, skip }) {
  function perform() {
    return 'performed';
  }
  function activate() {
    if (skip) return;
    perform();
  }
  if (blocked) return null;
  return <button onClick={activate}>Guarded action</button>;
}

function NullView() {
  return null;
}

export function HiddenChildren() {
  function hiddenAction() {
    return 'not rendered';
  }
  return <NullView><button onClick={hiddenAction}>Hidden child</button></NullView>;
}

export function UnusedJSX() {
  function unusedAction() {
    return 'not returned';
  }
  const unused = <button onClick={unusedAction}>Unused element</button>;
  return null;
}

export function LoopBoundary({ pending }) {
  function loopWork() {
    return 'loop work';
  }
  function run() {
    while (pending) {
      loopWork();
    }
  }
  return <button onClick={run}>Loop action</button>;
}

export function OutsideImport() {
  return <button onClick={outsideAction}>Outside import</button>;
}
