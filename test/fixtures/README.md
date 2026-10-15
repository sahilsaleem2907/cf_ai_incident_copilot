# Test fixtures

## `llm/`

Real Workers AI responses recorded in WP-02 (2026-10-15) through `wrangler dev` and AI Gateway, using the chat-completions format. The unit tests feed them through the real mapper and SSE parser (`llm-client.test.ts`, `stream.test.ts`, `findings.test.ts`). `worker/llm/mock.ts` produces responses in the same shape. Findings are in TDD §7.4.1.

- Removed: `prompt_token_ids`, `prompt_text`, `prompt_logprobs`, `kv_transfer_params`, `ec_transfer_params`, `token_ids` (noise), and the gateway log ID.
- The prompts used a system prompt naming `example.com`, plus the TDD `dns_lookup` and `submit_findings` tool schemas. The tool result fed back was `[dns-1] dns_lookup: … A 93.184.215.14 … mismatch=false`.

| File | What it shows |
|---|---|
| `<model>/text.json` | Plain answer. `reasoning`/`reasoning_content` are present and must be ignored. glm was called with thinking off. |
| `<model>/tool-call.json` | First planning turn: a `dns_lookup` call with `arguments` as a JSON string |
| `<model>/stream.sse`, `stream-tool-call.sse` | Raw SSE. Total usage is on the final `{"response":"","usage":…}` line before `[DONE]` |
| `gpt-oss-120b/followup-no-tool-choice.json` | gpt answers in prose and **doesn't** call `submit_findings` (default `tool_choice`) |
| `gpt-oss-120b/followup-tool-choice-required.json` | With `tool_choice:"required"`: a `submit_findings` call (its `evidence` holds sentences, not IDs) |
| `glm-4.7-flash/followup-no-tool-choice.json` | glm calls `submit_findings` and also returns prose `content` |
| `errors.json` | Error `name`/`message` for a gateway that doesn't exist and an unknown model |
