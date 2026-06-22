"""
Kevin's Pipecat pipeline.

Flow:
  WebSocket audio in
    → SileroVAD (server-side voice activity detection)
    → Deepgram Nova-2 (streaming STT, first word in ~200ms)
    → AnthropicLLMService with tool_use (claude-sonnet-4-6)
    → OpenAI TTS (gpt-4o-mini-tts, streams audio back while LLM still running)
  WebSocket audio out → React Native earbuds
"""

import os
import json

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.openai_llm_context import OpenAILLMContext
from pipecat.services.anthropic.llm import AnthropicLLMService
from pipecat.services.deepgram.stt import DeepgramSTTService, LiveOptions
from pipecat.services.openai.tts import OpenAITTSService
from pipecat.transports.network.fastapi_websocket import (
    FastAPIWebsocketParams,
    FastAPIWebsocketTransport,
)
from pipecat.frames.frames import LLMFullResponseEndFrame

from kevin_prompt import build_kevin_system
from kevin_tools import KEVIN_TOOLS, handle_tool_call
from session_context import SessionContext


async def build_pipeline(
    websocket,
    session_ctx: SessionContext,
    push_ui_event,
) -> PipelineTask:
    """
    Build and return a PipelineTask wired to the given WebSocket.
    Caller runs the task via PipelineRunner.
    """

    # ── Transport ─────────────────────────────────────────────────────────────
    transport = FastAPIWebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            add_wav_header=True,
            vad_enabled=True,
            vad_analyzer=SileroVADAnalyzer(
                params=VADParams(
                    stop_secs=0.8,       # 800ms silence → end of utterance
                    confidence=0.6,
                )
            ),
            vad_audio_passthrough=True,
            serializer=None,             # default JSON-over-WS frame serializer
        ),
    )

    # ── STT ───────────────────────────────────────────────────────────────────
    stt = DeepgramSTTService(
        api_key=os.environ["DEEPGRAM_API_KEY"],
        live_options=LiveOptions(
            model="nova-2",
            language="en-US",
            smart_format=True,
            punctuate=True,
            interim_results=False,   # only fire on final transcripts
            endpointing=300,         # ms — complements Silero VAD
        ),
    )

    # ── LLM ───────────────────────────────────────────────────────────────────
    system_prompt = build_kevin_system(session_ctx.snapshot())
    live_context = session_ctx.to_system_extra()
    if live_context:
        system_prompt += "\n\n" + live_context

    context = OpenAILLMContext(
        messages=[],
        tools=KEVIN_TOOLS,
    )
    context_aggregator = context.get_context_frame()

    llm = AnthropicLLMService(
        api_key=os.environ["ANTHROPIC_API_KEY"],
        model=os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6"),
        system=system_prompt,
        max_tokens=256,
    )

    # Register tool handlers — Pipecat calls these when Claude fires a tool_use block
    async def _tool_handler(function_name: str, tool_call_id: str, arguments: dict, llm, context, result_callback):
        result = await handle_tool_call(
            tool_name=function_name,
            tool_input=arguments,
            session_ctx=session_ctx.snapshot(),
            push_ui_event=push_ui_event,
        )
        await result_callback({"result": result})

    for tool in KEVIN_TOOLS:
        llm.register_function(tool["name"], _tool_handler)

    # ── TTS ───────────────────────────────────────────────────────────────────
    tts = OpenAITTSService(
        api_key=os.environ["OPENAI_API_KEY"],
        model=os.environ.get("OPENAI_TTS_MODEL", "gpt-4o-mini-tts"),
        voice=os.environ.get("OPENAI_TTS_VOICE", "onyx"),
    )

    # ── Pipeline ──────────────────────────────────────────────────────────────
    pipeline = Pipeline([
        transport.input(),
        stt,
        context_aggregator.user(),
        llm,
        tts,
        transport.output(),
        context_aggregator.assistant(),
    ])

    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            allow_interruptions=True,       # player can cut Kevin off mid-sentence
            enable_metrics=False,
            enable_usage_metrics=False,
        ),
    )

    return task, transport
