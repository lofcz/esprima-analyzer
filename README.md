This is a reduced version of https://github.com/google/diff-match-patch/pull/103 stripped of everything not needed for `blazordmp` protocol. The trimmed version supports only:

```js
1. x = new diff_match_patch() // new dms() for diff_dms.min.js
2. x.patch_make
3. x.patch_toText
```
