import { describe, expect, it } from "vitest";
import {
  buildSupportTopicKey,
  nextSupportSequence,
} from "../support-escalation.js";

function next(context: Record<string, unknown>, topicKey: string) {
  return nextSupportSequence(context, topicKey, false);
}

describe("CS26 runtime sequence contract", () => {
  it("different expressions for one verified intent offer the CTA on exactly the third turn", () => {
    // The three natural-language forms may differ, but the verified direct
    // answer/knowledge ID is the server-authoritative intent identity.
    const photoIntent = buildSupportTopicKey({
      sourceType: "DIRECT_DB",
      sourceId: "ki_parent_photo_visibility",
      normalizedQuery: "아이 사진이 안 보여요",
    });

    const one = next({}, photoIntent);
    const two = next({ cs26_sequence: one }, photoIntent);
    const three = next({ cs26_sequence: two }, photoIntent);

    expect(one.same_intent_streak).toBe(1);
    expect(one.inquiry_offered).toBe(false);
    expect(two.same_intent_streak).toBe(2);
    expect(two.inquiry_offered).toBe(false);
    expect(three.same_intent_streak).toBe(3);
    expect(three.inquiry_offered).toBe(true);
    expect(three.gpt_status).toBe("OFFERED");
  });

  it("resets the streak when another verified intent appears", () => {
    const photo = buildSupportTopicKey({
      sourceType: "DIRECT_DB",
      sourceId: "ki_parent_photo_visibility",
      normalizedQuery: "사진이 안 보여요",
    });
    const makeup = buildSupportTopicKey({
      sourceType: "DIRECT_DB",
      sourceId: "ki_makeup_class",
      normalizedQuery: "보강 수업",
    });

    const photoOne = next({}, photo);
    const photoTwo = next({ cs26_sequence: photoOne }, photo);
    const makeupOne = next({ cs26_sequence: photoTwo }, makeup);
    const finalPhotoOne = next({ cs26_sequence: makeupOne }, photo);
    const finalPhotoTwo = next({ cs26_sequence: finalPhotoOne }, photo);

    expect(photoTwo.same_intent_streak).toBe(2);
    expect(makeupOne.same_intent_streak).toBe(1);
    expect(finalPhotoTwo.same_intent_streak).toBe(2);
    expect(finalPhotoTwo.inquiry_offered).toBe(false);
  });

  it("does not merge unrelated NO_MATCH questions into a repeat streak", () => {
    const photos = buildSupportTopicKey({ normalizedQuery: "사진이 안 보여요" });
    const makeup = buildSupportTopicKey({ normalizedQuery: "보강 수업은 언제인가요" });
    const first = next({}, photos);
    const second = next({ cs26_sequence: first }, makeup);

    expect(second.same_intent_streak).toBe(1);
    expect(second.inquiry_offered).toBe(false);
  });
});