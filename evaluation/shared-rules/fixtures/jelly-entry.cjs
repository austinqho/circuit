const once = require('once');
const { apply } = require('async3');
const { functionalUpdate } = require('table8old');
function target(value) { return { value }; }
const first = once(target);
first('first');
const second = apply(target, 'preset');
second('second');
functionalUpdate(target, 'third');
