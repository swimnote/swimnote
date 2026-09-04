/**
 * curriculum-chat loadHistory finally-guard logic unit tests.
 *
 * Tests for the fix to the WP-D regression where setHistoryLoading(false) was
 * never called when the server returned a conversation_id for a null-id request,
 * because activeConversationIdRef.current was updated inside try before finally
 * ran, causing the guard to always return false.
 *
 * The guard logic under test (extracted verbatim from curriculum-chat.tsx):
 *
 *   const isCurrentRequest =
 *     activeStudentIdRef.current === requestedStudentId &&
 *     (
 *       activeConversationIdRef.current === requestedConversationId ||
 *       (
 *         requestedConversationId === null &&
 *         resolvedConversationId  !== null &&
 *         activeConversationIdRef.current === resolvedConversationId
 *       )
 *     );
 */

/** Pure mirror of the guard logic in loadHistory's finally block */
function isCurrentRequest(opts: {
  activeStudentId:      string;
  activeConversationId: string | null;
  requestedStudentId:   string;
  requestedConversationId: string | null;
  resolvedConversationId:  string | null;
}): boolean {
  const {
    activeStudentId,
    activeConversationId,
    requestedStudentId,
    requestedConversationId,
    resolvedConversationId,
  } = opts;

  return (
    activeStudentId === requestedStudentId &&
    (
      activeConversationId === requestedConversationId ||
      (
        requestedConversationId === null &&
        resolvedConversationId  !== null &&
        activeConversationId    === resolvedConversationId
      )
    )
  );
}

const STUDENT_A = "student_A";
const STUDENT_B = "student_B";
const CV_1      = "cv_1";
const CV_2      = "cv_2";

describe("curriculum-chat loadHistory finally guard", () => {
  // Case 1: null → server conversation_id (the original bug)
  it("case 1: requestedConversationId=null, server returned cv_1 → isCurrentRequest=true", () => {
    // After try block: activeConversationIdRef.current = "cv_1", resolvedConversationId = "cv_1"
    expect(isCurrentRequest({
      activeStudentId:         STUDENT_A,
      activeConversationId:    CV_1,        // ref mutated by try
      requestedStudentId:      STUDENT_A,
      requestedConversationId: null,
      resolvedConversationId:  CV_1,        // updated locally before ref mutation
    })).toBe(true);
  });

  // Case 2: explicit conversationId, unchanged
  it("case 2: requestedConversationId=cv_1, response matched → isCurrentRequest=true", () => {
    expect(isCurrentRequest({
      activeStudentId:         STUDENT_A,
      activeConversationId:    CV_1,
      requestedStudentId:      STUDENT_A,
      requestedConversationId: CV_1,
      resolvedConversationId:  CV_1,
    })).toBe(true);
  });

  // Case 3: user switched to cv_2 while cv_1 request was in-flight
  it("case 3: in-flight cv_1 response arrives after user switched to cv_2 → false (stale)", () => {
    expect(isCurrentRequest({
      activeStudentId:         STUDENT_A,
      activeConversationId:    CV_2,        // user switched during await
      requestedStudentId:      STUDENT_A,
      requestedConversationId: CV_1,        // old request
      resolvedConversationId:  CV_1,
    })).toBe(false);
  });

  // Case 4: student A → student B switch; A response arrives after switch
  it("case 4: student A response arrives after switching to student B → false (stale)", () => {
    expect(isCurrentRequest({
      activeStudentId:         STUDENT_B,   // switched
      activeConversationId:    null,
      requestedStudentId:      STUDENT_A,   // old request
      requestedConversationId: null,
      resolvedConversationId:  null,
    })).toBe(false);
  });

  // Case 5: history API error — current request, catch sets eligibility then finally
  // In the catch path the ref is NOT mutated, so resolvedConversationId stays null
  // and requestedConversationId is also null → straightforward match via first arm.
  it("case 5: error path, null conversationId, no ref mutation → isCurrentRequest=true", () => {
    expect(isCurrentRequest({
      activeStudentId:         STUDENT_A,
      activeConversationId:    null,        // ref unchanged (error before mutation)
      requestedStudentId:      STUDENT_A,
      requestedConversationId: null,
      resolvedConversationId:  null,        // error: server never returned id
    })).toBe(true);
  });

  // Case 6: eligible response received, resolvedConversationId set, showSpinner=false
  // (same as case 1 — verify the guard returns true so historyLoading is cleared)
  it("case 6: eligible response, null→cv_1 transition → isCurrentRequest=true (spinner clears)", () => {
    expect(isCurrentRequest({
      activeStudentId:         STUDENT_A,
      activeConversationId:    CV_1,
      requestedStudentId:      STUDENT_A,
      requestedConversationId: null,
      resolvedConversationId:  CV_1,
    })).toBe(true);
  });

  // Extra: resolvedConversationId still null after null request (server returned nothing)
  it("extra: null request, server returned no conversation_id → guard matches via first arm", () => {
    // ref not mutated, resolvedConversationId stays null → first arm: null === null ✅
    expect(isCurrentRequest({
      activeStudentId:         STUDENT_A,
      activeConversationId:    null,
      requestedStudentId:      STUDENT_A,
      requestedConversationId: null,
      resolvedConversationId:  null,
    })).toBe(true);
  });

  // Extra: stale null request where a different concurrent call set the ref
  it("extra: stale null-id request, ref was set by a newer call → false (stale)", () => {
    // A second call already resolved to cv_2 and mutated the ref.
    // This old response must not clear loading.
    expect(isCurrentRequest({
      activeStudentId:         STUDENT_A,
      activeConversationId:    CV_2,        // newer call's resolved id
      requestedStudentId:      STUDENT_A,
      requestedConversationId: null,
      resolvedConversationId:  CV_1,        // this call resolved to cv_1, not cv_2
    })).toBe(false);
  });
});
