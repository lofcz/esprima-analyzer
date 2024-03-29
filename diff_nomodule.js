/**
 * Diff Match and Patch
 * Copyright 2018 The diff-match-patch Authors.
 * https://github.com/google/diff-match-patch
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @fileoverview Computes the difference between two texts to create a patch.
 * Applies the patch onto another text, allowing for errors.
 * @author fraser@google.com (Neil Fraser)
 */

/**
 * Class containing the diff, match and patch methods.
 * @constructor
 */
var diff_match_patch = function() {

    // Defaults.
    // Redefine these in your program to override the defaults.
  
    // Number of seconds to map a diff before giving up (0 for infinity).
    this.Diff_Timeout = 1.0;
    // Cost of an empty edit operation in terms of edit characters.
    this.Diff_EditCost = 4;
    // At what point is no match declared (0.0 = perfection, 1.0 = very loose).
    this.Match_Threshold = 0.5;
    // How far to search for a match (0 = exact location, 1000+ = broad match).
    // A match this many characters away from the expected location will add
    // 1.0 to the score (0.0 is a perfect match).
    this.Match_Distance = 1000;
    // When deleting a large block of text (over ~64 characters), how close do
    // the contents have to be to match the expected contents. (0.0 = perfection,
    // 1.0 = very loose).  Note that Match_Threshold controls how closely the
    // end points of a delete need to match.
    this.Patch_DeleteThreshold = 0.5;
    // Chunk size for context length.
    this.Patch_Margin = 4;
  
    // The number of bits in an int.
    this.Match_MaxBits = 32;
  };
  
  
  //  DIFF FUNCTIONS
  
  
  /**
   * The data structure representing a diff is an array of tuples:
   * [[DIFF_DELETE, 'Hello'], [DIFF_INSERT, 'Goodbye'], [DIFF_EQUAL, ' world.']]
   * which means: delete 'Hello', add 'Goodbye' and keep ' world.'
   */
  var DIFF_DELETE = -1;
  var DIFF_INSERT = 1;
  var DIFF_EQUAL = 0;
  
  /**
   * Class representing one diff tuple.
   * Attempts to look like a two-element array (which is what this used to be).
   * @param {number} op Operation, one of: DIFF_DELETE, DIFF_INSERT, DIFF_EQUAL.
   * @param {string} text Text to be deleted, inserted, or retained.
   * @constructor
   */
  diff_match_patch.Diff = function(op, text) {
    this[0] = op;
    this[1] = text;
  };
  
  diff_match_patch.Diff.prototype.length = 2;
  
  /**
   * Emulate the output of a two-element array.
   * @return {string} Diff operation as a string.
   */
  diff_match_patch.Diff.prototype.toString = function() {
    return this[0] + ',' + this[1];
  };
  
  
  /**
   * Find the differences between two texts.  Simplifies the problem by stripping
   * any common prefix or suffix off the texts before diffing.
   * @param {string} text1 Old string to be diffed.
   * @param {string} text2 New string to be diffed.
   * @param {boolean=} opt_checklines Optional speedup flag. If present and false,
   *     then don't run a line-level diff first to identify the changed areas.
   *     Defaults to true, which does a faster, slightly less optimal diff.
   * @param {number=} opt_deadline Optional time when the diff should be complete
   *     by.  Used internally for recursive calls.  Users should set DiffTimeout
   *     instead.
   * @return {!Array.<!diff_match_patch.Diff>} Array of diff tuples.
   */
  diff_match_patch.prototype.diff_main = function(text1, text2, opt_checklines,
      opt_deadline) {
    // Set a deadline by which time the diff must be complete.
    if (typeof opt_deadline == 'undefined') {
      if (this.Diff_Timeout <= 0) {
        opt_deadline = Number.MAX_VALUE;
      } else {
        opt_deadline = (new Date).getTime() + this.Diff_Timeout * 1000;
      }
    }
    var deadline = opt_deadline;
  
    // Check for null inputs.
    if (text1 == null || text2 == null) {
      throw new Error('Null input. (diff_main)');
    }
  
    // Check for equality (speedup).
    if (text1 == text2) {
      if (text1) {
        return [new diff_match_patch.Diff(DIFF_EQUAL, text1)];
      }
      return [];
    }
  
    if (typeof opt_checklines == 'undefined') {
      opt_checklines = true;
    }
    var checklines = opt_checklines;
  
    // Trim off common prefix (speedup).
    var commonlength = this.diff_commonPrefix(text1, text2);
    var commonprefix = text1.substring(0, commonlength);
    text1 = text1.substring(commonlength);
    text2 = text2.substring(commonlength);
  
    // Trim off common suffix (speedup).
    commonlength = this.diff_commonSuffix(text1, text2);
    var commonsuffix = text1.substring(text1.length - commonlength);
    text1 = text1.substring(0, text1.length - commonlength);
    text2 = text2.substring(0, text2.length - commonlength);
  
    // Compute the diff on the middle block.
    var diffs = this.diff_compute_(text1, text2, checklines, deadline);
  
    // Restore the prefix and suffix.
    if (commonprefix) {
      diffs.unshift(new diff_match_patch.Diff(DIFF_EQUAL, commonprefix));
    }
    if (commonsuffix) {
      diffs.push(new diff_match_patch.Diff(DIFF_EQUAL, commonsuffix));
    }
    this.diff_cleanupMerge(diffs);
    return diffs;
  };
  
  
  /**
   * Find the differences between two texts.  Assumes that the texts do not
   * have any common prefix or suffix.
   * @param {string} text1 Old string to be diffed.
   * @param {string} text2 New string to be diffed.
   * @param {boolean} checklines Speedup flag.  If false, then don't run a
   *     line-level diff first to identify the changed areas.
   *     If true, then run a faster, slightly less optimal diff.
   * @param {number} deadline Time when the diff should be complete by.
   * @return {!Array.<!diff_match_patch.Diff>} Array of diff tuples.
   * @private
   */
  diff_match_patch.prototype.diff_compute_ = function(text1, text2, checklines,
      deadline) {
    var diffs;
  
    if (!text1) {
      // Just add some text (speedup).
      return [new diff_match_patch.Diff(DIFF_INSERT, text2)];
    }
  
    if (!text2) {
      // Just delete some text (speedup).
      return [new diff_match_patch.Diff(DIFF_DELETE, text1)];
    }
  
    var longtext = text1.length > text2.length ? text1 : text2;
    var shorttext = text1.length > text2.length ? text2 : text1;
    var i = longtext.indexOf(shorttext);
    if (i != -1) {
      // Shorter text is inside the longer text (speedup).
      diffs = [new diff_match_patch.Diff(DIFF_INSERT, longtext.substring(0, i)),
               new diff_match_patch.Diff(DIFF_EQUAL, shorttext),
               new diff_match_patch.Diff(DIFF_INSERT,
                   longtext.substring(i + shorttext.length))];
      // Swap insertions for deletions if diff is reversed.
      if (text1.length > text2.length) {
        diffs[0][0] = diffs[2][0] = DIFF_DELETE;
      }
      return diffs;
    }
  
    if (shorttext.length == 1) {
      // Single character string.
      // After the previous speedup, the character can't be an equality.
      return [new diff_match_patch.Diff(DIFF_DELETE, text1),
              new diff_match_patch.Diff(DIFF_INSERT, text2)];
    }
  
    // Check to see if the problem can be split in two.
    var hm = this.diff_halfMatch_(text1, text2);
    if (hm) {
      // A half-match was found, sort out the return data.
      var text1_a = hm[0];
      var text1_b = hm[1];
      var text2_a = hm[2];
      var text2_b = hm[3];
      var mid_common = hm[4];
      // Send both pairs off for separate processing.
      var diffs_a = this.diff_main(text1_a, text2_a, checklines, deadline);
      var diffs_b = this.diff_main(text1_b, text2_b, checklines, deadline);
      // Merge the results.
      return diffs_a.concat([new diff_match_patch.Diff(DIFF_EQUAL, mid_common)],
                            diffs_b);
    }
  
    if (checklines && text1.length > 100 && text2.length > 100) {
      return this.diff_lineMode_(text1, text2, deadline);
    }
  
    return this.diff_bisect_(text1, text2, deadline);
  };
  
  /**
   * Find the 'middle snake' of a diff, split the problem in two
   * and return the recursively constructed diff.
   * See Myers 1986 paper: An O(ND) Difference Algorithm and Its Variations.
   * @param {string} text1 Old string to be diffed.
   * @param {string} text2 New string to be diffed.
   * @param {number} deadline Time at which to bail if not yet complete.
   * @return {!Array.<!diff_match_patch.Diff>} Array of diff tuples.
   * @private
   */
  diff_match_patch.prototype.diff_bisect_ = function(text1, text2, deadline) {
    // Cache the text lengths to prevent multiple calls.
    var text1_length = text1.length;
    var text2_length = text2.length;
    var max_d = Math.ceil((text1_length + text2_length) / 2);
    var v_offset = max_d;
    var v_length = 2 * max_d;
    var v1 = new Array(v_length);
    var v2 = new Array(v_length);
    // Setting all elements to -1 is faster in Chrome & Firefox than mixing
    // integers and undefined.
    for (var x = 0; x < v_length; x++) {
      v1[x] = -1;
      v2[x] = -1;
    }
    v1[v_offset + 1] = 0;
    v2[v_offset + 1] = 0;
    var delta = text1_length - text2_length;
    // If the total number of characters is odd, then the front path will collide
    // with the reverse path.
    var front = (delta % 2 != 0);
    // Offsets for start and end of k loop.
    // Prevents mapping of space beyond the grid.
    var k1start = 0;
    var k1end = 0;
    var k2start = 0;
    var k2end = 0;
    for (var d = 0; d < max_d; d++) {
      // Bail out if deadline is reached.
      if ((new Date()).getTime() > deadline) {
        break;
      }
  
      // Walk the front path one step.
      for (var k1 = -d + k1start; k1 <= d - k1end; k1 += 2) {
        var k1_offset = v_offset + k1;
        var x1;
        if (k1 == -d || (k1 != d && v1[k1_offset - 1] < v1[k1_offset + 1])) {
          x1 = v1[k1_offset + 1];
        } else {
          x1 = v1[k1_offset - 1] + 1;
        }
        var y1 = x1 - k1;
        while (x1 < text1_length && y1 < text2_length &&
               text1.charAt(x1) == text2.charAt(y1)) {
          x1++;
          y1++;
        }
        v1[k1_offset] = x1;
        if (x1 > text1_length) {
          // Ran off the right of the graph.
          k1end += 2;
        } else if (y1 > text2_length) {
          // Ran off the bottom of the graph.
          k1start += 2;
        } else if (front) {
          var k2_offset = v_offset + delta - k1;
          if (k2_offset >= 0 && k2_offset < v_length && v2[k2_offset] != -1) {
            // Mirror x2 onto top-left coordinate system.
            var x2 = text1_length - v2[k2_offset];
            if (x1 >= x2) {
              // Overlap detected.
              return this.diff_bisectSplit_(text1, text2, x1, y1, deadline);
            }
          }
        }
      }
  
      // Walk the reverse path one step.
      for (var k2 = -d + k2start; k2 <= d - k2end; k2 += 2) {
        var k2_offset = v_offset + k2;
        var x2;
        if (k2 == -d || (k2 != d && v2[k2_offset - 1] < v2[k2_offset + 1])) {
          x2 = v2[k2_offset + 1];
        } else {
          x2 = v2[k2_offset - 1] + 1;
        }
        var y2 = x2 - k2;
        while (x2 < text1_length && y2 < text2_length &&
               text1.charAt(text1_length - x2 - 1) ==
               text2.charAt(text2_length - y2 - 1)) {
          x2++;
          y2++;
        }
        v2[k2_offset] = x2;
        if (x2 > text1_length) {
          // Ran off the left of the graph.
          k2end += 2;
        } else if (y2 > text2_length) {
          // Ran off the top of the graph.
          k2start += 2;
        } else if (!front) {
          var k1_offset = v_offset + delta - k2;
          if (k1_offset >= 0 && k1_offset < v_length && v1[k1_offset] != -1) {
            var x1 = v1[k1_offset];
            var y1 = v_offset + x1 - k1_offset;
            // Mirror x2 onto top-left coordinate system.
            x2 = text1_length - x2;
            if (x1 >= x2) {
              // Overlap detected.
              return this.diff_bisectSplit_(text1, text2, x1, y1, deadline);
            }
          }
        }
      }
    }
    // Diff took too long and hit the deadline or
    // number of diffs equals number of characters, no commonality at all.
    return [new diff_match_patch.Diff(DIFF_DELETE, text1),
            new diff_match_patch.Diff(DIFF_INSERT, text2)];
  };
  
  
  /**
   * Given the location of the 'middle snake', split the diff in two parts
   * and recurse.
   * @param {string} text1 Old string to be diffed.
   * @param {string} text2 New string to be diffed.
   * @param {number} x Index of split point in text1.
   * @param {number} y Index of split point in text2.
   * @param {number} deadline Time at which to bail if not yet complete.
   * @return {!Array.<!diff_match_patch.Diff>} Array of diff tuples.
   * @private
   */
  diff_match_patch.prototype.diff_bisectSplit_ = function(text1, text2, x, y,
      deadline) {
    var text1a = text1.substring(0, x);
    var text2a = text2.substring(0, y);
    var text1b = text1.substring(x);
    var text2b = text2.substring(y);
  
    // Compute both diffs serially.
    var diffs = this.diff_main(text1a, text2a, false, deadline);
    var diffsb = this.diff_main(text1b, text2b, false, deadline);
  
    return diffs.concat(diffsb);
  };
  
  /**
   * Determine the common prefix of two strings.
   * @param {string} text1 First string.
   * @param {string} text2 Second string.
   * @return {number} The number of characters common to the start of each
   *     string.
   */
  diff_match_patch.prototype.diff_commonPrefix = function(text1, text2) {
    // Quick check for common null cases.
    if (!text1 || !text2 || text1.charAt(0) != text2.charAt(0)) {
      return 0;
    }
    // Binary search.
    // Performance analysis: https://neil.fraser.name/news/2007/10/09/
    var pointermin = 0;
    var pointermax = Math.min(text1.length, text2.length);
    var pointermid = pointermax;
    var pointerstart = 0;
    while (pointermin < pointermid) {
      if (text1.substring(pointerstart, pointermid) ==
          text2.substring(pointerstart, pointermid)) {
        pointermin = pointermid;
        pointerstart = pointermin;
      } else {
        pointermax = pointermid;
      }
      pointermid = Math.floor((pointermax - pointermin) / 2 + pointermin);
    }
    return pointermid;
  };
  
  
  /**
   * Determine the common suffix of two strings.
   * @param {string} text1 First string.
   * @param {string} text2 Second string.
   * @return {number} The number of characters common to the end of each string.
   */
  diff_match_patch.prototype.diff_commonSuffix = function(text1, text2) {
    // Quick check for common null cases.
    if (!text1 || !text2 ||
        text1.charAt(text1.length - 1) != text2.charAt(text2.length - 1)) {
      return 0;
    }
    // Binary search.
    // Performance analysis: https://neil.fraser.name/news/2007/10/09/
    var pointermin = 0;
    var pointermax = Math.min(text1.length, text2.length);
    var pointermid = pointermax;
    var pointerend = 0;
    while (pointermin < pointermid) {
      if (text1.substring(text1.length - pointermid, text1.length - pointerend) ==
          text2.substring(text2.length - pointermid, text2.length - pointerend)) {
        pointermin = pointermid;
        pointerend = pointermin;
      } else {
        pointermax = pointermid;
      }
      pointermid = Math.floor((pointermax - pointermin) / 2 + pointermin);
    }
    return pointermid;
  };
  
  
  /**
   * Determine if the suffix of one string is the prefix of another.
   * @param {string} text1 First string.
   * @param {string} text2 Second string.
   * @return {number} The number of characters common to the end of the first
   *     string and the start of the second string.
   * @private
   */
  diff_match_patch.prototype.diff_commonOverlap_ = function(text1, text2) {
    // Cache the text lengths to prevent multiple calls.
    var text1_length = text1.length;
    var text2_length = text2.length;
    // Eliminate the null case.
    if (text1_length == 0 || text2_length == 0) {
      return 0;
    }
    // Truncate the longer string.
    if (text1_length > text2_length) {
      text1 = text1.substring(text1_length - text2_length);
    } else if (text1_length < text2_length) {
      text2 = text2.substring(0, text1_length);
    }
    var text_length = Math.min(text1_length, text2_length);
    // Quick check for the worst case.
    if (text1 == text2) {
      return text_length;
    }
  
    // Start by looking for a single character match
    // and increase length until no match is found.
    // Performance analysis: https://neil.fraser.name/news/2010/11/04/
    var best = 0;
    var length = 1;
    while (true) {
      var pattern = text1.substring(text_length - length);
      var found = text2.indexOf(pattern);
      if (found == -1) {
        return best;
      }
      length += found;
      if (found == 0 || text1.substring(text_length - length) ==
          text2.substring(0, length)) {
        best = length;
        length++;
      }
    }
  };
  
  
  /**
   * Do the two texts share a substring which is at least half the length of the
   * longer text?
   * This speedup can produce non-minimal diffs.
   * @param {string} text1 First string.
   * @param {string} text2 Second string.
   * @return {Array.<string>} Five element Array, containing the prefix of
   *     text1, the suffix of text1, the prefix of text2, the suffix of
   *     text2 and the common middle.  Or null if there was no match.
   * @private
   */
  diff_match_patch.prototype.diff_halfMatch_ = function(text1, text2) {
    if (this.Diff_Timeout <= 0) {
      // Don't risk returning a non-optimal diff if we have unlimited time.
      return null;
    }
    var longtext = text1.length > text2.length ? text1 : text2;
    var shorttext = text1.length > text2.length ? text2 : text1;
    if (longtext.length < 4 || shorttext.length * 2 < longtext.length) {
      return null;  // Pointless.
    }
    var dmp = this;  // 'this' becomes 'window' in a closure.
  
    /**
     * Does a substring of shorttext exist within longtext such that the substring
     * is at least half the length of longtext?
     * Closure, but does not reference any external variables.
     * @param {string} longtext Longer string.
     * @param {string} shorttext Shorter string.
     * @param {number} i Start index of quarter length substring within longtext.
     * @return {Array.<string>} Five element Array, containing the prefix of
     *     longtext, the suffix of longtext, the prefix of shorttext, the suffix
     *     of shorttext and the common middle.  Or null if there was no match.
     * @private
     */
    function diff_halfMatchI_(longtext, shorttext, i) {
      // Start with a 1/4 length substring at position i as a seed.
      var seed = longtext.substring(i, i + Math.floor(longtext.length / 4));
      var j = -1;
      var best_common = '';
      var best_longtext_a, best_longtext_b, best_shorttext_a, best_shorttext_b;
      while ((j = shorttext.indexOf(seed, j + 1)) != -1) {
        var prefixLength = dmp.diff_commonPrefix(longtext.substring(i),
                                                 shorttext.substring(j));
        var suffixLength = dmp.diff_commonSuffix(longtext.substring(0, i),
                                                 shorttext.substring(0, j));
        if (best_common.length < suffixLength + prefixLength) {
          best_common = shorttext.substring(j - suffixLength, j) +
              shorttext.substring(j, j + prefixLength);
          best_longtext_a = longtext.substring(0, i - suffixLength);
          best_longtext_b = longtext.substring(i + prefixLength);
          best_shorttext_a = shorttext.substring(0, j - suffixLength);
          best_shorttext_b = shorttext.substring(j + prefixLength);
        }
      }
      if (best_common.length * 2 >= longtext.length) {
        return [best_longtext_a, best_longtext_b,
                best_shorttext_a, best_shorttext_b, best_common];
      } else {
        return null;
      }
    }
  
    // First check if the second quarter is the seed for a half-match.
    var hm1 = diff_halfMatchI_(longtext, shorttext,
                               Math.ceil(longtext.length / 4));
    // Check again based on the third quarter.
    var hm2 = diff_halfMatchI_(longtext, shorttext,
                               Math.ceil(longtext.length / 2));
    var hm;
    if (!hm1 && !hm2) {
      return null;
    } else if (!hm2) {
      hm = hm1;
    } else if (!hm1) {
      hm = hm2;
    } else {
      // Both matched.  Select the longest.
      hm = hm1[4].length > hm2[4].length ? hm1 : hm2;
    }
  
    // A half-match was found, sort out the return data.
    var text1_a, text1_b, text2_a, text2_b;
    if (text1.length > text2.length) {
      text1_a = hm[0];
      text1_b = hm[1];
      text2_a = hm[2];
      text2_b = hm[3];
    } else {
      text2_a = hm[0];
      text2_b = hm[1];
      text1_a = hm[2];
      text1_b = hm[3];
    }
    var mid_common = hm[4];
    return [text1_a, text1_b, text2_a, text2_b, mid_common];
  };
  
  
  /**
   * Reduce the number of edits by eliminating semantically trivial equalities.
   * @param {!Array.<!diff_match_patch.Diff>} diffs Array of diff tuples.
   */
  diff_match_patch.prototype.diff_cleanupSemantic = function(diffs) {
    var changes = false;
    var equalities = [];  // Stack of indices where equalities are found.
    var equalitiesLength = 0;  // Keeping our own length var is faster in JS.
    /** @type {?string} */
    var lastEquality = null;
    // Always equal to diffs[equalities[equalitiesLength - 1]][1]
    var pointer = 0;  // Index of current position.
    // Number of characters that changed prior to the equality.
    var length_insertions1 = 0;
    var length_deletions1 = 0;
    // Number of characters that changed after the equality.
    var length_insertions2 = 0;
    var length_deletions2 = 0;
    while (pointer < diffs.length) {
      if (diffs[pointer][0] == DIFF_EQUAL) {  // Equality found.
        equalities[equalitiesLength++] = pointer;
        length_insertions1 = length_insertions2;
        length_deletions1 = length_deletions2;
        length_insertions2 = 0;
        length_deletions2 = 0;
        lastEquality = diffs[pointer][1];
      } else {  // An insertion or deletion.
        if (diffs[pointer][0] == DIFF_INSERT) {
          length_insertions2 += diffs[pointer][1].length;
        } else {
          length_deletions2 += diffs[pointer][1].length;
        }
        // Eliminate an equality that is smaller or equal to the edits on both
        // sides of it.
        if (lastEquality && (lastEquality.length <=
            Math.max(length_insertions1, length_deletions1)) &&
            (lastEquality.length <= Math.max(length_insertions2,
                                             length_deletions2))) {
          // Duplicate record.
          diffs.splice(equalities[equalitiesLength - 1], 0,
                       new diff_match_patch.Diff(DIFF_DELETE, lastEquality));
          // Change second copy to insert.
          diffs[equalities[equalitiesLength - 1] + 1][0] = DIFF_INSERT;
          // Throw away the equality we just deleted.
          equalitiesLength--;
          // Throw away the previous equality (it needs to be reevaluated).
          equalitiesLength--;
          pointer = equalitiesLength > 0 ? equalities[equalitiesLength - 1] : -1;
          length_insertions1 = 0;  // Reset the counters.
          length_deletions1 = 0;
          length_insertions2 = 0;
          length_deletions2 = 0;
          lastEquality = null;
          changes = true;
        }
      }
      pointer++;
    }
  
    // Normalize the diff.
    if (changes) {
      this.diff_cleanupMerge(diffs);
    }
    this.diff_cleanupSemanticLossless(diffs);
  
    // Find any overlaps between deletions and insertions.
    // e.g: <del>abcxxx</del><ins>xxxdef</ins>
    //   -> <del>abc</del>xxx<ins>def</ins>
    // e.g: <del>xxxabc</del><ins>defxxx</ins>
    //   -> <ins>def</ins>xxx<del>abc</del>
    // Only extract an overlap if it is as big as the edit ahead or behind it.
    pointer = 1;
    while (pointer < diffs.length) {
      if (diffs[pointer - 1][0] == DIFF_DELETE &&
          diffs[pointer][0] == DIFF_INSERT) {
        var deletion = diffs[pointer - 1][1];
        var insertion = diffs[pointer][1];
        var overlap_length1 = this.diff_commonOverlap_(deletion, insertion);
        var overlap_length2 = this.diff_commonOverlap_(insertion, deletion);
        if (overlap_length1 >= overlap_length2) {
          if (overlap_length1 >= deletion.length / 2 ||
              overlap_length1 >= insertion.length / 2) {
            // Overlap found.  Insert an equality and trim the surrounding edits.
            diffs.splice(pointer, 0, new diff_match_patch.Diff(DIFF_EQUAL,
                insertion.substring(0, overlap_length1)));
            diffs[pointer - 1][1] =
                deletion.substring(0, deletion.length - overlap_length1);
            diffs[pointer + 1][1] = insertion.substring(overlap_length1);
            pointer++;
          }
        } else {
          if (overlap_length2 >= deletion.length / 2 ||
              overlap_length2 >= insertion.length / 2) {
            // Reverse overlap found.
            // Insert an equality and swap and trim the surrounding edits.
            diffs.splice(pointer, 0, new diff_match_patch.Diff(DIFF_EQUAL,
                deletion.substring(0, overlap_length2)));
            diffs[pointer - 1][0] = DIFF_INSERT;
            diffs[pointer - 1][1] =
                insertion.substring(0, insertion.length - overlap_length2);
            diffs[pointer + 1][0] = DIFF_DELETE;
            diffs[pointer + 1][1] =
                deletion.substring(overlap_length2);
            pointer++;
          }
        }
        pointer++;
      }
      pointer++;
    }
  };
  
  
  /**
   * Look for single edits surrounded on both sides by equalities
   * which can be shifted sideways to align the edit to a word boundary.
   * e.g: The c<ins>at c</ins>ame. -> The <ins>cat </ins>came.
   * @param {!Array.<!diff_match_patch.Diff>} diffs Array of diff tuples.
   */
  diff_match_patch.prototype.diff_cleanupSemanticLossless = function(diffs) {
    /**
     * Given a string and a boundary, compute a score representing whether the
     * boundary falls on logical boundaries.
     * Scores range from 6 (best) to 0 (worst).
     * Closure, but does not reference any external variables.
     * @param {string} buffer String containing the boundary and surrounding text.
     * @param {number} index Index of the boundary.
     * @return {number} The score.
     * @private
     */
    function diff_cleanupSemanticScore_(buffer, index) {
      if (index === 0 || index === buffer.length) {
        // Edges are the best.
        return 6;
      }
  
      // Each port of this function behaves slightly differently due to
      // subtle differences in each language's definition of things like
      // 'whitespace'.  Since this function's purpose is largely cosmetic,
      // the choice has been made to use each language's native features
      // rather than force total conformity.
      var char1 = buffer.charAt(index - 1);
      var char2 = buffer.charAt(index);
      var nonAlphaNumeric1 = char1.match(diff_match_patch.nonAlphaNumericRegex_);
      var nonAlphaNumeric2 = char2.match(diff_match_patch.nonAlphaNumericRegex_);
      var whitespace1 = nonAlphaNumeric1 &&
          char1.match(diff_match_patch.whitespaceRegex_);
      var whitespace2 = nonAlphaNumeric2 &&
          char2.match(diff_match_patch.whitespaceRegex_);
      var lineBreak1 = whitespace1 &&
          char1.match(diff_match_patch.linebreakRegex_);
      var lineBreak2 = whitespace2 &&
          char2.match(diff_match_patch.linebreakRegex_);
      var blankLine1 = lineBreak1 &&
          buffer.substring(index - diff_match_patch.blanklineEndRegexMaxLength_, index)
            .match(diff_match_patch.blanklineEndRegex_);
      var blankLine2 = lineBreak2 &&
          buffer.substring(index, index + diff_match_patch.blanklineStartRegexMaxLength_)
            .match(diff_match_patch.blanklineStartRegex_);
  
      if (blankLine1 || blankLine2) {
        // Five points for blank lines.
        return 5;
      } else if (lineBreak1 || lineBreak2) {
        // Four points for line breaks.
        return 4;
      } else if (nonAlphaNumeric1 && !whitespace1 && whitespace2) {
        // Three points for end of sentences.
        return 3;
      } else if (whitespace1 || whitespace2) {
        // Two points for whitespace.
        return 2;
      } else if (nonAlphaNumeric1 || nonAlphaNumeric2) {
        // One point for non-alphanumeric.
        return 1;
      }
      return 0;
    }
  
    var pointer = 1;
    // Intentionally ignore the first and last element (don't need checking).
    while (pointer < diffs.length - 1) {
      if (diffs[pointer - 1][0] == DIFF_EQUAL &&
          diffs[pointer + 1][0] == DIFF_EQUAL) {
        // This is a single edit surrounded by equalities.
        var equality1 = diffs[pointer - 1][1];
        var edit = diffs[pointer][1];
        var equality2 = diffs[pointer + 1][1];
        var buffer = equality1 + edit + equality2;
  
        // First, shift the edit as far left as possible.
        var offsetLeft = this.diff_commonSuffix(equality1, edit);
        var offsetRight = this.diff_commonPrefix(edit, equality2);
        var originalEditStart = equality1.length;
        var editStart = originalEditStart - offsetLeft;
        var maxEditStart = originalEditStart + offsetRight;
        var editEnd = editStart + edit.length;
  
        // Second, step character by character right, looking for the best fit.
        var bestEditStart = editStart;
        var bestEditEnd = editEnd;
        var bestScore = diff_cleanupSemanticScore_(buffer, editStart) +
            diff_cleanupSemanticScore_(buffer, editEnd);
        while (editStart < maxEditStart) {
          editStart += 1;
          editEnd += 1;
          var score = diff_cleanupSemanticScore_(buffer, editStart) +
            diff_cleanupSemanticScore_(buffer, editEnd);
          // The >= encourages trailing rather than leading whitespace on edits.
          if (score >= bestScore) {
            bestScore = score;
            bestEditStart = editStart;
            bestEditEnd = editEnd;
          }
        }
  
        if (bestEditStart != originalEditStart) {
          // We have an improvement, save it back to the diff.
          if (bestEditStart > 0) {
            diffs[pointer - 1][1] = buffer.substring(0, bestEditStart);
          } else {
            diffs.splice(pointer - 1, 1);
            pointer--;
          }
          diffs[pointer][1] = buffer.substring(bestEditStart, bestEditEnd);
          if (bestEditEnd < buffer.length) {
            diffs[pointer + 1][1] = buffer.substring(bestEditEnd);
          } else {
            diffs.splice(pointer + 1, 1);
            pointer--;
          }
        }
      }
      pointer++;
    }
  };
  
  // Define some regex patterns for matching boundaries.
  diff_match_patch.nonAlphaNumericRegex_ = /[^a-zA-Z0-9]/;
  diff_match_patch.whitespaceRegex_ = /\s/;
  diff_match_patch.linebreakRegex_ = /[\r\n]/;
  diff_match_patch.blanklineEndRegex_ = /\n\r?\n$/;
  diff_match_patch.blanklineStartRegex_ = /^\r?\n\r?\n/;
  
  // Maximum length of a match for blank line regexes
  diff_match_patch.blanklineEndRegexMaxLength_ = 3;
  diff_match_patch.blanklineStartRegexMaxLength_ = 4;
  
  /**
   * Reduce the number of edits by eliminating operationally trivial equalities.
   * @param {!Array.<!diff_match_patch.Diff>} diffs Array of diff tuples.
   */
  diff_match_patch.prototype.diff_cleanupEfficiency = function(diffs) {
    var changes = false;
    var equalities = [];  // Stack of indices where equalities are found.
    var equalitiesLength = 0;  // Keeping our own length var is faster in JS.
    /** @type {?string} */
    var lastEquality = null;
    // Always equal to diffs[equalities[equalitiesLength - 1]][1]
    var pointer = 0;  // Index of current position.
    // Is there an insertion operation before the last equality.
    var pre_ins = false;
    // Is there a deletion operation before the last equality.
    var pre_del = false;
    // Is there an insertion operation after the last equality.
    var post_ins = false;
    // Is there a deletion operation after the last equality.
    var post_del = false;
    while (pointer < diffs.length) {
      if (diffs[pointer][0] == DIFF_EQUAL) {  // Equality found.
        if (diffs[pointer][1].length < this.Diff_EditCost &&
            (post_ins || post_del)) {
          // Candidate found.
          equalities[equalitiesLength++] = pointer;
          pre_ins = post_ins;
          pre_del = post_del;
          lastEquality = diffs[pointer][1];
        } else {
          // Not a candidate, and can never become one.
          equalitiesLength = 0;
          lastEquality = null;
        }
        post_ins = post_del = false;
      } else {  // An insertion or deletion.
        if (diffs[pointer][0] == DIFF_DELETE) {
          post_del = true;
        } else {
          post_ins = true;
        }
        /*
         * Five types to be split:
         * <ins>A</ins><del>B</del>XY<ins>C</ins><del>D</del>
         * <ins>A</ins>X<ins>C</ins><del>D</del>
         * <ins>A</ins><del>B</del>X<ins>C</ins>
         * <ins>A</del>X<ins>C</ins><del>D</del>
         * <ins>A</ins><del>B</del>X<del>C</del>
         */
        if (lastEquality && ((pre_ins && pre_del && post_ins && post_del) ||
                             ((lastEquality.length < this.Diff_EditCost / 2) &&
                              (pre_ins + pre_del + post_ins + post_del) == 3))) {
          // Duplicate record.
          diffs.splice(equalities[equalitiesLength - 1], 0,
                       new diff_match_patch.Diff(DIFF_DELETE, lastEquality));
          // Change second copy to insert.
          diffs[equalities[equalitiesLength - 1] + 1][0] = DIFF_INSERT;
          equalitiesLength--;  // Throw away the equality we just deleted;
          lastEquality = null;
          if (pre_ins && pre_del) {
            // No changes made which could affect previous entry, keep going.
            post_ins = post_del = true;
            equalitiesLength = 0;
          } else {
            equalitiesLength--;  // Throw away the previous equality.
            pointer = equalitiesLength > 0 ?
                equalities[equalitiesLength - 1] : -1;
            post_ins = post_del = false;
          }
          changes = true;
        }
      }
      pointer++;
    }
  
    if (changes) {
      this.diff_cleanupMerge(diffs);
    }
  };
  
  /**
   * Reorder and merge like edit sections.  Merge equalities.
   * Any edit section can move as long as it doesn't cross an equality.
   * @param {!Array.<!diff_match_patch.Diff>} diffs Array of diff tuples.
   */
  diff_match_patch.prototype.diff_cleanupMerge = function(diffs) {
    // Add a dummy entry at the end.
    diffs.push(new diff_match_patch.Diff(DIFF_EQUAL, ''));
    var pointer = 0;
    var count_delete = 0;
    var count_insert = 0;
    var text_delete = '';
    var text_insert = '';
    var commonlength;
    while (pointer < diffs.length) {
      switch (diffs[pointer][0]) {
        case DIFF_INSERT:
          count_insert++;
          text_insert += diffs[pointer][1];
          pointer++;
          break;
        case DIFF_DELETE:
          count_delete++;
          text_delete += diffs[pointer][1];
          pointer++;
          break;
        case DIFF_EQUAL:
          // Upon reaching an equality, check for prior redundancies.
          if (count_delete + count_insert > 1) {
            if (count_delete !== 0 && count_insert !== 0) {
              // Factor out any common prefixies.
              commonlength = this.diff_commonPrefix(text_insert, text_delete);
              if (commonlength !== 0) {
                if ((pointer - count_delete - count_insert) > 0 &&
                    diffs[pointer - count_delete - count_insert - 1][0] ==
                    DIFF_EQUAL) {
                  diffs[pointer - count_delete - count_insert - 1][1] +=
                      text_insert.substring(0, commonlength);
                } else {
                  diffs.splice(0, 0, new diff_match_patch.Diff(DIFF_EQUAL,
                      text_insert.substring(0, commonlength)));
                  pointer++;
                }
                text_insert = text_insert.substring(commonlength);
                text_delete = text_delete.substring(commonlength);
              }
              // Factor out any common suffixies.
              commonlength = this.diff_commonSuffix(text_insert, text_delete);
              if (commonlength !== 0) {
                diffs[pointer][1] = text_insert.substring(text_insert.length -
                    commonlength) + diffs[pointer][1];
                text_insert = text_insert.substring(0, text_insert.length -
                    commonlength);
                text_delete = text_delete.substring(0, text_delete.length -
                    commonlength);
              }
            }
            // Delete the offending records and add the merged ones.
            pointer -= count_delete + count_insert;
            diffs.splice(pointer, count_delete + count_insert);
            if (text_delete.length) {
              diffs.splice(pointer, 0,
                  new diff_match_patch.Diff(DIFF_DELETE, text_delete));
              pointer++;
            }
            if (text_insert.length) {
              diffs.splice(pointer, 0,
                  new diff_match_patch.Diff(DIFF_INSERT, text_insert));
              pointer++;
            }
            pointer++;
          } else if (pointer !== 0 && diffs[pointer - 1][0] == DIFF_EQUAL) {
            // Merge this equality with the previous one.
            diffs[pointer - 1][1] += diffs[pointer][1];
            diffs.splice(pointer, 1);
          } else {
            pointer++;
          }
          count_insert = 0;
          count_delete = 0;
          text_delete = '';
          text_insert = '';
          break;
      }
    }
    if (diffs[diffs.length - 1][1] === '') {
      diffs.pop();  // Remove the dummy entry at the end.
    }
  
    // Second pass: look for single edits surrounded on both sides by equalities
    // which can be shifted sideways to eliminate an equality.
    // e.g: A<ins>BA</ins>C -> <ins>AB</ins>AC
    var changes = false;
    pointer = 1;
    // Intentionally ignore the first and last element (don't need checking).
    while (pointer < diffs.length - 1) {
      if (diffs[pointer - 1][0] == DIFF_EQUAL &&
          diffs[pointer + 1][0] == DIFF_EQUAL) {
        // This is a single edit surrounded by equalities.
        if (diffs[pointer][1].substring(diffs[pointer][1].length -
            diffs[pointer - 1][1].length) == diffs[pointer - 1][1]) {
          // Shift the edit over the previous equality.
          diffs[pointer][1] = diffs[pointer - 1][1] +
              diffs[pointer][1].substring(0, diffs[pointer][1].length -
                                          diffs[pointer - 1][1].length);
          diffs[pointer + 1][1] = diffs[pointer - 1][1] + diffs[pointer + 1][1];
          diffs.splice(pointer - 1, 1);
          changes = true;
        } else if (diffs[pointer][1].substring(0, diffs[pointer + 1][1].length) ==
            diffs[pointer + 1][1]) {
          // Shift the edit over the next equality.
          diffs[pointer - 1][1] += diffs[pointer + 1][1];
          diffs[pointer][1] =
              diffs[pointer][1].substring(diffs[pointer + 1][1].length) +
              diffs[pointer + 1][1];
          diffs.splice(pointer + 1, 1);
          changes = true;
        }
      }
      pointer++;
    }
    // If shifts were made, the diff needs reordering and another shift sweep.
    if (changes) {
      this.diff_cleanupMerge(diffs);
    }
  }; 
  
  /**
   * Compute and return the source text (all equalities and deletions).
   * @param {!Array.<!diff_match_patch.Diff>} diffs Array of diff tuples.
   * @return {string} Source text.
   */
  diff_match_patch.prototype.diff_text1 = function(diffs) {
    var text = [];
    for (var x = 0; x < diffs.length; x++) {
      if (diffs[x][0] !== DIFF_INSERT) {
        text[x] = diffs[x][1];
      }
    }
    return text.join('');
  };
  
  
  /**
   * Compute and return the destination text (all equalities and insertions).
   * @param {!Array.<!diff_match_patch.Diff>} diffs Array of diff tuples.
   * @return {string} Destination text.
   */
  diff_match_patch.prototype.diff_text2 = function(diffs) {
    var text = [];
    for (var x = 0; x < diffs.length; x++) {
      if (diffs[x][0] !== DIFF_DELETE) {
        text[x] = diffs[x][1];
      }
    }
    return text.join('');
  };

  //  PATCH FUNCTIONS
  
  /**
   * Increase the context until it is unique,
   * but don't let the pattern expand beyond Match_MaxBits.
   * @param {!diff_match_patch.patch_obj} patch The patch to grow.
   * @param {string} text Source text.
   * @private
   */
  diff_match_patch.prototype.patch_addContext_ = function(patch, text) {
    if (text.length == 0) {
      return;
    }
    if (patch.start2 === null) {
      throw Error('patch not initialized');
    }
    var pattern = text.substring(patch.start2, patch.start2 + patch.length1);
    var padding = 0;
  
    // Look for the first and last matches of pattern in text.  If two different
    // matches are found, increase the pattern length.
    while (text.indexOf(pattern) != text.lastIndexOf(pattern) &&
           pattern.length < this.Match_MaxBits - this.Patch_Margin -
           this.Patch_Margin) {
      padding += this.Patch_Margin;
      pattern = text.substring(patch.start2 - padding,
                               patch.start2 + patch.length1 + padding);
    }
    // Add one chunk for good luck.
    padding += this.Patch_Margin;
  
    // Add the prefix.
    var prefix = text.substring(patch.start2 - padding, patch.start2);
    if (prefix) {
      patch.diffs.unshift(new diff_match_patch.Diff(DIFF_EQUAL, prefix));
    }
    // Add the suffix.
    var suffix = text.substring(patch.start2 + patch.length1,
                                patch.start2 + patch.length1 + padding);
    if (suffix) {
      patch.diffs.push(new diff_match_patch.Diff(DIFF_EQUAL, suffix));
    }
  
    // Roll back the start points.
    patch.start1 -= prefix.length;
    patch.start2 -= prefix.length;
    // Extend the lengths.
    patch.length1 += prefix.length + suffix.length;
    patch.length2 += prefix.length + suffix.length;
  };
  
  
  /**
   * Compute a list of patches to turn text1 into text2.
   * Use diffs if provided, otherwise compute it ourselves.
   * There are four ways to call this function, depending on what data is
   * available to the caller:
   * Method 1:
   * a = text1, b = text2
   * Method 2:
   * a = diffs
   * Method 3 (optimal):
   * a = text1, b = diffs
   * Method 4 (deprecated, use method 3):
   * a = text1, b = text2, c = diffs
   *
   * @param {string|!Array.<!diff_match_patch.Diff>} a text1 (methods 1,3,4) or
   * Array of diff tuples for text1 to text2 (method 2).
   * @param {string|!Array.<!diff_match_patch.Diff>=} opt_b text2 (methods 1,4) or
   * Array of diff tuples for text1 to text2 (method 3) or undefined (method 2).
   * @param {string|!Array.<!diff_match_patch.Diff>=} opt_c Array of diff tuples
   * for text1 to text2 (method 4) or undefined (methods 1,2,3).
   * @return {!Array.<!diff_match_patch.patch_obj>} Array of Patch objects.
   */
  diff_match_patch.prototype.patch_make = function(a, opt_b, opt_c) {
    var text1, diffs;
    if (typeof a == 'string' && typeof opt_b == 'string' &&
        typeof opt_c == 'undefined') {
      // Method 1: text1, text2
      // Compute diffs from text1 and text2.
      text1 = /** @type {string} */(a);
      diffs = this.diff_main(text1, /** @type {string} */(opt_b), true);
      if (diffs.length > 2) {
        this.diff_cleanupSemantic(diffs);
        this.diff_cleanupEfficiency(diffs);
      }
    } else if (a && typeof a == 'object' && typeof opt_b == 'undefined' &&
        typeof opt_c == 'undefined') {
      // Method 2: diffs
      // Compute text1 from diffs.
      diffs = /** @type {!Array.<!diff_match_patch.Diff>} */(a);
      text1 = this.diff_text1(diffs);
    } else if (typeof a == 'string' && opt_b && typeof opt_b == 'object' &&
        typeof opt_c == 'undefined') {
      // Method 3: text1, diffs
      text1 = /** @type {string} */(a);
      diffs = /** @type {!Array.<!diff_match_patch.Diff>} */(opt_b);
    } else if (typeof a == 'string' && typeof opt_b == 'string' &&
        opt_c && typeof opt_c == 'object') {
      // Method 4: text1, text2, diffs
      // text2 is not used.
      text1 = /** @type {string} */(a);
      diffs = /** @type {!Array.<!diff_match_patch.Diff>} */(opt_c);
    } else {
      throw new Error('Unknown call format to patch_make.');
    }
  
    if (diffs.length === 0) {
      return [];  // Get rid of the null case.
    }
    var patches = [];
    var patch = new diff_match_patch.patch_obj();
    var patchDiffLength = 0;  // Keeping our own length var is faster in JS.
    var char_count1 = 0;  // Number of characters into the text1 string.
    var char_count2 = 0;  // Number of characters into the text2 string.
    // Start with text1 (prepatch_text) and apply the diffs until we arrive at
    // text2 (postpatch_text).  We recreate the patches one by one to determine
    // context info.
    var prepatch_text = text1;
    var postpatch_text = text1;
    for (var x = 0; x < diffs.length; x++) {
      var diff_type = diffs[x][0];
      var diff_text = diffs[x][1];
  
      if (!patchDiffLength && diff_type !== DIFF_EQUAL) {
        // A new patch starts here.
        patch.start1 = char_count1;
        patch.start2 = char_count2;
      }
  
      switch (diff_type) {
        case DIFF_INSERT:
          patch.diffs[patchDiffLength++] = diffs[x];
          patch.length2 += diff_text.length;
          postpatch_text = postpatch_text.substring(0, char_count2) + diff_text +
                           postpatch_text.substring(char_count2);
          break;
        case DIFF_DELETE:
          patch.length1 += diff_text.length;
          patch.diffs[patchDiffLength++] = diffs[x];
          postpatch_text = postpatch_text.substring(0, char_count2) +
                           postpatch_text.substring(char_count2 +
                               diff_text.length);
          break;
        case DIFF_EQUAL:
          if (diff_text.length <= 2 * this.Patch_Margin &&
              patchDiffLength && diffs.length != x + 1) {
            // Small equality inside a patch.
            patch.diffs[patchDiffLength++] = diffs[x];
            patch.length1 += diff_text.length;
            patch.length2 += diff_text.length;
          } else if (diff_text.length >= 2 * this.Patch_Margin) {
            // Time for a new patch.
            if (patchDiffLength) {
              this.patch_addContext_(patch, prepatch_text);
              patches.push(patch);
              patch = new diff_match_patch.patch_obj();
              patchDiffLength = 0;
              // Unlike Unidiff, our patch lists have a rolling context.
              // https://github.com/google/diff-match-patch/wiki/Unidiff
              // Update prepatch text & pos to reflect the application of the
              // just completed patch.
              prepatch_text = postpatch_text;
              char_count1 = char_count2;
            }
          }
          break;
      }
  
      // Update the current character count.
      if (diff_type !== DIFF_INSERT) {
        char_count1 += diff_text.length;
      }
      if (diff_type !== DIFF_DELETE) {
        char_count2 += diff_text.length;
      }
    }
    // Pick up the leftover patch if not empty.
    if (patchDiffLength) {
      this.patch_addContext_(patch, prepatch_text);
      patches.push(patch);
    }
  
    return patches;
  };
  
  /**
   * Take a list of patches and return a textual representation.
   * @param {!Array.<!diff_match_patch.patch_obj>} patches Array of Patch objects.
   * @return {string} Text representation of patches.
   */
  diff_match_patch.prototype.patch_toText = function(patches) {
    var text = [];
    for (var x = 0; x < patches.length; x++) {
      text[x] = patches[x];
    }
    return text.join('');
  };
  
  /**
   * Class representing one patch operation.
   * @constructor
   */
  diff_match_patch.patch_obj = function() {
    /** @type {!Array.<!diff_match_patch.Diff>} */
    this.diffs = [];
    /** @type {?number} */
    this.start1 = null;
    /** @type {?number} */
    this.start2 = null;
    /** @type {number} */
    this.length1 = 0;
    /** @type {number} */
    this.length2 = 0;
  };
  
  
  /**
   * Emulate GNU diff's format.
   * Header: @@ -382,8 +481,9 @@
   * Indices are printed as 1-based, not 0-based.
   * @return {string} The GNU diff string.
   */
  diff_match_patch.patch_obj.prototype.toString = function() {
    var coords1, coords2;
    if (this.length1 === 0) {
      coords1 = this.start1 + ',0';
    } else if (this.length1 == 1) {
      coords1 = this.start1 + 1;
    } else {
      coords1 = (this.start1 + 1) + ',' + this.length1;
    }
    if (this.length2 === 0) {
      coords2 = this.start2 + ',0';
    } else if (this.length2 == 1) {
      coords2 = this.start2 + 1;
    } else {
      coords2 = (this.start2 + 1) + ',' + this.length2;
    }
    var text = ['@@ -' + coords1 + ' +' + coords2 + ' @@\n'];
    var op;
    // Escape the body of the patch with %xx notation.
    for (var x = 0; x < this.diffs.length; x++) {
      switch (this.diffs[x][0]) {
        case DIFF_INSERT:
          op = '+';
          break;
        case DIFF_DELETE:
          op = '-';
          break;
        case DIFF_EQUAL:
          op = ' ';
          break;
      }
      text[x + 1] = op + encodeURI(this.diffs[x][1]) + '\n';
    }
    return text.join('').replace(/%20/g, ' ');
  };