---
name: ask-question
description: When and how to ask the operator multiple-choice questions in chat (Cursor-style AskQuestion)
---

# Ask the operator in chat

Use **`sylo_ask_question`** when you need a decision, preference, or clarification and you can offer concrete choices.

The questions appear **inline in chat**. The turn waits until the operator picks answers and hits **Submit**.

## Rules

- **Batch.** If you have 2–N questions, put them all in one `sylo_ask_question` call. Do not ask them one at a time.
- **Do not list options in prose.** Do not write "A / B / C?" in your message — call the tool.
- **At least two options** per question. Labels should be complete answers, not "yes"/"option 1".
- The UI always adds **Other** so the operator can type a custom answer. You do not need to include Other yourself.
- Set `allow_multiple: true` only when more than one option can be right at once.

## Shape

```
sylo_ask_question({
  title: "How should I proceed?",
  questions: [
    {
      id: "approach",
      prompt: "Which approach should I take?",
      options: [
        { id: "minimal", label: "Smallest change that fixes it" },
        { id: "refactor", label: "Refactor the surrounding code too" }
      ]
    }
  ]
})
```

Skip this tool for open-ended questions the operator should type in the composer.
