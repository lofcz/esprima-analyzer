import esprima from 'esprima-next';
import fs from 'node:fs'
import { dmp } from './diff.js';

var x = dmp();

function wrapObjectFunctions(obj, before, after) {
    var key, value;
  
    for (key in obj) {
      value = obj[key];
      if (typeof value === "function") {
        wrapFunction(obj, key, value);
      }
    }
  
    function wrapFunction(obj, fname, f) {
      obj[fname] = function() {
        var rv;
        if (before) {
          before(fname, this, arguments);
        }
        rv = f.apply(this, arguments);
        if (after) {
          after(fname, this, arguments, rv);
        }
        return rv;
      };
    }
  }

wrapObjectFunctions(x, (a, b, c) => {
    console.log("hit fn " + a);
}, () => {});

var text2 = "";

for (var i =0; i < 100000; i++) {
    text2 += "abcd" + i;
}

var patch = x.patch_make("ahoj", text2)

console.log("---------------")

var text = x.patch_toText(patch);

let z = 0;