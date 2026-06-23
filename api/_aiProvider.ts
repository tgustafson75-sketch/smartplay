/**
 * _aiProvider.ts — unified AI provider abstraction for SmartPlay API routes.
 *
 * Wraps OpenAI, Google Gemini, and Anthropic behind a single interface so
 * routes can switch providers via the X-AI-Provider request header without
 * touching business logic. TTS (gpt-4o-mini-tts) and STT (Whisper) are NOT
 * routed through here — they are always OpenAI.
 *
 * Stable provider abstraction used by the majority of API routes.
 */

import OpenAI from 'openai';
import { GoogleGenAI, FunctionCallingConfigMode, type Part } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AiProvider = 'openai' | 'gemini' | 'anthropic';
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
  /** Unique call ID (from OpenAI) or derived name key (from Gemini/Anthropic). */
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

/**
 * Structured schema for json_schema_mode (stricter than json_object_mode).
 * Pass this to completeJSON or completeVision to get guaranteed-schema output.
 */
export interface StructuredSchema {
  /** Used as json_schema.name for OpenAI and tool name for Anthropic. */
  name: string;
  /** JSON Schema object for OpenAI response_format.json_schema.schema. */
  openai: { [key: string]: unknown };
  /** Gemini Schema object for config.responseSchema. */
  gemini: { [key: string]: unknown };
  /** Anthropic tool input_schema (for tool_use pattern). Falls back to openai schema if omitted. */
  anthropic?: {
    input_schema: { [key: string]: unknown };
  };
}

export interface CompleteOpts {
  maxTokens?: number;
  temperature?: number;
  /** Timeout in ms. Defaults: OpenAI 25 000, Gemini 20 000. */
  timeoutMs?: number;
  /**
   * Optional structured output schema. When provided, uses json_schema_mode
   * (OpenAI), responseSchema (Gemini), or tool_use pattern (Anthropic)
   * instead of plain json_object / responseMimeType modes.
   */
  schema?: StructuredSchema;
  /**
   * Force the model to call a specific tool by name. When set, the provider
   * will use tool_choice (OpenAI), tool_choice (Anthropic), or
   * functionCallingConfig ANY (Gemini) to guarantee the named tool fires.
   */
  forceTool?: string;
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
  anthropic: { fast: 'claude-haiku-4-5-20251001', quality: 'claude-sonnet-4-6' },
};

// ─── SDK clients (lazy-initialized per request context) ───────────────────────

function getOpenAI(timeoutMs = 25_000): OpenAI {
  // 2026-06-23 (smoke-test) — fail fast + honest when the key is unset, matching
  // the Gemini/Anthropic guards (otherwise the SDK throws a cryptic deep error).
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');
  // When a tight per-request timeout is set, disable retries so a slow-AI
  // round doesn't consume 2× the budget and push the loop over Vercel's 60s cap.
  const maxRetries = timeoutMs < 25_000 ? 0 : 1;
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: timeoutMs, maxRetries });
}

function getGemini(): GoogleGenAI {
  if (!process.env.GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY not configured');
  return new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
}

function getAnthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
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

  if (provider === 'anthropic') {
    const ant = getAnthropic();
    const res = await ant.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      system,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    });
    const block = res.content.find(b => b.type === 'text');
    return block?.type === 'text' ? block.text : '';
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
 * Pass opts.schema to get json_schema_mode (stricter, schema-validated output).
 */
