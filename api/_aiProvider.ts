/**
 * _aiProvider.ts — unified AI provider abstraction for SmartPlay API routes.
 *
 * Wraps OpenAI and Google Gemini behind a single interface so routes can
 * switch providers via the X-AI-Provider request header without touching
 * business logic. TTS (gpt-4o-mini-tts) and STT (Whisper) are NOT routed
 * through here — they are always OpenAI.
 *
 * Stable provider abstraction used by the majority of API routes.
 */

import OpenAI from 'openai';
import { GoogleGenAI, type Part } from '@google/genai';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AiProvider = 'openai' | 'gemini';
export type AiTier = 'fast' | 'quality';

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiImageInput {
  /** Base64-encoded image data (no data-URI prefix). */
  b64: string;
  mimeType: string;
}

/** Normalized tool call from either provider. */
export interface AiToolCall {
  /** Unique call ID (from OpenAI) or derived name key (from Gemini). */
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Tool result to feed back into the next agentic loop turn. */
export interface AiToolResult {
  id: string;
  name: string;
  content: string;
}

/** Tool definition shape, provider-agnostic. */
export interface AiToolDef {
  name: string;
  description: string;
  /** JSON Schema for the tool's parameters object. */
  parameters: Record<string, unknown>;
}

export interface CompleteOpts {
  maxTokens?: number;
  temperature?: number;
  /** Timeout in ms. Defaults: OpenAI 25 000, Gemini 20 000. */
  timeoutMs?: number;
}

export interface CompleteWithToolsResult {
  text: string;
  toolCalls: AiToolCall[];
  /** Which provider actually served this request. */
  provider: AiProvider;
}

// ─── Model selection ──────────────────────────────────────────────────────────

const MODELS: Record<AiProvider, Record<AiTier, string>> = {
  openai: { fast: 'gpt-4o-mini', quality: 'gpt-4o' },
  gemini: { fast: 'gemini-2.5-flash', quality: 'gemini-2.5-flash' },
};

// ─── SDK clients (lazy-initialized per request context) ───────────────────────

function getOpenAI(timeoutMs = 25_000): OpenAI {
  // When a tight per-request timeout is set, disable retries so a slow-AI
  // round doesn't consume 2× the budget and push the loop over Vercel's 60s cap.
  const maxRetries = timeoutMs < 25_000 ? 0 : 1;
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: timeoutMs, maxRetries });
}

