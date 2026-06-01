import type { Logger } from "winston";
import type OpenAI from "openai";
import { buildMessages, type ChatTurn } from "../assistant/buildMessages";
import { AppError } from "../errors";

/**
 * AI Help Assistant business logic (see AI_ASSISTANT_PLAN.md, Phases 2–3).
 *
 * Builds the message array (system prompt + knowledge base + recent history +
 * the new question) and calls OpenAI — non-streaming (`ask`) or streaming
 * (`streamReply`). OpenAI failures are mapped to `AppError`s by `toAppError`;
 * a raw upstream error is never leaked to the client.
 *
 * The OpenAI client + model are injected so tests can pass a fake (Phase 7).
 */
export class AssistantService {
    constructor(
        private client: OpenAI,
        private model: string,
        private maxTokens: number,
        private logger: Logger,
    ) {}

    /**
     * Answer one question and return the full reply text (non-streaming).
     */
    async ask(history: ChatTurn[], message: string): Promise<string> {
        const startedAt = Date.now();
        let reply: string | undefined;
        try {
            const completion = await this.client.chat.completions.create({
                model: this.model,
                messages: buildMessages(
                    history,
                    message,
                ) as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
                max_tokens: this.maxTokens,
                temperature: 0.3,
            });
            reply = completion.choices[0]?.message?.content?.trim();
            this.logger.debug("assistant.openai.completed", {
                ms: Date.now() - startedAt,
                totalTokens: completion.usage?.total_tokens,
            });
        } catch (err) {
            throw this.toAppError(err);
        }

        if (!reply) {
            throw new AppError(
                502,
                "assistant.empty_reply",
                "The assistant did not return a response. Please try again.",
            );
        }
        return reply;
    }

    /**
     * Streaming variant: calls `onDelta` for each text chunk as it arrives, and
     * resolves when the stream completes.
     *
     * Error timing matters for the caller: if the OpenAI call fails BEFORE any
     * delta, this rejects with an `AppError` and nothing was emitted (so the
     * caller can still send a normal HTTP error). A mid-stream failure rejects
     * after some deltas were already delivered. If `signal` is aborted (the
     * client disconnected), it returns quietly without throwing.
     */
    async streamReply(
        history: ChatTurn[],
        message: string,
        opts: {
            onDelta: (delta: string) => void;
            signal: AbortSignal;
            tools?: {
                definitions: OpenAI.Chat.Completions.ChatCompletionTool[];
                execute: (
                    name: string,
                    args: Record<string, unknown>,
                ) => Promise<unknown>;
            };
        },
    ): Promise<void> {
        const messages = buildMessages(
            history,
            message,
        ) as OpenAI.Chat.Completions.ChatCompletionMessageParam[];

        // With tools the model may need a round-trip (call tool → read result →
        // answer). Cap the rounds; the final round runs WITHOUT tools so the
        // model is forced to produce a plain answer.
        const maxRounds = opts.tools ? 4 : 1;

        for (let round = 0; round < maxRounds; round++) {
            const useTools = !!opts.tools && round < maxRounds - 1;

            const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming =
                {
                    model: this.model,
                    messages,
                    max_tokens: this.maxTokens,
                    temperature: 0.3,
                    stream: true,
                };
            if (useTools && opts.tools) {
                params.tools = opts.tools.definitions;
                params.tool_choice = "auto";
            }

            let stream;
            try {
                stream = await this.client.chat.completions.create(params, {
                    signal: opts.signal,
                });
            } catch (err) {
                if (opts.signal.aborted) return;
                throw this.toAppError(err);
            }

            // Accumulate streamed content + any streamed tool-call fragments.
            const acc: Record<number, { id: string; name: string; args: string }> =
                {};
            let contentStreamed = false;
            try {
                for await (const chunk of stream) {
                    const delta = chunk.choices[0]?.delta;
                    if (delta?.content) {
                        opts.onDelta(delta.content);
                        contentStreamed = true;
                    }
                    for (const tc of delta?.tool_calls ?? []) {
                        const i = tc.index;
                        acc[i] ??= { id: "", name: "", args: "" };
                        if (tc.id) acc[i].id = tc.id;
                        if (tc.function?.name) acc[i].name = tc.function.name;
                        if (tc.function?.arguments)
                            acc[i].args += tc.function.arguments;
                    }
                }
            } catch (err) {
                if (opts.signal.aborted) return;
                throw this.toAppError(err);
            }

            const toolCalls = Object.values(acc).filter((t) => t.name);
            // Answered with content, no tool calls, or tools disabled → done.
            if (contentStreamed || toolCalls.length === 0 || !opts.tools) return;

            // Append the assistant's tool-call turn + each tool result, then loop
            // so the next round can answer using the data.
            messages.push({
                role: "assistant",
                content: null,
                tool_calls: toolCalls.map((t) => ({
                    id: t.id,
                    type: "function",
                    function: { name: t.name, arguments: t.args || "{}" },
                })),
            });
            for (const t of toolCalls) {
                let result: unknown;
                try {
                    const args = t.args
                        ? (JSON.parse(t.args) as Record<string, unknown>)
                        : {};
                    result = await opts.tools.execute(t.name, args);
                } catch {
                    result = { error: "tool_execution_failed" };
                }
                messages.push({
                    role: "tool",
                    tool_call_id: t.id,
                    content: JSON.stringify(result),
                });
            }
        }
    }

    /**
     * Map an OpenAI / unknown error to a safe `AppError`. Never leaks the raw
     * upstream error to the client; logs the real cause server-side.
     */
    private toAppError(err: unknown): AppError {
        if (err instanceof AppError) return err;

        const status = (err as { status?: number }).status;
        const name = err instanceof Error ? err.name : "";
        this.logger.error("assistant.openai_error", {
            status,
            name,
            message: err instanceof Error ? err.message : String(err),
        });

        // 429 from OpenAI = quota / upstream rate limit.
        if (status === 429) {
            return new AppError(
                503,
                "assistant.rate_limited",
                "The assistant is busy right now. Please try again in a moment.",
            );
        }
        // Network timeout / connection failure.
        if (name.includes("Timeout") || name.includes("Connection")) {
            return new AppError(
                504,
                "assistant.timeout",
                "The assistant took too long to respond. Please try again.",
            );
        }
        // Auth, 5xx, or anything else.
        return new AppError(
            502,
            "assistant.upstream_error",
            "The assistant is temporarily unavailable. Please try again.",
        );
    }
}
