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
/**
 * The tool bridge both transports use. The model supplies only intent
 * (a search query); the executor injects the caller's identity, so the model
 * can never reach another user's or workspace's data.
 */
export interface ToolBridge {
    definitions: OpenAI.Chat.Completions.ChatCompletionTool[];
    execute: (
        name: string,
        args: Record<string, unknown>,
    ) => Promise<unknown>;
}

/**
 * Call → read result → answer needs at least two rounds; the cap stops a model
 * that keeps asking for tools from looping forever. The LAST round always runs
 * WITHOUT tools, so the model is forced to produce a plain answer.
 */
const MAX_TOOL_ROUNDS = 4;

export class AssistantService {
    constructor(
        private client: OpenAI,
        private model: string,
        private maxTokens: number,
        private logger: Logger,
    ) {}

    /**
     * Answer one question and return the full reply text (non-streaming).
     *
     * Takes the SAME tools as `streamReply`. They were streaming-only until P9,
     * which meant `POST /assistant/chat` silently could not answer "how many
     * tasks do I have" while its own SSE twin could. The browser always streams,
     * so nobody had noticed — and that is exactly what makes a
     * behaves-differently-by-transport contract worth removing rather than
     * documenting: the next client to use the JSON path would have lost every
     * data answer with no error to explain it.
     */
    async ask(
        history: ChatTurn[],
        message: string,
        opts: { tools?: ToolBridge } = {},
    ): Promise<string> {
        const startedAt = Date.now();
        const messages = buildMessages(
            history,
            message,
        ) as OpenAI.Chat.Completions.ChatCompletionMessageParam[];
        const maxRounds = opts.tools ? MAX_TOOL_ROUNDS : 1;

        for (let round = 0; round < maxRounds; round++) {
            const useTools = !!opts.tools && round < maxRounds - 1;
            const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming =
                {
                    model: this.model,
                    messages,
                    max_tokens: this.maxTokens,
                    temperature: 0.3,
                };
            if (useTools && opts.tools) {
                params.tools = opts.tools.definitions;
                params.tool_choice = "auto";
            }

            let completion;
            try {
                completion = await this.client.chat.completions.create(params);
            } catch (err) {
                throw this.toAppError(err);
            }

            const choice = completion.choices[0]?.message;
            const toolCalls = (choice?.tool_calls ?? [])
                .filter((t) => t.type === "function")
                .map((t) => ({
                    id: t.id,
                    name: t.function.name,
                    args: t.function.arguments || "{}",
                }));

            if (!opts.tools || toolCalls.length === 0) {
                const reply = choice?.content?.trim();
                this.logger.debug("assistant.openai.completed", {
                    ms: Date.now() - startedAt,
                    totalTokens: completion.usage?.total_tokens,
                    rounds: round + 1,
                });
                if (!reply) {
                    throw new AppError(
                        502,
                        "assistant.empty_reply",
                        "The assistant did not return a response. Please try again.",
                    );
                }
                return reply;
            }

            await this.appendToolRound(
                messages,
                toolCalls,
                choice?.content ?? null,
                opts.tools.execute,
            );
        }

        // Every round asked for another tool and never answered.
        throw new AppError(
            502,
            "assistant.empty_reply",
            "The assistant did not return a response. Please try again.",
        );
    }

    /**
     * Append one tool round to the conversation: the assistant's tool-call turn
     * (carrying any text it already produced) followed by each tool's result.
     *
     * Shared by both transports on purpose — this is the exact logic that was
     * duplicated-and-divergent before P9.
     */
    private async appendToolRound(
        messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
        toolCalls: { id: string; name: string; args: string }[],
        content: string | null,
        execute: ToolBridge["execute"],
    ): Promise<void> {
        messages.push({
            role: "assistant",
            content: content || null,
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
                result = await execute(t.name, args);
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
            tools?: ToolBridge;
        },
    ): Promise<void> {
        const messages = buildMessages(
            history,
            message,
        ) as OpenAI.Chat.Completions.ChatCompletionMessageParam[];

        const maxRounds = opts.tools ? MAX_TOOL_ROUNDS : 1;

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
            let streamedText = "";
            try {
                for await (const chunk of stream) {
                    const delta = chunk.choices[0]?.delta;
                    if (delta?.content) {
                        opts.onDelta(delta.content);
                        streamedText += delta.content;
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
            // No tool calls (or tools disabled) → this round WAS the answer.
            //
            // ⚠️ This deliberately does NOT stop when the model also streamed
            // text. It used to: `if (contentStreamed || …) return`, which threw
            // away every tool call the model emitted after a lead-in sentence —
            // and under a "always answer in Bangla" system prompt the model
            // opens with one constantly. Measured effect: only 2 of 10 live
            // data questions came back with a real number (P0 baseline). A
            // round that produced tool calls must always execute them.
            if (toolCalls.length === 0 || !opts.tools) return;

            // Append the assistant's tool-call turn + each tool result, then loop
            // so the next round can answer using the data.
            //
            // The lead-in the user has ALREADY seen goes in as this turn's
            // `content`, so the next round continues from it instead of
            // repeating itself — the reader gets one coherent answer rather
            // than the same sentence twice.
            await this.appendToolRound(
                messages,
                toolCalls,
                streamedText,
                opts.tools.execute,
            );
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