function getGemini(): GoogleGenAI {
  if (!process.env.GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY not configured');
  return new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
}

// ─── Gemini timeout helper ────────────────────────────────────────────────────

function withGeminiTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Gemini timeout after ${ms}ms`)), ms),
    ),
  ]);
}

// ─── Text completion ──────────────────────────────────────────────────────────

/**
 * Plain text completion. Returns the model's response as a string.
 */
export async function completeText(
  provider: AiProvider,
  tier: AiTier,
  system: string,
  messages: AiMessage[],
  opts: CompleteOpts = {},
): Promise<string> {
  const { maxTokens = 1024, temperature = 0.7, timeoutMs } = opts;
  const model = MODELS[provider][tier];

  if (provider === 'openai') {
    const oai = getOpenAI(timeoutMs);
    const res = await oai.chat.completions.create({
      model,
      max_tokens: maxTokens,
      temperature,
      messages: [
        { role: 'system', content: system },
        ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      ],
    });
    return res.choices[0]?.message?.content ?? '';
  }

  // Gemini
  const genai = getGemini();
  const res = await withGeminiTimeout(genai.models.generateContent({
    model,
    contents: messages.map(m => ({ role: m.role, parts: [{ text: m.content }] })),
    config: {
      systemInstruction: { role: 'user', parts: [{ text: system }] },
      temperature,
      maxOutputTokens: maxTokens,
    },
  }), timeoutMs ?? 25_000);
  return (res.text ?? '').trim();
}

// ─── JSON completion ──────────────────────────────────────────────────────────

/**
 * Like completeText but forces the model to return valid JSON.
 * Parse the result yourself — this only guarantees the format, not the schema.
 */
export async function completeJSON(
  provider: AiProvider,
  tier: AiTier,
  system: string,
  messages: AiMessage[],
  opts: CompleteOpts = {},
): Promise<string> {
  const { maxTokens = 1024, temperature = 0, timeoutMs } = opts;
  const model = MODELS[provider][tier];

  if (provider === 'openai') {
    const oai = getOpenAI(timeoutMs);
    const res = await oai.chat.completions.create({
      model,
      max_tokens: maxTokens,
      temperature,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      ],
    });
    return res.choices[0]?.message?.content ?? '{}';
  }

  // Gemini
  const genai = getGemini();
  const res = await withGeminiTimeout(genai.models.generateContent({
    model,
    contents: messages.map(m => ({ role: m.role, parts: [{ text: m.content }] })),
    config: {
      systemInstruction: { role: 'user', parts: [{ text: system }] },
      temperature,
      maxOutputTokens: maxTokens,
      responseMimeType: 'application/json',
    },
  }), timeoutMs ?? 25_000);
  return (res.text ?? '{}').trim();
}

// ─── Vision completion ────────────────────────────────────────────────────────

/**
 * Vision completion — image(s) + text prompt → string response.
 * Pass forceJSON: true to get JSON output (uses json_object / responseMimeType).
 */
export async function completeVision(
  provider: AiProvider,
  tier: AiTier,
  system: string,
  prompt: string,
  images: AiImageInput[],
  opts: CompleteOpts & { forceJSON?: boolean } = {},
): Promise<string> {
  const { maxTokens = 1024, temperature = 0.3, timeoutMs, forceJSON = false } = opts;
  const model = MODELS[provider][tier];

  if (provider === 'openai') {
    const oai = getOpenAI(timeoutMs ?? 20_000);
    const imageContent = images.map(img => ({
      type: 'image_url' as const,
      image_url: { url: `data:${img.mimeType};base64,${img.b64}`, detail: 'high' as const },
    }));
    const res = await oai.chat.completions.create({
      model,
      max_tokens: maxTokens,
      temperature,
      ...(forceJSON ? { response_format: { type: 'json_object' as const } } : {}),
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            ...imageContent,
            { type: 'text' as const, text: prompt },
          ],
        },
      ],
    });
    return res.choices[0]?.message?.content ?? '';
  }

  // Gemini
  const genai = getGemini();
  const imageParts = images.map(img => ({ inlineData: { mimeType: img.mimeType, data: img.b64 } }));
  const res = await withGeminiTimeout(genai.models.generateContent({
    model,
    contents: [{
      role: 'user',
      parts: [
        { text: system + '\n\n' + prompt },
        ...imageParts,
      ],
    }],
    config: {
      temperature,
      maxOutputTokens: maxTokens,
      ...(forceJSON ? { responseMimeType: 'application/json' } : {}),
    },
  }), timeoutMs ?? 25_000);
  return (res.text ?? '').trim();
}

// ─── Tool / function calling ──────────────────────────────────────────────────

/**
 * Agentic tool call — one turn of the tool loop.
 *
 * Returns the model's text response AND any tool calls it wants to make.
 * The caller runs tool execution and calls this again with toolResults to
 * continue the loop.
 *
 * toolResults: prior AiToolResult[] to include as tool responses (empty on first turn).
 */
export async function completeWithTools(
  provider: AiProvider,
  tier: AiTier,
  system: string,
  messages: AiMessage[],
  tools: AiToolDef[],
  toolResults: AiToolResult[] = [],
  opts: CompleteOpts = {},
): Promise<CompleteWithToolsResult> {
  const { maxTokens = 1024, temperature = 0.7, timeoutMs } = opts;
  const model = MODELS[provider][tier];

  if (provider === 'openai') {
    const oai = getOpenAI(timeoutMs);
    const oaiTools: OpenAI.Chat.ChatCompletionTool[] = tools.map(t => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));

    // Build message list including any prior tool results
    const msgList: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: system },
      ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ];
    if (toolResults.length > 0) {
      for (const tr of toolResults) {
        msgList.push({ role: 'tool', tool_call_id: tr.id, content: tr.content });
      }
    }

    const res = await oai.chat.completions.create({
      model, max_tokens: maxTokens, temperature,
      tools: oaiTools,
      messages: msgList,
    });

    const msg = res.choices[0]?.message;
    const text = msg?.content ?? '';
    const toolCalls: AiToolCall[] = (msg?.tool_calls ?? [])
      .filter((tc): tc is OpenAI.Chat.ChatCompletionMessageFunctionToolCall => tc.type === 'function')
      .map(tc => ({
        id: tc.id,
        name: tc.function.name,
        input: (() => { try { return JSON.parse(tc.function.arguments); } catch { return {}; } })(),
      }));
    return { text, toolCalls, provider: 'openai' };
  }

  // Gemini
  const genai = getGemini();
  const geminiTools = [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })) }];

  const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = messages.map(m => ({
    role: m.role,
    parts: [{ text: m.content }],
  }));
  if (toolResults.length > 0) {
    contents.push({
      role: 'function',
      parts: toolResults.map(tr => ({
        functionResponse: { name: tr.name, response: { content: tr.content } },
      })),
    });
  }

  const res = await withGeminiTimeout(genai.models.generateContent({
    model,
    contents,
    config: {
      systemInstruction: { role: 'user', parts: [{ text: system }] },
      temperature,
      maxOutputTokens: maxTokens,
      tools: geminiTools,
    },
  }), timeoutMs ?? 25_000);

  const parts: Part[] = res.candidates?.[0]?.content?.parts ?? [];
  const textParts = parts.filter(p => typeof p.text === 'string');
  const fnParts = parts.filter(p => p.functionCall != null);

  const text = textParts.map(p => p.text as string).join('');
  const toolCalls: AiToolCall[] = fnParts.map((p, i) => {
    const fc = p.functionCall as { name: string; args?: Record<string, unknown> };
    return {
      id: `${fc.name}-${i}`,
      name: fc.name,
      input: fc.args ?? {},
    };
  });

  return { text, toolCalls, provider: 'gemini' };
}

// ─── Agentic tool loop ───────────────────────────────────────────────────────

export interface AgenticLoopResult {
  text: string;
  provider: AiProvider;
  rounds: number;
}

/**
 * Multi-round agentic tool loop with optional vision on the first turn.
 *
 * Handles the full conversation history internally — callers never touch
 * provider-specific message types. The onToolCall callback is invoked for
 * every tool the model calls; its return value becomes the tool result.
 *
 * continuationTools: if provided, the loop only continues when at least one
 * tool call in a round matches a name in this list. Other tool calls execute
 * but don't trigger another model turn. Omit to always continue (up to maxRounds).
 */
export async function runAgenticLoop(
  provider: AiProvider,
  tier: AiTier,
  system: string,
  userMessage: string,
  images: AiImageInput[],
  tools: AiToolDef[],
  onToolCall: (name: string, input: Record<string, unknown>) => Promise<string>,
  opts: CompleteOpts & { maxRounds?: number; continuationTools?: string[] } = {},
): Promise<AgenticLoopResult> {
  if (provider === 'openai') {
    return _openaiAgenticLoop(tier, system, userMessage, images, tools, onToolCall, opts);
  }
  return _geminiAgenticLoop(tier, system, userMessage, images, tools, onToolCall, opts);
}

async function _openaiAgenticLoop(
  tier: AiTier,
  system: string,
  userMessage: string,
  images: AiImageInput[],
  tools: AiToolDef[],
  onToolCall: (name: string, input: Record<string, unknown>) => Promise<string>,
  opts: CompleteOpts & { maxRounds?: number; continuationTools?: string[] },
): Promise<AgenticLoopResult> {
  const { maxTokens = 1024, temperature = 0.7, timeoutMs, maxRounds = 3, continuationTools } = opts;
  const model = MODELS['openai'][tier];
  const oai = getOpenAI(timeoutMs);

  const oaiTools: OpenAI.Chat.ChatCompletionTool[] = tools.map(t => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  const userContent: OpenAI.Chat.ChatCompletionContentPart[] | string =
    images.length > 0
      ? [
          ...images.map(img => ({
            type: 'image_url' as const,
            image_url: { url: `data:${img.mimeType};base64,${img.b64}`, detail: 'high' as const },
          })),
          { type: 'text' as const, text: userMessage },
        ]
      : userMessage;

  const msgs: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: system },
    { role: 'user', content: userContent },
  ];

  let text = '';
  let rounds = 0;

  for (let round = 0; round < maxRounds; round++) {
    rounds = round + 1;
    const res = await oai.chat.completions.create({ model, max_tokens: maxTokens, temperature, tools: oaiTools, messages: msgs });
    const choice = res.choices[0];
    const msg = choice?.message;
    if (!msg) break;

    const toolCalls = (msg.tool_calls ?? []).filter(
      (tc): tc is OpenAI.Chat.ChatCompletionMessageFunctionToolCall => tc.type === 'function',
    );

    // Only accumulate text from final-answer rounds, not tool-call rounds.
    // When finish_reason is 'tool_calls', any partial content ("Let me check
    // that...") is discarded so it doesn't prepend the real answer next round.
    if (choice?.finish_reason !== 'tool_calls') {
      text += msg.content ?? '';
    }

    if (choice?.finish_reason === 'length') {
      // Response hit the token limit — cap cleanly rather than cutting mid-word.
      text = text.trimEnd();
      if (!text.endsWith('.') && !text.endsWith('!') && !text.endsWith('?')) {
        text += '.';
      }
      console.warn('[aiProvider] response truncated at token limit — finish_reason:length');
      break;
    }

    if (toolCalls.length === 0 || choice?.finish_reason !== 'tool_calls') break;

    msgs.push({ role: 'assistant', content: msg.content, tool_calls: msg.tool_calls });

    let hasContinuationTool = false;
    for (const tc of toolCalls) {
      const input = (() => { try { return JSON.parse(tc.function.arguments) as Record<string, unknown>; } catch { return {}; } })();
      const result = await onToolCall(tc.function.name, input);
      msgs.push({ role: 'tool', tool_call_id: tc.id, content: result });
      if (!continuationTools || continuationTools.includes(tc.function.name)) hasContinuationTool = true;
    }

    if (!hasContinuationTool) break;
  }

  return { text: text.trim(), provider: 'openai', rounds };
}

async function _geminiAgenticLoop(
  tier: AiTier,
  system: string,
  userMessage: string,
  images: AiImageInput[],
  tools: AiToolDef[],
  onToolCall: (name: string, input: Record<string, unknown>) => Promise<string>,
  opts: CompleteOpts & { maxRounds?: number; continuationTools?: string[] },
): Promise<AgenticLoopResult> {
  const { maxTokens = 1024, temperature = 0.7, maxRounds = 3, continuationTools, timeoutMs } = opts;
  const model = MODELS['gemini'][tier];
  const genai = getGemini();

  const geminiToolDefs = [{
    functionDeclarations: tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })),
  }];

  const initialParts: Array<Record<string, unknown>> = [
    ...images.map(img => ({ inlineData: { mimeType: img.mimeType, data: img.b64 } })),
    { text: userMessage },
  ];
  const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = [
    { role: 'user', parts: initialParts },
  ];

  let text = '';
  let rounds = 0;

  for (let round = 0; round < maxRounds; round++) {
    rounds = round + 1;
    const res = await withGeminiTimeout(genai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: { role: 'user', parts: [{ text: system }] },
        temperature,
        maxOutputTokens: maxTokens,
        tools: geminiToolDefs,
      },
    }), timeoutMs ?? 25_000);

    const candidate = res.candidates?.[0];
    const parts = (candidate?.content?.parts ?? []) as Array<Record<string, unknown>>;
    const textParts = parts.filter(p => typeof p.text === 'string');
    const fnParts = parts.filter(p => p.functionCall != null);

    // Only accumulate text from final-answer rounds, not tool-call rounds.
    // When the model is invoking a function, any partial text before the call
    // is discarded so it doesn't prepend the real answer in the next round.
    if (fnParts.length === 0) {
      text += textParts.map(p => p.text as string).join('');
    }

    if ((candidate as { finishReason?: string } | undefined)?.finishReason === 'MAX_TOKENS') {
      // Response hit the token limit — cap cleanly rather than cutting mid-word.
      text = text.trimEnd();
      if (!text.endsWith('.') && !text.endsWith('!') && !text.endsWith('?')) {
        text += '.';
      }
      console.warn('[aiProvider] Gemini response truncated at token limit — finishReason:MAX_TOKENS');
      break;
    }

    if (fnParts.length === 0) break;

    contents.push({ role: 'model', parts });

    let hasContinuationTool = false;
    const functionResponses: Array<Record<string, unknown>> = [];
    for (const part of fnParts) {
      const fc = part.functionCall as { name: string; args?: Record<string, unknown> };
      const result = await onToolCall(fc.name, fc.args ?? {});
      functionResponses.push({ functionResponse: { name: fc.name, response: { content: result } } });
      if (!continuationTools || continuationTools.includes(fc.name)) hasContinuationTool = true;
    }

    contents.push({ role: 'function', parts: functionResponses });

    if (!hasContinuationTool) break;
  }

  return { text: text.trim(), provider: 'gemini', rounds };
}

// ─── Header helper ────────────────────────────────────────────────────────────

/**
 * Read the AI provider from an incoming request header.
 * Falls back to 'gemini' if the header is absent or invalid.
 */
export function providerFromHeader(headers: Record<string, string | string[] | undefined>): AiProvider {
  const raw = headers['x-ai-provider'];
  const val = Array.isArray(raw) ? raw[0] : raw;
  return val === 'openai' || val === 'gemini' ? val : 'gemini';
}