export async function completeJSON(
  provider: AiProvider,
  tier: AiTier,
  system: string,
  messages: AiMessage[],
  opts: CompleteOpts = {},
): Promise<string> {
  const { maxTokens = 1024, temperature = 0, timeoutMs, schema } = opts;
  const model = MODELS[provider][tier];

  if (provider === 'openai') {
    const oai = getOpenAI(timeoutMs);
    const responseFormat = schema
      ? { type: 'json_schema' as const, json_schema: { name: schema.name, strict: true, schema: schema.openai } }
      : { type: 'json_object' as const };
    const res = await oai.chat.completions.create({
      model,
      max_tokens: maxTokens,
      temperature,
      response_format: responseFormat,
      messages: [
        { role: 'system', content: system },
        ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      ],
    });
    return res.choices[0]?.message?.content ?? '{}';
  }

  if (provider === 'anthropic') {
    const ant = getAnthropic();
    if (schema) {
      // Tool-use pattern: forces Anthropic to fill the schema exactly.
      const inputSchema = schema.anthropic?.input_schema ?? schema.openai;
      const tool: Anthropic.Tool = {
        name: schema.name,
        description: `Return a JSON object matching the ${schema.name} schema.`,
        input_schema: inputSchema as Anthropic.Tool['input_schema'],
      };
      const res = await ant.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        tools: [tool],
        tool_choice: { type: 'tool', name: schema.name },
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      });
      const block = res.content.find(b => b.type === 'tool_use');
      if (block?.type === 'tool_use') {
        return JSON.stringify(block.input);
      }
      return '{}';
    } else {
      // Plain JSON mode: instruct via system prompt.
      const jsonSystem = system + '\n\nRespond with valid JSON only. No markdown, no prose.';
      const res = await ant.messages.create({
        model,
        max_tokens: maxTokens,
        temperature,
        system: jsonSystem,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      });
      const block = res.content.find(b => b.type === 'text');
      return block?.type === 'text' ? block.text.trim() : '{}';
    }
  }

  // Gemini
  const genai = getGemini();
  const geminiConfig: Record<string, unknown> = {
    systemInstruction: { role: 'user', parts: [{ text: system }] },
    temperature,
    maxOutputTokens: maxTokens,
    responseMimeType: 'application/json',
  };
  if (schema) {
    geminiConfig.responseSchema = schema.gemini;
  }
  const res = await withGeminiTimeout(genai.models.generateContent({
    model,
    contents: messages.map(m => ({ role: m.role, parts: [{ text: m.content }] })),
    config: geminiConfig,
  }), timeoutMs ?? 25_000);
  return (res.text ?? '{}').trim();
}

// ─── Vision completion ────────────────────────────────────────────────────────

/**
 * Vision completion — image(s) + text prompt → string response.
 * Pass forceJSON: true to get JSON output (uses json_object / responseMimeType).
 * Pass opts.schema to get json_schema_mode (stricter, schema-validated output).
 */
