import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { looksLikeNarrativePrompt, shouldAutoFillWithAi } from "../../src/lib/aiNarrativeFields";
import type { DetectedField } from "../../src/lib/fieldDetector";

function field(partial: Partial<DetectedField> & Pick<DetectedField, "id">): DetectedField {
  return {
    fieldType: "unknown",
    label: "",
    isRequired: false,
    isOpenEnded: false,
    elementSelector: `[data-jsa-id="${partial.id}"]`,
    ...partial,
  };
}

describe("aiNarrativeFields", () => {
  it("detects Postgres and architecture essay prompts", () => {
    assert.equal(looksLikeNarrativePrompt("Describe your Postgres experience"), true);
    assert.equal(
      looksLikeNarrativePrompt(
        "Have you worked on any query routing or load balancing logic in a production environment? Tell us what the architecture looked like and your role in it.",
      ),
      true,
    );
  });

  it("routes Ashby-style textareas to AI autofill", () => {
    const essay = field({
      id: "a",
      inputType: "textarea",
      fieldType: "long_text",
      label: "your answer",
      questionText: "Describe your Postgres experience",
    });
    assert.equal(shouldAutoFillWithAi(essay), true);
  });

  it("does not route blank short textareas without a narrative prompt", () => {
    const short = field({
      id: "c",
      inputType: "textarea",
      fieldType: "long_text",
      label: "notes",
      questionText: "notes",
    });
    assert.equal(shouldAutoFillWithAi(short), false);
  });

  it("does not route email fields to AI autofill", () => {
    const email = field({
      id: "b",
      inputType: "email",
      fieldType: "email",
      label: "email",
    });
    assert.equal(shouldAutoFillWithAi(email), false);
  });

  it("does not route hear-about source fields to AI autofill", () => {
    const hearAbout = field({
      id: "e",
      inputType: "checkbox",
      fieldType: "hearAbout",
      label: "LinkedIn",
      questionText: "Where did you hear about this vacancy?",
    });
    assert.equal(shouldAutoFillWithAi(hearAbout), false);
  });

  it("routes misclassified boolean essay fields to AI autofill", () => {
    const essay = field({
      id: "d",
      inputType: "contenteditable",
      fieldType: "boolean",
      label: "your answer",
      questionText:
        "Have you worked on any query routing or load balancing logic in a production environment? Tell us what the architecture looked like and your role in it.",
    });
    assert.equal(shouldAutoFillWithAi(essay), true);
  });
});