export async function completeVision(
  provider: AiProvider,
  tier: AiTier,
  system: string,
  prompt: string,
  images: AiImageInput[],
  opts: CompleteOpts & { forceJSON?: boolean } = {},
): Promise<string> {
  const { maxTokens = 1024, temperature = 0.3, timeoutMs, forceJSON = false, schema } = opts;
  const model = MODELS[provider][tier];

  if (provider === 'openai') {
    const oai = getOpenAI(timeoutMs ?? 20_000);
    const imageContent = images.map(img => ({
      type: 'image_url' as const,
      image_url: { url: `data:${img.mimeType};base64,${img.b64}`, detail: 'high' as const },
    }));
    let responseFormat: OpenAI.ResponseFormatJSONSchema | OpenAI.ResponseFormatJSONObject | undefined;
    if (schema) {
      responseFormat = { type: 'json_schema', json_schema: { name: schema.name, strict: true, schema: schema.openai } };
    } else if (forceJSON) {
      responseFormat = { type: 'json_object' };
    }
    const res = await oai.chat.completions.create({
      model,
      max_tokens: maxTokens,
      temperature,
      ...(responseFormat ? { response_format: responseFormat } : {}),
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

  if (provider === 'anthropic') {
    const ant = getAnthropic();
    const imageBlocks: Anthropic.ImageBlockParam[] = images.map(img => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.mimeType as Anthropic.Base64ImageSource['media_type'],
        data: img.b64,
      },
    }));
    const userContent: Anthropic.ContentBlockParam[] = [
      ...imageBlocks,
      { type: 'text', text: prompt },
    ];

    if (schema) {
      // Tool-use pattern for structured vision output.
      const inputSchema = schema.anthropic?.input_schema ?? schema.openai;
      const tool: Anthropic.Tool = {
        name: schema.name,
        description: `Analyze the image(s) and return a JSON object matching the ${schema.name} schema.`,
        input_schema: inputSchema as Anthropic.Tool['input_schema'],
      };
      const res = await ant.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        tools: [tool],
        tool_choice: { type: 'tool', name: schema.name },
        messages: [{ role: 'user', content: userContent }],
      });
      const block = res.content.find(b => b.type === 'tool_use');
      if (block?.type === 'tool_use') {
        return JSON.stringify(block.input);
      }
      return forceJSON ? '{}' : '';
    } else {
      const jsonSystem = forceJSON
        ? system + '\n\nRespond with valid JSON only. No markdown, no prose.'
        : system;
      const res = await ant.messages.create({
        model,
        max_tokens: maxTokens,
        temperature,
        system: jsonSystem,
        messages: [{ role: 'user', content: userContent }],
      });
      const block = res.content.find(b => b.type === 'text');
      return block?.type === 'text' ? block.text.trim() : '';
    }
  }

  // Gemini
  const genai = getGemini();
  const imageParts = images.map(img => ({ inlineData: { mimeType: img.mimeType, data: img.b64 } }));
  const geminiConfig: Record<string, unknown> = {
    temperature,
    maxOutputTokens: maxTokens,
  };
  if (schema) {
    geminiConfig.responseMimeType = 'application/json';
    geminiConfig.responseSchema = schema.gemini;
  } else if (forceJSON) {
    geminiConfig.responseMimeType = 'application/json';
  }
  const res = await withGeminiTimeout(genai.models.generateContent({
    model,
    contents: [{
      role: 'user',
      parts: [
        { text: system + '\n\n' + prompt },
        ...imageParts,
      ],
    }],
    config: geminiConfig,
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
      ...(opts?.forceTool ? { tool_choice: { type: 'function', function: { name: opts.forceTool } } } : {}),
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

  if (provider === 'anthropic') {
    const ant = getAnthropic();
    const antTools: Anthropic.Tool[] = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool['input_schema'],
    }));

    // Build messages, inserting tool results as tool_result content blocks.
    const antMessages: Anthropic.MessageParam[] = messages.map(m => ({
      role: m.role,
      content: m.content,
    }));
    if (toolResults.length > 0) {
      antMessages.push({
        role: 'user',
        content: toolResults.map(tr => ({
          type: 'tool_result' as const,
          tool_use_id: tr.id,
          content: tr.content,
        })),
      });
    }

    const res = await ant.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      system,
      tools: antTools,
      messages: antMessages,
      ...(opts?.forceTool ? { tool_choice: { type: 'tool', name: opts.forceTool } } : {}),
    });

    const textBlock = res.content.find(b => b.type === 'text');
    const text = textBlock?.type === 'text' ? textBlock.text : '';
    const toolCalls: AiToolCall[] = res.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      .map(b => ({
        id: b.id,
        name: b.name,
        input: b.input as Record<string, unknown>,
      }));
    return { text, toolCalls, provider: 'anthropic' };
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
      ...(opts?.forceTool ? { toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: [opts.forceTool] } } } : {}),
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
  if (provider === 'anthropic') {
    return _anthropicAgenticLoop(tier, system, userMessage, images, tools, onToolCall, opts);
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

async function _anthropicAgenticLoop(
  tier: AiTier,
  system: string,
  userMessage: string,
  images: AiImageInput[],
  tools: AiToolDef[],
  onToolCall: (name: string, input: Record<string, unknown>) => Promise<string>,
  opts: CompleteOpts & { maxRounds?: number; continuationTools?: string[] },
): Promise<AgenticLoopResult> {
  const { maxTokens = 1024, temperature = 0.7, maxRounds = 3, continuationTools } = opts;
  const model = MODELS['anthropic'][tier];
  const ant = getAnthropic();

  const antTools: Anthropic.Tool[] = tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Anthropic.Tool['input_schema'],
  }));

  // Build initial user content — images first, then text.
  const initialContent: Anthropic.ContentBlockParam[] = [
    ...images.map(img => ({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: img.mimeType as Anthropic.Base64ImageSource['media_type'],
        data: img.b64,
      },
    })),
    { type: 'text' as const, text: userMessage },
  ];

  const msgs: Anthropic.MessageParam[] = [
    { role: 'user', content: initialContent },
  ];

  let text = '';
  let rounds = 0;

  for (let round = 0; round < maxRounds; round++) {
    rounds = round + 1;
    const res = await ant.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      system,
      tools: antTools,
      messages: msgs,
    });

    const textBlock = res.content.find(b => b.type === 'text');
    const toolUseBlocks = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');

    // Only accumulate text from final-answer rounds (no tool_use in response).
    if (toolUseBlocks.length === 0) {
      text += textBlock?.type === 'text' ? textBlock.text : '';
    }

    if (res.stop_reason === 'max_tokens') {
      text = text.trimEnd();
      if (!text.endsWith('.') && !text.endsWith('!') && !text.endsWith('?')) {
        text += '.';
      }
      console.warn('[aiProvider] Anthropic response truncated at token limit — stop_reason:max_tokens');
      break;
    }

    if (toolUseBlocks.length === 0 || res.stop_reason !== 'tool_use') break;

    // Append assistant turn with all content blocks (text + tool_use).
    msgs.push({ role: 'assistant', content: res.content });

    let hasContinuationTool = false;
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      const result = await onToolCall(block.name, block.input as Record<string, unknown>);
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
      if (!continuationTools || continuationTools.includes(block.name)) hasContinuationTool = true;
    }
    msgs.push({ role: 'user', content: toolResults });

    if (!hasContinuationTool) break;
  }

  return { text: text.trim(), provider: 'anthropic', rounds };
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
  return val === 'openai' || val === 'gemini' || val === 'anthropic' ? val : 'gemini';
}
